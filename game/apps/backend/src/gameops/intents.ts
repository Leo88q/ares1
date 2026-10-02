/**
 * Интенты выплат: единственное место, где офчейн-состояние опережает цепь.
 *
 * Инварианты (продублированы схемой и триггерами — код не единственная защита):
 *   - идемпотентность по (recipient_ata, nonce): повторный вызов возвращает
 *     существующий интент, а не создаёт второй (`reused: true`);
 *   - денежные поля неизменяемы после создания (триггер INTENT_IMMUTABLE_FIELD);
 *   - допустимые переходы: pending → submitted|failed|expired,
 *     submitted → confirmed|failed|expired; терминальные — навсегда;
 *   - подпись проставляется один раз и только вместе с переходом в submitted.
 */
import type { Client, Pool } from './pool.js';
import { withTransaction, query } from './pool.js';
import { GameOpsError } from './errors.js';

export interface CreateIntentInput {
  recipientAta: string;
  amountMicro: bigint;
  nonce: bigint;
  reason: string;
  actor: string;
  ttlSeconds?: number;
}

export interface IntentRow {
  id: string;
  recipient_ata: string;
  amount_micro: string;
  nonce: string;
  reason: string;
  actor: string;
  state: 'pending' | 'submitted' | 'confirmed' | 'failed' | 'expired';
  signature: string | null;
  slot: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;
const MAX_TTL_SECONDS = 30 * 24 * 3600;
const MAX_BATCH = 5_000;

export function assertIntentInput(input: CreateIntentInput): void {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.recipientAta)) {
    throw new GameOpsError('VALIDATION', 'recipientAta не похож на Solana-адрес');
  }
  if (input.amountMicro <= 0n || input.amountMicro > 1_000_000_000n) {
    throw new GameOpsError('VALIDATION', 'amountMicro должен быть больше 0 и не больше 1 000 000 000 (как в grant_reward_once)');
  }
  if (input.nonce < 0n) throw new GameOpsError('VALIDATION', 'nonce не может быть отрицательным');
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (ttl < 60 || ttl > MAX_TTL_SECONDS) {
    throw new GameOpsError('VALIDATION', `ttlSeconds должен быть в диапазоне 60..${MAX_TTL_SECONDS}`);
  }
  if (input.reason.trim().length < 3) throw new GameOpsError('VALIDATION', 'reason обязателен: без причины выплату нельзя расследовать');
  if (input.actor.trim().length < 3) throw new GameOpsError('VALIDATION', 'actor обязателен');
}

/** Идемпотентное создание: конфликт по (получатель, nonce) — это повтор, не ошибка. */
export async function createIntent(pool: Pool, input: CreateIntentInput): Promise<{ id: string; state: string; reused: boolean }> {
  assertIntentInput(input);
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  return withTransaction(pool, input.actor, async client => {
    const inserted = await client.query<{ id: string; state: string }>(
      `INSERT INTO game_ops.reward_intents (recipient_ata, amount_micro, nonce, reason, actor, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
       ON CONFLICT (recipient_ata, nonce) DO NOTHING
       RETURNING id, state`,
      [input.recipientAta, input.amountMicro.toString(), input.nonce.toString(), input.reason.trim(), input.actor, ttl],
    );
    if (inserted.rows[0]) return { ...inserted.rows[0], reused: false };
    const existing = await client.query<{ id: string; state: string }>(
      'SELECT id, state FROM game_ops.reward_intents WHERE recipient_ata = $1 AND nonce = $2',
      [input.recipientAta, input.nonce.toString()],
    );
    if (!existing.rows[0]) throw new GameOpsError('UNEXPECTED', 'Конфликт без существующей строки', undefined, 500);
    return { ...existing.rows[0], reused: true };
  });
}

/**
 * Пакетное создание (для кампаний и нагрузочных прогонов): один INSERT на пачку
 * вместо N round-trip. Побочный эффект тот же — каждое создание попадает в аудит
 * триггером, поэтому «массово и незаметно» не получится.
 */
export async function createIntentsBatch(
  pool: Pool,
  inputs: readonly CreateIntentInput[],
  actor: string,
): Promise<{ created: number; reused: number; ids: string[] }> {
  if (!inputs.length) return { created: 0, reused: 0, ids: [] };
  if (inputs.length > MAX_BATCH) {
    throw new GameOpsError('VALIDATION', `Пачка не больше ${MAX_BATCH} интентов за вызов`);
  }
  inputs.forEach(assertIntentInput);
  return withTransaction(pool, actor, async client => {
    const ids: string[] = [];
    for (let offset = 0; offset < inputs.length; offset += 1000) {
      const chunk = inputs.slice(offset, offset + 1000);
      const result = await client.query<{ id: string }>(
        `INSERT INTO game_ops.reward_intents (recipient_ata, amount_micro, nonce, reason, actor, expires_at)
         SELECT r, a::bigint, n::bigint, rs, $5, now() + make_interval(secs => t)
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $6::int[]) AS batch(r, a, n, rs, t)
         ON CONFLICT (recipient_ata, nonce) DO NOTHING
         RETURNING id`,
        [
          chunk.map(i => i.recipientAta),
          chunk.map(i => i.amountMicro.toString()),
          chunk.map(i => i.nonce.toString()),
          chunk.map(i => i.reason.trim()),
          actor,
          chunk.map(i => i.ttlSeconds ?? DEFAULT_TTL_SECONDS),
        ],
      );
      ids.push(...result.rows.map(row => row.id));
    }
    return { created: ids.length, reused: inputs.length - ids.length, ids };
  });
}

const TERMINAL: ReadonlySet<string> = new Set(['confirmed', 'failed', 'expired']);

async function transition(
  pool: Pool,
  id: string,
  actor: string,
  sql: string,
  params: unknown[],
  allowedFrom: readonly string[],
): Promise<IntentRow> {
  return withTransaction(pool, actor, async client => {
    const updated = await client.query<IntentRow>(sql, params);
    if (updated.rows[0]) return updated.rows[0];
    const current = await client.query<{ state: string }>('SELECT state FROM game_ops.reward_intents WHERE id = $1', [id]);
    if (!current.rows[0]) throw new GameOpsError('INTENT_NOT_FOUND', `Интент ${id} не найден`, undefined, 404);
    const state = current.rows[0].state;
    if (TERMINAL.has(state)) {
      throw new GameOpsError('INVALID_TRANSITION', `Интент ${id} уже в терминальном состоянии ${state}`, undefined, 409);
    }
    throw new GameOpsError('INVALID_TRANSITION', `Переход из ${state} в этом вызове недопустим (ожидалось из: ${allowedFrom.join(', ')})`, undefined, 409);
  });
}

/** После отправки транзакции подписантом. Подпись фиксируется навсегда. */
export async function markSubmitted(pool: Pool, input: { id: string; signature: string; actor: string }): Promise<IntentRow> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(input.signature)) {
    throw new GameOpsError('VALIDATION', 'signature не похожа на base58-подпись транзакции');
  }
  return transition(
    pool, input.id, input.actor,
    `UPDATE game_ops.reward_intents SET state = 'submitted', signature = $2
     WHERE id = $1 AND state = 'pending' RETURNING *`,
    [input.id, input.signature], ['pending'],
  );
}

/** Подтверждение: только после финализированного события цепи (индексатор/аудит). */
export async function markConfirmed(pool: Pool, input: { id: string; slot: bigint; signature: string; actor: string }): Promise<IntentRow> {
  return transition(
    pool, input.id, input.actor,
    `UPDATE game_ops.reward_intents SET state = 'confirmed', slot = $3
     WHERE id = $1 AND state = 'submitted' AND signature = $2 RETURNING *`,
    [input.id, input.signature, input.slot.toString()], ['submitted'],
  );
}

export async function markFailed(pool: Pool, input: { id: string; failureCode: string; actor: string }): Promise<IntentRow> {
  if (!/^[A-Z0-9_]{3,40}$/.test(input.failureCode)) {
    throw new GameOpsError('VALIDATION', 'failureCode должен состоять из A-Z, 0-9 и _ (3..40)');
  }
  return transition(
    pool, input.id, input.actor,
    `UPDATE game_ops.reward_intents SET state = 'failed', failure_code = $2
     WHERE id = $1 AND state IN ('pending','submitted') RETURNING *`,
    [input.id, input.failureCode], ['pending', 'submitted'],
  );
}

/** Протухание: pending-интент, который подписант не забрал вовремя. */
export async function expireStale(pool: Pool, actor: string, batchSize = 500): Promise<{ expired: number }> {
  return withTransaction(pool, actor, async client => {
    const result = await client.query(
      `UPDATE game_ops.reward_intents SET state = 'expired'
       WHERE id IN (
         SELECT id FROM game_ops.reward_intents
         WHERE state = 'pending' AND expires_at <= now()
         ORDER BY expires_at
         LIMIT $1
       ) RETURNING id`,
      [batchSize],
    );
    return { expired: result.rowCount ?? 0 };
  });
}

export async function listActionable(pool: Pool, limit = 100): Promise<Array<Record<string, unknown>>> {
  return query(pool, 'SELECT * FROM game_ops.reward_intents_actionable ORDER BY created_at LIMIT $1', [limit]);
}

export async function getIntent(pool: Pool, id: string): Promise<IntentRow | null> {
  const rows = await query<IntentRow>(pool, 'SELECT * FROM game_ops.reward_intents WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function listIntents(pool: Pool, state: string | null, limit = 100): Promise<IntentRow[]> {
  if (state) return query<IntentRow>(pool, 'SELECT * FROM game_ops.reward_intents WHERE state = $1 ORDER BY created_at DESC LIMIT $2', [state, limit]);
  return query<IntentRow>(pool, 'SELECT * FROM game_ops.reward_intents ORDER BY created_at DESC LIMIT $1', [limit]);
}

export type { Client };
