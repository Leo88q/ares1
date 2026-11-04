/**
 * ЕДИНСТВЕННОЕ место, где вычисляется «сколько мы ждём» и «какую транзакцию
 * ещё можно считать оплатой этого заказа».
 *
 * Почему отдельный модуль, а не две строки в обработчике: раньше ожидание
 * считалось в одном месте (`orders.ts` отдаёт покупателю `base + order_no`),
 * а проверялось в другом (`routes/presale.ts` брал `order.price_units`, то есть
 * базу без пыли). Из-за этого КАЖДЫЙ корректный платёж получал
 * `AMOUNT_OVERPAID` и уходил в ручной разбор. Разъехаться снова это не должно,
 * поэтому арифметика живёт здесь, покрыта тестами и вызывается из обоих мест.
 *
 * Инварианты:
 *   - `presale_runs.price_units` — БАЗА цены (без пыли), неизменяема триггером
 *     `presale_runs_guard`;
 *   - `presale_orders.price_units` — копия базы на момент резерва (тоже
 *     неизменяема), а `order_no` — пыль;
 *   - ожидание = base + order_no. Это ровно то, что покупатель получает в
 *     `payUnits` при резерве.
 *
 * Порог возраста привязан к ВРЕМЕНИ ЗАКАЗА, а не к моменту проверки. Плата
 * обязана быть сделана после создания заказа: перевод, случившийся до него, не
 * может быть оплатой этого заказа. Привязка к «сейчас минус час» выглядела бы
 * проще, но ломала бы отложенную верификацию (оператор запускает проверку
 * пачкой позже): корректные платежи получали бы TOO_OLD и уходили в ручной
 * разбор без возможности подтвердить.
 *
 * Расхождение между базой тиража и базой заказа — не «нормальный случай», а
 * признак правки данных в обход триггеров: такой заказ нельзя ни засчитать
 * автоматически, ни тихо округлить. Поэтому это отдельная ошибка, которую
 * маршрут превращает в отказ с ручным разбором.
 */
import { expectedUnits } from './catalog.js';

/**
 * Допуск на расхождение часов: blockTime транзакции ставит валидатор, а
 * `created_at` — сервер приложения. Платёж, отправленный сразу после резерва,
 * обязан проходить даже при разнице в пару минут.
 */
export const PRESALE_PAYMENT_CLOCK_SKEW_SECONDS = 300;

/**
 * Запасной порог, когда время создания заказа неизвестно (старая строка/тест):
 * ровно тот же смысл, что у слотов.
 */
export const PRESALE_PAYMENT_MAX_AGE_SECONDS = 3_600;

export type PaymentExpectationErrorCode = 'ORDER_RUN_PRICE_MISMATCH' | 'INVALID_ORDER_NUMBER' | 'INVALID_ORDER_TIME';

export class PaymentExpectationError extends Error {
  constructor(readonly code: PaymentExpectationErrorCode, message: string) {
    super(message);
    this.name = 'PaymentExpectationError';
  }
}

export interface OrderForExpectation {
  price_units: string;
  order_no: number;
  /** timestamptz из БД: Date или ISO-строка. Необязательно — есть запасной порог. */
  created_at?: string | Date | null;
}

export interface RunForExpectation {
  price_units: string;
}

export interface PaymentExpectation {
  /** Ровно столько базовых единиц должен получить казначейский аккаунт. */
  expected: bigint;
  /** Транзакции с blockTime раньше этого значения не принимаются. */
  minBlockTime: bigint;
  /** База цены тиража — для диагностики и логов, не для сравнения сумм. */
  base: bigint;
  /** Откуда взялся порог: полезно в аудите и при разборе инцидента. */
  minBlockTimeSource: 'order_created_at' | 'max_age';
}

export function buildPaymentExpectation(input: {
  order: OrderForExpectation;
  run: RunForExpectation;
  /** Unix-время в секундах; передаётся явно, чтобы тест был детерминированным. */
  nowSeconds: number;
  maxAgeSeconds?: number;
}): PaymentExpectation {
  const base = BigInt(input.run.price_units);
  const orderBase = BigInt(input.order.price_units);
  if (orderBase !== base) {
    throw new PaymentExpectationError(
      'ORDER_RUN_PRICE_MISMATCH',
      `база заказа ${orderBase} не совпадает с базой тиража ${base}: заказ нельзя засчитать автоматически`,
    );
  }
  let expected: bigint;
  try {
    expected = expectedUnits(base, input.order.order_no);
  } catch {
    throw new PaymentExpectationError(
      'INVALID_ORDER_NUMBER',
      `номер заказа ${String(input.order.order_no)} не может участвовать в пыли`,
    );
  }

  const nowSeconds = Math.floor(input.nowSeconds);
  const createdRaw = input.order.created_at ?? null;
  if (createdRaw !== null) {
    const createdMs = createdRaw instanceof Date ? createdRaw.getTime() : Date.parse(String(createdRaw));
    if (!Number.isFinite(createdMs)) {
      throw new PaymentExpectationError('INVALID_ORDER_TIME', 'created_at заказа не разбирается как время');
    }
    const createdSeconds = Math.floor(createdMs / 1000);
    return {
      expected,
      minBlockTime: BigInt(createdSeconds - PRESALE_PAYMENT_CLOCK_SKEW_SECONDS),
      base,
      minBlockTimeSource: 'order_created_at',
    };
  }

  const maxAge = input.maxAgeSeconds ?? PRESALE_PAYMENT_MAX_AGE_SECONDS;
  return {
    expected,
    minBlockTime: BigInt(nowSeconds - maxAge),
    base,
    minBlockTimeSource: 'max_age',
  };
}
