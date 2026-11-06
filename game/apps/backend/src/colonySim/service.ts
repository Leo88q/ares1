// Серверная симуляция колонии (вариант 2). Сервер — единственный источник состояния.
//
// Сеанс = снимок + журнал. Снимок пишется раз в SNAPSHOT_EVERY принятых действий, журнал — append-only.
// Загрузка: берём снимок и проигрываем журнал после него. Конец проверяем по хешу состояния;
// если версия движка в журнале не совпала с текущей — отказ, а не тихое расхождение.
//
// Действие и оплата идут в одной транзакции: сначала действие (NO_EFFECT → откат, без списания),
// затем квитанция colony_spend (уникальна по подписи), затем запись журнала.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  applyAction,
  freshSession,
  ENGINE_VERSION,
  parseSimAction,
  serializeSession,
  spendFor,
  type ApplyFailure,
  type SimAction,
  type SimSession,
} from "@ares/colony-engine/colony/actions";

/** 1 POTATO = 1 CR (вариант B), в микро-единицах токена (как COLONY_POTATO_PER_CR_MICRO в web). */
const MICRO_PER_CR = 1_000_000n;

export const SNAPSHOT_EVERY = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

/** Минимальный интерфейс БД: pg Pool в проде, PGlite в тестах. */
export interface SimQueryable {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}
export interface SimDatabase extends SimQueryable {
  transaction<T>(fn: (tx: SimQueryable) => Promise<T>): Promise<T>;
}

/** Адаптер pg Pool: транзакция через отдельное соединение. */
export function poolDatabase(pool: Pool): SimDatabase {
  return {
    query: (text, values) => pool.query(text, values) as never,
    async transaction<T>(fn: (tx: SimQueryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (text, values) => client.query(text, values) as never });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export type SimCluster = "devnet" | "mainnet-beta";

export interface SimView {
  sequence: number;
  state: SimSession["state"];
  scenario: SimSession["scenario"];
  engineVersion: number;
  stateHash: string;
}

export interface SimActInput {
  wallet: string;
  requestId: string;
  expectedSequence: number;
  action: unknown;
  spendSignature?: string;
}

export type SimActResult =
  | { ok: true; reused: boolean; view: SimView }
  | { ok: false; status: number; code: string; view?: SimView };

/** Ошибка, которая откатывает транзакцию и переводится в ответ API. */
export class SimRejection extends Error {
  constructor(readonly status: number, readonly code: string, readonly view?: SimView) {
    super(code);
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const APPLY_STATUS: Record<ApplyFailure, [number, string]> = {
  NO_EFFECT: [422, "NO_EFFECT"],
  ENDED: [409, "COLONY_ENDED"],
  NO_WORLD: [422, "NO_WORLD"],
};

interface SessionRow {
  sequence: string;
  snapshot_sequence: string;
  snapshot: string;
  state_hash: string;
}

interface JournalRow {
  sequence: string;
  action: unknown;
  state_hash: string;
  engine_version: number;
}

export interface ColonySimOptions {
  cluster: SimCluster;
  /** Требовать квитанцию colony_spend для стройки и ремонта (флаг COLONY_POTATO_SPEND_ENABLED). */
  spendRequired: boolean;
  snapshotEvery?: number;
}

export class ColonySimService {
  private readonly snapshotEvery: number;

  constructor(private readonly db: SimDatabase, private readonly options: ColonySimOptions) {
    this.snapshotEvery = options.snapshotEvery ?? SNAPSHOT_EVERY;
  }

  /** Текущее состояние сеанса. Первый вызов создаёт стартовую колонию. */
  async get(wallet: string): Promise<SimView> {
    return this.db.transaction(async tx => {
      const loaded = await this.load(tx, wallet);
      return viewOf(loaded.session, loaded.sequence, loaded.stateHash);
    });
  }

  async act(input: SimActInput): Promise<SimActResult> {
    if (!UUID.test(input.requestId)) return { ok: false, status: 400, code: "INVALID_REQUEST_ID" };
    if (!Number.isInteger(input.expectedSequence) || input.expectedSequence < 0) {
      return { ok: false, status: 400, code: "INVALID_SEQUENCE" };
    }
    const action = parseSimAction(input.action);
    if (!action) return { ok: false, status: 400, code: "INVALID_ACTION" };
    if (input.spendSignature !== undefined && !SIGNATURE.test(input.spendSignature)) {
      return { ok: false, status: 400, code: "INVALID_SIGNATURE" };
    }

    try {
      return await this.db.transaction(async tx => {
        const loaded = await this.load(tx, input.wallet);

        // Идемпотентность: тот же requestId с тем же действием — повтор без второго применения.
        const dup = await tx.query<{ owner_wallet: string; sequence: string; action: unknown }>(
          `SELECT owner_wallet, sequence::text, action FROM game_ops.colony_sim_actions WHERE request_id = $1`,
          [input.requestId],
        );
        const prior = dup.rows[0];
        if (prior) {
          if (prior.owner_wallet !== input.wallet || canonicalAction(prior.action) !== canonicalAction(action)) {
            throw new SimRejection(409, "REQUEST_CONFLICT");
          }
          return { ok: true as const, reused: true, view: viewOf(loaded.session, loaded.sequence, loaded.stateHash) };
        }

        if (input.expectedSequence !== loaded.sequence) {
          throw new SimRejection(409, "STALE_SEQUENCE", viewOf(loaded.session, loaded.sequence, loaded.stateHash));
        }

        const applied = applyAction(loaded.session, action);
        if (!applied.ok) {
          const [status, code] = APPLY_STATUS[applied.code];
          throw new SimRejection(status, code, viewOf(loaded.session, loaded.sequence, loaded.stateHash));
        }

        const sequence = loaded.sequence + 1;
        const cost = spendFor(action);
        if (cost && this.options.spendRequired) {
          if (!input.spendSignature) throw new SimRejection(402, "RECEIPT_REQUIRED");
          await this.consumeReceipt(tx, {
            signature: input.spendSignature,
            wallet: input.wallet,
            purpose: cost.purpose,
            cr: cost.cr,
            requestId: input.requestId,
            sequence,
          });
        }

        const text = serializeSession(applied.session);
        const hash = sha256(text);
        await tx.query(
          `INSERT INTO game_ops.colony_sim_actions
             (owner_wallet, cluster, sequence, request_id, action, state_hash, engine_version)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [input.wallet, this.options.cluster, sequence, input.requestId, JSON.stringify(action), hash, ENGINE_VERSION],
        );

        const snapshotDue = sequence - loaded.snapshotSequence >= this.snapshotEvery;
        const snapshotSequence = snapshotDue ? sequence : loaded.snapshotSequence;
        const snapshotText = snapshotDue ? text : loaded.snapshotText;
        await tx.query(
          `UPDATE game_ops.colony_sim_sessions
              SET sequence = $2, snapshot_sequence = $3, snapshot = $4, state_hash = $5,
                  engine_version = $6, updated_at = now()
            WHERE owner_wallet = $1`,
          [input.wallet, sequence, snapshotSequence, snapshotText, hash, ENGINE_VERSION],
        );
        return { ok: true as const, reused: false, view: viewOf(applied.session, sequence, hash) };
      });
    } catch (err) {
      if (err instanceof SimRejection) return { ok: false, status: err.status, code: err.code, view: err.view };
      throw err;
    }
  }

  /**
   * Списать квитанцию: она должна принадлежать кошельку, относиться к этому назначению и сумме.
   * Повторная подача той же подписи — 409, даже если первое действие уже прошло.
   */
  private async consumeReceipt(
    tx: SimQueryable,
    r: { signature: string; wallet: string; purpose: number; cr: number; requestId: string; sequence: number },
  ): Promise<void> {
    const found = await tx.query<{ owner_wallet: string; cluster: string; amount_micro: string; purpose: number }>(
      `SELECT owner_wallet, cluster, amount_micro::text, purpose
         FROM game_ops.colony_potato_spends WHERE signature = $1`,
      [r.signature],
    );
    const receipt = found.rows[0];
    if (!receipt) throw new SimRejection(422, "RECEIPT_NOT_FOUND");
    const expectedMicro = BigInt(r.cr) * MICRO_PER_CR;
    if (receipt.owner_wallet !== r.wallet || receipt.cluster !== this.options.cluster
      || receipt.purpose !== r.purpose || BigInt(receipt.amount_micro) !== expectedMicro) {
      throw new SimRejection(422, "RECEIPT_MISMATCH");
    }
    const used = await tx.query<{ signature: string }>(
      `SELECT signature FROM game_ops.colony_spend_consumptions WHERE signature = $1`,
      [r.signature],
    );
    if (used.rows[0]) throw new SimRejection(409, "RECEIPT_USED");
    await tx.query(
      `INSERT INTO game_ops.colony_spend_consumptions
         (signature, owner_wallet, cluster, request_id, sim_sequence)
       VALUES ($1, $2, $3, $4, $5)`,
      [r.signature, r.wallet, this.options.cluster, r.requestId, r.sequence],
    );
  }

  /** Загрузка сеанса под блокировкой строки: снимок + проигрывание журнала + проверка хеша. */
  private async load(tx: SimQueryable, wallet: string): Promise<{
    session: SimSession;
    sequence: number;
    snapshotSequence: number;
    snapshotText: string;
    stateHash: string;
  }> {
    await tx.query(
      `INSERT INTO game_ops.colony_sim_sessions
         (owner_wallet, cluster, sequence, snapshot_sequence, snapshot, state_hash, engine_version)
       VALUES ($1, $2, 0, 0, $3, $4, $5)
       ON CONFLICT (owner_wallet) DO NOTHING`,
      [wallet, this.options.cluster, serializeSession(freshSession()), sha256(serializeSession(freshSession())), ENGINE_VERSION],
    );
    const rows = await tx.query<SessionRow>(
      `SELECT sequence::text, snapshot_sequence::text, snapshot, state_hash
         FROM game_ops.colony_sim_sessions WHERE owner_wallet = $1 FOR UPDATE`,
      [wallet],
    );
    const row = rows.rows[0];
    if (!row) throw new Error("colony_sim_sessions row vanished");
    const sequence = Number(row.sequence);
    const snapshotSequence = Number(row.snapshot_sequence);
    let session = JSON.parse(row.snapshot) as SimSession;

    if (sequence > snapshotSequence) {
      const journal = await tx.query<JournalRow>(
        `SELECT sequence::text, action, state_hash, engine_version
           FROM game_ops.colony_sim_actions
          WHERE owner_wallet = $1 AND sequence > $2 ORDER BY sequence`,
        [wallet, snapshotSequence],
      );
      for (const entry of journal.rows) {
        if (entry.engine_version !== ENGINE_VERSION) throw new SimRejection(503, "ENGINE_VERSION_MISMATCH");
        const action = parseSimAction(entry.action);
        const replayed = action ? applyAction(session, action) : null;
        if (!replayed || !replayed.ok) throw new SimRejection(503, "REPLAY_FAILED");
        session = replayed.session;
        if (sha256(serializeSession(session)) !== entry.state_hash) throw new SimRejection(503, "REPLAY_HASH_MISMATCH");
      }
    }
    const stateHash = sha256(serializeSession(session));
    if (stateHash !== row.state_hash) throw new SimRejection(503, "REPLAY_HASH_MISMATCH");
    return { session, sequence, snapshotSequence, snapshotText: row.snapshot, stateHash };
  }
}

function viewOf(session: SimSession, sequence: number, stateHash: string): SimView {
  return { sequence, state: session.state, scenario: session.scenario, engineVersion: ENGINE_VERSION, stateHash };
}

/** Сравнение действий для идемпотентности: канонический JSON разобранного действия. */
function canonicalAction(value: unknown): string {
  return JSON.stringify(parseSimAction(value) as SimAction | null);
}
