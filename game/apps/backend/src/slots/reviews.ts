/**
 * Очередь ручного разбора платежей за слоты: «деньги списаны, слот не выдан».
 *
 * Ситуация возникает честно: покупатель оплатил слот 7..12, платёж прошёл
 * проверку (финализирован, ровно нужная сумма, правильный минт), а слот уже
 * занят другим кошельком. Выдавать чужой слот нельзя, терять деньги — тем
 * более. Поэтому платёж превращается в строку очереди с суммой и адресом,
 * которую оператор обязан закрыть ДОКАЗАТЕЛЬСТВОМ из цепи:
 *
 *   refunded  — есть подпись транзакции, в которой кошелёк покупателя получил
 *               ровно эту сумму в этом минте;
 *   regranted — покупателю выдан слот (та же проверка по записи владения);
 *   rejected  — оператор решил не возвращать (например, платёж-дубликат уже
 *               возвращённого) и обязан оставить заметку.
 *
 * Без подписи «вернули» не принимается ни в API, ни в БД (CHECK в 0014):
 * словесный отчёт оператора — не доказательство.
 */
import { GameOpsError } from '../gameops/errors.js';
import type { Pool } from '../gameops/pool.js';
import { query, withTransaction } from '../gameops/pool.js';
import { tokenInflow } from '../presale/verify.js';
import type { ChainTokenTransferView } from '../presale/verify.js';

export type ReviewStatus = 'pending' | 'refunded' | 'regranted' | 'rejected';
export type ReviewReason = 'SLOT_TAKEN_AFTER_VALID_PAYMENT';

export interface SlotPaymentReview {
  id: string;
  payment_signature: string;
  field_id: string;
  slot: number;
  wallet: string;
  mint: string;
  amount_units: string;
  reason: ReviewReason;
  status: ReviewStatus;
  created_at: string;
  resolved_at: string | null;
  resolution_signature: string | null;
  resolution_note: string | null;
}

const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/**
 * Идемпотентная запись: повторный запрос с той же подписью не создаёт вторую
 * строку (`ON CONFLICT DO NOTHING` по UNIQUE(payment_signature)).
 */
export async function recordSlotPaymentReview(pool: Pool, input: {
  paymentSignature: string;
  fieldId: string;
  slot: number;
  wallet: string;
  mint: string;
  amountUnits: bigint;
  reason?: ReviewReason;
  actor: string;
}): Promise<{ id: string; created: boolean }> {
  if (!BASE58_SIGNATURE.test(input.paymentSignature)) {
    throw new GameOpsError('VALIDATION', 'paymentSignature не похож на подпись транзакции');
  }
  if (!Number.isInteger(input.slot) || input.slot < 1 || input.slot > 12) {
    throw new GameOpsError('VALIDATION', 'slot должен быть 1..12');
  }
  if (input.amountUnits <= 0n) throw new GameOpsError('VALIDATION', 'amountUnits должен быть > 0');
  const reason: ReviewReason = input.reason ?? 'SLOT_TAKEN_AFTER_VALID_PAYMENT';
  return withTransaction(pool, input.actor, async client => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO game_ops.slot_payment_reviews
         (payment_signature, field_id, slot, wallet, mint, amount_units, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (payment_signature) DO NOTHING
       RETURNING id`,
      [
        input.paymentSignature, input.fieldId, input.slot, input.wallet,
        input.mint, input.amountUnits.toString(), reason,
      ],
    );
    if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM game_ops.slot_payment_reviews WHERE payment_signature = $1',
      [input.paymentSignature],
    );
    if (!existing.rows[0]) {
      // Строки нет, а вставка «не сработала» — так быть не может; честный 500.
      throw new GameOpsError('UNEXPECTED', 'Разбор не записался и не был найден', undefined, 500);
    }
    return { id: existing.rows[0].id, created: false };
  });
}

export async function getSlotPaymentReview(pool: Pool, id: string): Promise<SlotPaymentReview | null> {
  const rows = await query<SlotPaymentReview>(
    pool,
    'SELECT * FROM game_ops.slot_payment_reviews WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function listSlotPaymentReviews(
  pool: Pool,
  options: { status?: ReviewStatus | null; limit?: number } = {},
): Promise<SlotPaymentReview[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  if (options.status) {
    return query<SlotPaymentReview>(
      pool,
      `SELECT * FROM game_ops.slot_payment_reviews WHERE status = $1 ORDER BY created_at LIMIT $2`,
      [options.status, limit],
    );
  }
  return query<SlotPaymentReview>(
    pool,
    `SELECT * FROM game_ops.slot_payment_reviews
      ORDER BY (status = 'pending') DESC, created_at LIMIT $1`,
    [limit],
  );
}

export interface RefundPayoutCheck {
  ok: boolean;
  code?: 'NOT_FINALIZED' | 'TX_FAILED' | 'WALLET_NOT_INVOLVED' | 'MINT_NOT_INVOLVED' | 'AMOUNT_MISMATCH';
  received: bigint;
  detail: string;
}

/**
 * Проверка доказательства возврата: покупатель получил ровно `amount` в `mint`,
 * транзакция финализирована и не упала. Чистая функция — покрывается без ноды.
 */
export function verifyRefundPayout(
  view: ChainTokenTransferView,
  expect: { wallet: string; mint: string; amount: bigint },
): RefundPayoutCheck {
  if (view.confirmation !== 'finalized') {
    return { ok: false, code: 'NOT_FINALIZED', received: 0n, detail: `статус ${view.confirmation}, нужен finalized` };
  }
  if (view.err !== null && view.err !== undefined) {
    return { ok: false, code: 'TX_FAILED', received: 0n, detail: `транзакция завершилась ошибкой: ${JSON.stringify(view.err)}` };
  }
  const inflow = tokenInflow(view, expect.wallet, expect.mint);
  if (!inflow) {
    return {
      ok: false, code: 'WALLET_NOT_INVOLVED', received: 0n,
      detail: `у кошелька ${expect.wallet} нет баланса в минте ${expect.mint} в этой транзакции`,
    };
  }
  if (inflow.received !== expect.amount) {
    return {
      ok: false, code: inflow.received <= 0n ? 'WALLET_NOT_INVOLVED' : 'AMOUNT_MISMATCH',
      received: inflow.received,
      detail: `покупатель получил ${inflow.received}, ожидалось ровно ${expect.amount}`,
    };
  }
  return { ok: true, received: inflow.received, detail: 'возврат подтверждён цепью' };
}

export interface ResolveReviewInput {
  id: string;
  action: 'refund' | 'regrant' | 'reject';
  /** Подпись транзакции-доказательства; обязательна для refund/regrant. */
  signature?: string | null;
  note?: string | null;
  actor: string;
}

const ACTIONS: Record<ResolveReviewInput['action'], ReviewStatus> = {
  refund: 'refunded',
  regrant: 'regranted',
  reject: 'rejected',
};

export async function resolveSlotPaymentReview(
  pool: Pool,
  input: ResolveReviewInput,
): Promise<SlotPaymentReview> {
  const status = ACTIONS[input.action];
  if (!status) throw new GameOpsError('VALIDATION', `Неизвестное действие: ${String(input.action)}`);
  const signature = (input.signature ?? '').trim();
  if (status !== 'rejected' && !BASE58_SIGNATURE.test(signature)) {
    throw new GameOpsError('VALIDATION', `Действие ${input.action} требует подписи транзакции-доказательства`);
  }
  const note = (input.note ?? '').trim();
  if (status === 'rejected' && note.length < 3) {
    throw new GameOpsError('VALIDATION', 'Отказ от возврата требует заметки: без неё решение не расследовать');
  }
  return withTransaction(pool, input.actor, async client => {
    const updated = await client.query<SlotPaymentReview>(
      `UPDATE game_ops.slot_payment_reviews
          SET status = $2,
              resolved_at = now(),
              resolution_signature = $3,
              resolution_note = $4
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [input.id, status, status === 'rejected' ? null : signature, note || null],
    );
    if (updated.rows[0]) return updated.rows[0];
    const current = await client.query<{ status: ReviewStatus }>(
      'SELECT status FROM game_ops.slot_payment_reviews WHERE id = $1',
      [input.id],
    );
    if (!current.rows[0]) {
      throw new GameOpsError('ORDER_NOT_FOUND', `Разбор ${input.id} не найден`, undefined, 404);
    }
    throw new GameOpsError(
      'INVALID_TRANSITION',
      `Разбор ${input.id} уже закрыт (${current.rows[0].status})`,
      undefined,
      409,
    );
  });
}
