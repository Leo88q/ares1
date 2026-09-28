/**
 * Сверка офчейн-зеркала с цепью: единственное доказательство, что журнал
 * наград не разошёлся с ончейн-учётом (granted − ledger = drift).
 *
 * Правила:
 *   - drift != 0 — инцидент, а не «предупреждение»: readiness уходит в fail-closed
 *     (readiness.ts), эпоха не печётся, пока расхождение не объяснено;
 *   - строки сверки append-only: «обнулить» историю расхождений нельзя, можно
 *     только добавить новую строку с drift = 0 и ссылкой на инцидент;
 *   - сумма журнала берётся из БД (не из памяти процесса), а grants — из
 *     финализированного ончейн-состояния, переданного вызывающим кодом.
 */
import { GameOpsError } from './errors.js';
import { query, withTransaction, type Client, type Pool } from './pool.js';

export interface ReconciliationRow {
  id: string;
  stream_id: string;
  finalized_slot: string;
  epoch_id: string;
  granted_micro: string;
  ledger_micro: string;
  drift_micro: string;
  checked_at: string;
}

export interface RecordReconciliationInput {
  /** Поток сверки, например `epoch:41` или `reward:mainnet`. */
  streamId: string;
  finalizedSlot: bigint;
  epochId: bigint;
  /** Сумма ончейн-наград за эпоху (атомарные единицы токена). */
  grantedMicro: bigint;
  /** Нижняя граница окна (не включается): слот, до которого учли в прошлой сверке. */
  fromSlot: bigint;
  /** Ограничение журнала: только эта цепочка (по умолчанию `reward`). */
  chainId?: string;
  actor: string;
}

/**
 * Сумма зеркала за окно слотов (fromSlot, finalizedSlot]. Источник истины —
 * журнал: сумма берётся из БД, а не из памяти процесса, поэтому сверка
 * проверяет именно сохранённые данные. Окно по слотам (а не по времени) выбрано
 * потому, что слот — монотонный идентификатор ончейн-факта, а время в разных
 * источниках расходится.
 */
export async function ledgerSumInSlotWindow(client: Client, chainId: string, fromSlot: bigint, toSlot: bigint): Promise<bigint> {
  const rows = await client.query<{ total: string | null }>(
    `SELECT coalesce(sum(amount_micro), 0)::text AS total
     FROM game_ops.reward_ledger
     WHERE chain_id = $1 AND slot > $2 AND slot <= $3`,
    [chainId, fromSlot.toString(), toSlot.toString()],
  );
  return BigInt(rows.rows[0]?.total ?? '0');
}

export async function recordReconciliation(pool: Pool, input: RecordReconciliationInput): Promise<ReconciliationRow> {
  if (input.grantedMicro < 0n) throw new GameOpsError('VALIDATION', 'grantedMicro не может быть отрицательным');
  if (input.finalizedSlot < 0n || input.epochId < 0n || input.fromSlot < 0n) {
    throw new GameOpsError('VALIDATION', 'slot/epochId не могут быть отрицательными');
  }
  if (input.fromSlot > input.finalizedSlot) throw new GameOpsError('VALIDATION', 'fromSlot не может быть больше finalizedSlot');
  const chainId = input.chainId ?? 'reward';
  return withTransaction(pool, input.actor, async client => {
    const ledgerMicro = await ledgerSumInSlotWindow(client, chainId, input.fromSlot, input.finalizedSlot);
    const drift = input.grantedMicro - ledgerMicro;
    const inserted = await client.query<ReconciliationRow>(
      `INSERT INTO game_ops.chain_reconciliation
         (stream_id, finalized_slot, epoch_id, granted_micro, ledger_micro, drift_micro)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.streamId,
        input.finalizedSlot.toString(),
        input.epochId.toString(),
        input.grantedMicro.toString(),
        ledgerMicro.toString(),
        drift.toString(),
      ],
    );
    return inserted.rows[0]!;
  });
}

/** Последняя сверка по каждому потоку (view с DISTINCT ON). */
export async function latestReconciliation(pool: Pool): Promise<ReconciliationRow[]> {
  return query<ReconciliationRow>(pool, 'SELECT * FROM game_ops.chain_reconciliation_latest ORDER BY stream_id');
}

export async function reconciliationHistory(pool: Pool, streamId: string, limit = 50): Promise<ReconciliationRow[]> {
  return query<ReconciliationRow>(
    pool,
    'SELECT * FROM game_ops.chain_reconciliation WHERE stream_id = $1 ORDER BY checked_at DESC LIMIT $2',
    [streamId, Math.min(Math.max(limit, 1), 1_000)],
  );
}

export interface DriftSummary {
  streams: number;
  driftingStreams: string[];
  totalDriftMicro: bigint;
  worstDriftMicro: bigint;
}

/** Сводка расхождений: используется readiness и алертами. */
export async function driftSummary(pool: Pool): Promise<DriftSummary> {
  const rows = await query<{ stream_id: string; drift_micro: string }>(
    pool,
    'SELECT stream_id, drift_micro FROM game_ops.chain_reconciliation_latest WHERE drift_micro <> 0',
  );
  let total = 0n;
  let worst = 0n;
  const streams: string[] = [];
  for (const row of rows) {
    const drift = BigInt(row.drift_micro);
    streams.push(row.stream_id);
    total += drift;
    if (drift < 0n ? -drift > worst : drift > worst) worst = drift < 0n ? -drift : drift;
  }
  return { streams: rows.length, driftingStreams: streams, totalDriftMicro: total, worstDriftMicro: worst };
}
