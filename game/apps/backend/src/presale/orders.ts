/**
 * Заказы Phase 1: резерв места, привязка платежа, выдача.
 *
 * Три решения, которые нельзя менять, не подумав:
 *
 * 1. Гейт тиража — это `SELECT ... FOR UPDATE` по строке тиража, а не COUNT(*).
 *    Блокировка строки сериализует одновременные резервы одного тиража, поэтому
 *    oversell невозможен даже при сотне параллельных запросов.
 *
 * 2. `order_no` — `MAX(order_no)+1`, а НЕ `reserved_count+1`. Счётчик мест
 *    убывает, когда бронь истекает, и «reserved_count+1» выдал бы номер,
 *    который уже занят живым заказом (unique-констрейнт упал бы в лучшем
 *    случае, а в худшем платёж привязался бы не к тому заказу).
 *
 * 3. Счётчик мест ведёт триггер (0005), а не этот код. Здесь мы его только
 *    читаем — под блокировкой, чтобы принять решение.
 */
import type { Pool } from '../gameops/pool.js';
import { withTransaction, query } from '../gameops/pool.js';
import { GameOpsError } from '../gameops/errors.js';
import {
  expectedUnits, findPack, validatePackDeliverability, packPotatoMicro,
  assertDustIsNegligible, currencySpec,
} from './catalog.js';
import type { Currency } from './catalog.js';

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Почта хранится только для уведомления о выдаче — обрезать бессмысленно длинное. */
const MAX_EMAIL_LENGTH = 254;

export type OrderState =
  | 'reserved' | 'payment_seen' | 'paid' | 'delivered'
  | 'refunded' | 'expired' | 'cancelled';

export interface RunRow {
  run_id: string;
  pack_id: string;
  currency: Currency;
  price_units: string;
  cap: number;
  reserved_count: number;
  is_open: boolean;
  treasury: string;
  reserve_minutes: number;
  started_at: string;
  closed_at: string | null;
}

export interface OrderRow {
  id: string;
  run_id: string;
  order_no: number;
  pack_id: string;
  price_units: string;
  payer_wallet: string;
  payer_email: string | null;
  state: OrderState;
  tx_signature: string | null;
  received_units: string | null;
  paid_slot: string | null;
  intent_id: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  reserved_until: string;
  paid_at: string | null;
  delivered_at: string | null;
  refunded_at: string | null;
}

export function assertWallet(value: string, field = 'payerWallet'): void {
  if (!BASE58_ADDRESS.test(value)) {
    throw new GameOpsError('VALIDATION', `${field} не похож на Solana-адрес`);
  }
}

export function assertSignature(value: string, field = 'signature'): void {
  if (!BASE58_SIGNATURE.test(value)) {
    throw new GameOpsError('VALIDATION', `${field} не похожа на base58-подпись транзакции`);
  }
}

/**
 * Email необязателен: покупатель вправе не давать почту и следить за статусом
 * по номеру заказа. Но если дал — обязан быть похож на email, иначе уведомление
 * о выдаче уйдёт в никуда, а окно клейма всего 15 минут.
 */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const email = String(value).trim().toLowerCase();
  if (!email) return null;
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new GameOpsError('VALIDATION', `email длиннее ${MAX_EMAIL_LENGTH} символов`);
  }
  if (!EMAIL.test(email)) throw new GameOpsError('VALIDATION', 'email не похож на адрес');
  return email;
}

/**
 * Открыть тираж. Проверяет состав пака ДО создания строки: продать набор,
 * который рельса выдачи физически не способна выдать, — значит собрать деньги
 * за невыполнимое обещание.
 */
export async function openRun(pool: Pool, input: {
  runId: string;
  packId: string;
  currency: Currency;
  priceUnits: bigint;
  cap: number;
  treasury: string;
  reserveMinutes?: number;
  actor: string;
}): Promise<RunRow> {
  const pack = findPack(input.packId);
  if (!pack) throw new GameOpsError('VALIDATION', `Неизвестный пак: ${input.packId}`);
  const problems = validatePackDeliverability(pack);
  if (problems.length) {
    throw new GameOpsError('VALIDATION', `Пак ${input.packId} невыдаваем: ${problems.join('; ')}`);
  }
  // Валюта проверяется до цены: именно она определяет, что значит priceUnits.
  // Для SKR treasury — это ТОКЕН-аккаунт (ATA), для SOL — кошелёк.
  const spec = currencySpec(input.currency);
  if (input.priceUnits <= 0n) {
    throw new GameOpsError('VALIDATION', `priceUnits должен быть больше 0 (в атомах ${spec.label})`);
  }
  if (!Number.isInteger(input.cap) || input.cap <= 0) {
    throw new GameOpsError('VALIDATION', 'cap должен быть целым больше 0');
  }
  // Пыль = order_no базовых единиц. Если цена сопоставима с cap, «пыль»
  // превращается в скидку, и соседние заказы начинают отличаться на заметную
  // покупателю сумму — проверяем до создания тиража, а не после первой продажи.
  assertDustIsNegligible(input.currency, input.priceUnits, input.cap);
  assertWallet(input.treasury, input.currency === 'skr' ? 'treasury (ATA токена SKR)' : 'treasury');

  const rows = await withTransaction<RunRow[]>(pool, input.actor, async client => {
    const inserted = await client.query<RunRow>(
      `INSERT INTO game_ops.presale_runs
         (run_id, pack_id, currency, price_units, cap, treasury, reserve_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, coalesce($7, 30))
       ON CONFLICT (run_id) DO NOTHING
       RETURNING *`,
      [input.runId, input.packId, input.currency, input.priceUnits.toString(), input.cap,
       input.treasury, input.reserveMinutes ?? null],
    );
    return inserted.rows;
  });
  if (!rows[0]) throw new GameOpsError('VALIDATION', `Тираж ${input.runId} уже существует`, undefined, 409);
  return rows[0];
}

export interface ReserveResult {
  order: OrderRow;
  /** Сколько базовых единиц перевести: база тиража + номер заказа. */
  payUnits: bigint;
  /** В чём платить: для SKR покупатель шлёт токен на ATA, а не лампорты. */
  currency: Currency;
  treasury: string;
  /** Сколько секунд осталось на оплату. */
  reserveSecondsLeft: number;
  remainingAfterReserve: number;
}

/**
 * Занять место. Деньги на этом шаге НЕ принимаются — создаётся намерение.
 * Если тираж закрыт или мест нет, заказа не возникает вовсе: форма обязана
 * закрываться до приёма денег, а не после.
 */
export async function reserveOrder(pool: Pool, input: {
  runId: string;
  payerWallet: string;
  payerEmail?: string | null;
  actor: string;
}): Promise<ReserveResult> {
  assertWallet(input.payerWallet);
  const email = normalizeEmail(input.payerEmail);

  return withTransaction<ReserveResult>(pool, input.actor, async client => {
    const runs = await client.query<RunRow>(
      `SELECT * FROM game_ops.presale_runs WHERE run_id = $1 FOR UPDATE`,
      [input.runId],
    );
    const run = runs.rows[0];
    if (!run) throw new GameOpsError('RUN_NOT_FOUND', `Тираж ${input.runId} не найден`, undefined, 404);
    if (!run.is_open) throw new GameOpsError('RUN_CLOSED', `Тираж ${input.runId} закрыт`, undefined, 409);
    if (run.reserved_count >= run.cap) {
      throw new GameOpsError('RUN_SOLD_OUT', `Тираж ${input.runId} распродан`, undefined, 409);
    }

    // Номер — строго монотонный: строка тиража заблокирована, параллельный
    // резерв сюда не попадёт, а заказы не удаляются, поэтому MAX корректен.
    const next = await client.query<{ next_no: number }>(
      `SELECT coalesce(max(order_no), 0) + 1 AS next_no
         FROM game_ops.presale_orders WHERE run_id = $1`,
      [input.runId],
    );
    const orderNo = next.rows[0]?.next_no ?? 1;

    const inserted = await client.query<OrderRow>(
      `INSERT INTO game_ops.presale_orders
         (run_id, order_no, pack_id, price_units, payer_wallet, payer_email, reserved_until)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7))
       RETURNING *`,
      [input.runId, orderNo, run.pack_id, run.price_units, input.payerWallet,
       email, run.reserve_minutes],
    );
    const order = inserted.rows[0];
    if (!order) throw new GameOpsError('UNEXPECTED', 'Заказ не создался', undefined, 500);

    return {
      order,
      payUnits: expectedUnits(BigInt(run.price_units), orderNo),
      currency: run.currency,
      treasury: run.treasury,
      reserveSecondsLeft: run.reserve_minutes * 60,
      remainingAfterReserve: run.cap - (run.reserved_count + 1),
    };
  });
}

/** Переводит заказ в payment_seen: покупатель прислал подпись, цепь ещё не проверена. */
export async function attachPayment(pool: Pool, input: {
  runId: string;
  orderNo: number;
  signature: string;
  actor: string;
}): Promise<OrderRow> {
  assertSignature(input.signature);
  return withTransaction<OrderRow>(pool, input.actor, async client => {
    const updated = await client.query<OrderRow>(
      `UPDATE game_ops.presale_orders
          SET state = 'payment_seen', tx_signature = $3
        WHERE run_id = $1 AND order_no = $2 AND state = 'reserved'
        RETURNING *`,
      [input.runId, input.orderNo, input.signature],
    );
    if (updated.rows[0]) return updated.rows[0];
    const current = await client.query<{ state: OrderState; id: string }>(
      'SELECT id, state FROM game_ops.presale_orders WHERE run_id = $1 AND order_no = $2',
      [input.runId, input.orderNo],
    );
    const row = current.rows[0];
    if (!row) throw new GameOpsError('ORDER_NOT_FOUND', `Заказ №${input.orderNo} не найден`, undefined, 404);
    throw new GameOpsError('INVALID_TRANSITION',
      `Заказ №${input.orderNo} в состоянии ${row.state}: платёж принимается только у reserved`, undefined, 409);
  });
}

/** Платёж подтверждён по финализированной транзакции. */
export async function confirmPayment(pool: Pool, input: {
  id: string;
  receivedUnits: bigint;
  slot: bigint;
  actor: string;
}): Promise<OrderRow> {
  return withTransaction<OrderRow>(pool, input.actor, async client => {
    const updated = await client.query<OrderRow>(
      `UPDATE game_ops.presale_orders
          SET state = 'paid', received_units = $2, paid_slot = $3, paid_at = now()
        WHERE id = $1 AND state = 'payment_seen'
        RETURNING *`,
      [input.id, input.receivedUnits.toString(), input.slot.toString()],
    );
    if (updated.rows[0]) return updated.rows[0];
    const current = await client.query<{ state: OrderState }>(
      'SELECT state FROM game_ops.presale_orders WHERE id = $1', [input.id],
    );
    if (!current.rows[0]) throw new GameOpsError('ORDER_NOT_FOUND', `Заказ ${input.id} не найден`, undefined, 404);
    throw new GameOpsError('INVALID_TRANSITION',
      `Заказ ${input.id} в состоянии ${current.rows[0].state}: подтвердить можно только payment_seen`, undefined, 409);
  });
}

/**
 * Выдача состоялась. `intentId` — ссылка на game_ops.reward_intents: одна
 * выдача на заказ, связь фиксируется навсегда (триггер PRESALE_INTENT_IMMUTABLE).
 */
export async function markDelivered(pool: Pool, input: {
  id: string;
  intentId: bigint;
  actor: string;
}): Promise<OrderRow> {
  return withTransaction<OrderRow>(pool, input.actor, async client => {
    const updated = await client.query<OrderRow>(
      `UPDATE game_ops.presale_orders
          SET state = 'delivered', intent_id = $2, delivered_at = now()
        WHERE id = $1 AND state = 'paid'
        RETURNING *`,
      [input.id, input.intentId.toString()],
    );
    if (updated.rows[0]) return updated.rows[0];
    const current = await client.query<{ state: OrderState }>(
      'SELECT state FROM game_ops.presale_orders WHERE id = $1', [input.id],
    );
    if (!current.rows[0]) throw new GameOpsError('ORDER_NOT_FOUND', `Заказ ${input.id} не найден`, undefined, 404);
    throw new GameOpsError('INVALID_TRANSITION',
      `Заказ ${input.id} в состоянии ${current.rows[0].state}: выдача фиксируется только у paid`, undefined, 409);
  });
}

export async function refundOrder(pool: Pool, input: {
  id: string;
  reason: string;
  actor: string;
}): Promise<OrderRow> {
  if (input.reason.trim().length < 3) {
    throw new GameOpsError('VALIDATION', 'Причина возврата обязательна: без неё возврат не расследовать');
  }
  return withTransaction<OrderRow>(pool, input.actor, async client => {
    const updated = await client.query<OrderRow>(
      `UPDATE game_ops.presale_orders
          SET state = 'refunded', refunded_at = now(),
              failure_code = 'REFUND_' || upper(left(md5($2), 4))
        WHERE id = $1 AND state IN ('payment_seen','paid')
        RETURNING *`,
      [input.id, input.reason],
    );
    if (updated.rows[0]) return updated.rows[0];
    const current = await client.query<{ state: OrderState }>(
      'SELECT state FROM game_ops.presale_orders WHERE id = $1', [input.id],
    );
    if (!current.rows[0]) throw new GameOpsError('ORDER_NOT_FOUND', `Заказ ${input.id} не найден`, undefined, 404);
    throw new GameOpsError('INVALID_TRANSITION',
      `Заказ ${input.id} в состоянии ${current.rows[0].state}: возврат возможен из payment_seen или paid`, undefined, 409);
  });
}

/**
 * Истёкшие брони. Освобождает места в тираже (триггер уменьшает reserved_count),
 * поэтому без этого шага cap выкупается брошенными заказами.
 */
export async function expireStaleReservations(
  pool: Pool, actor: string, batchSize = 500,
): Promise<{ expired: number }> {
  return withTransaction(pool, actor, async client => {
    const result = await client.query(
      `UPDATE game_ops.presale_orders SET state = 'expired'
        WHERE id IN (
          SELECT id FROM game_ops.presale_orders
           WHERE state = 'reserved' AND reserved_until <= now()
           ORDER BY reserved_until
           LIMIT $1
        ) RETURNING id`,
      [batchSize],
    );
    return { expired: result.rowCount ?? 0 };
  });
}

/** Публичный статус: ни email, ни полного кошелька. */
export async function getOrderPublic(pool: Pool, runId: string, orderNo: number) {
  const rows = await query<Record<string, unknown>>(
    pool,
    `SELECT * FROM game_ops.presale_orders_public WHERE run_id = $1 AND order_no = $2`,
    [runId, orderNo],
  );
  return rows[0] ?? null;
}

export interface RunStatus {
  run_id: string;
  pack_id: string;
  currency: Currency;
  cap: number;
  reserved_count: number;
  remaining: number;
  is_open: boolean;
  sold_out: boolean;
  price_units: string;
  /** Сколько базовых единиц в одной «человеческой» единице валюты (10^9 или 10^6). */
  units_per_whole: string;
  /** Сколько POTATO выдаётся за пак — покупатель видит состав, а не абстракцию. */
  pack_potato_micro: string;
}

/**
 * Публичный вид тиража для покупателя: camelCase и без служебных полей.
 *
 * Wire-формат закреплён тестом. Раньше route отдавал доменную snake_case-структуру,
 * а баннер лендинга читал camelCase: счётчик показывал «NaN», цена — undefined.
 * Публичный контракт должен быть явным, а не совпадением имён.
 */
export function publicRunStatus(status: RunStatus) {
  return {
    runId: status.run_id,
    packId: status.pack_id,
    currency: status.currency,
    cap: status.cap,
    reservedCount: status.reserved_count,
    remaining: status.remaining,
    isOpen: status.is_open,
    soldOut: status.sold_out,
    priceUnits: status.price_units,
    unitsPerWhole: status.units_per_whole,
    packPotatoMicro: status.pack_potato_micro,
  };
}

export async function getRunStatus(pool: Pool, runId: string): Promise<RunStatus | null> {
  const rows = await query<RunRow>(pool, 'SELECT * FROM game_ops.presale_runs WHERE run_id = $1', [runId]);
  const run = rows[0];
  if (!run) return null;
  const pack = findPack(run.pack_id);
  return {
    run_id: run.run_id,
    pack_id: run.pack_id,
    currency: run.currency,
    cap: run.cap,
    reserved_count: run.reserved_count,
    remaining: Math.max(0, run.cap - run.reserved_count),
    is_open: run.is_open,
    sold_out: run.reserved_count >= run.cap,
    price_units: run.price_units,
    units_per_whole: currencySpec(run.currency).unitsPerWhole.toString(),
    pack_potato_micro: (pack ? packPotatoMicro(pack) : 0n).toString(),
  };
}

/** Очередь на выдачу: оплачено, но ещё не выдано. */
export async function listPendingDelivery(pool: Pool, limit = 100): Promise<OrderRow[]> {
  return query<OrderRow>(
    pool,
    `SELECT * FROM game_ops.presale_orders WHERE state = 'paid' ORDER BY paid_at NULLS LAST, id LIMIT $1`,
    [limit],
  );
}

/** Всё, что требует взгляда оператора: платежи с расхождением, зависшие брони. */
export async function listNeedsAttention(pool: Pool, limit = 100): Promise<OrderRow[]> {
  return query<OrderRow>(
    pool,
    `SELECT * FROM game_ops.presale_orders
      WHERE state IN ('payment_seen','refunded')
         OR (state = 'reserved' AND reserved_until <= now())
      ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
}
