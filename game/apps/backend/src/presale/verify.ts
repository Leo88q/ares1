/**
 * Проверка платежа: «действительно ли эта транзакция оплачивает этот заказ».
 *
 * Функция намеренно чистая — она не ходит в RPC, а разбирает уже полученный
 * снимок транзакции. Это не косметика: единственное место, где решается
 * «деньги получены», обязано быть проверяемым без живой ноды, иначе его
 * невозможно покрыть тестами и оно остаётся непроверенным навсегда.
 *
 * Правило, из которого следуют все коды отказа:
 *   сомнительный платёж НЕ считается оплаченным автоматически. Он уходит
 *   в ручную очередь с явным кодом. Молча потерять деньги покупателя хуже,
 *   чем попросить оператора посмотреть, но молча ЗАЧЕСТЬ чужой или неполный
 *   платёж — хуже всего.
 */

export type Confirmation = 'processed' | 'confirmed' | 'finalized';

/** Снимок транзакции в том виде, в каком его отдаёт getTransaction. */
export interface ChainTransferView {
  signature: string;
  slot: bigint;
  blockTime: bigint | null;
  /** meta.err: null — успех, иначе транзакция упала. */
  err: unknown;
  /** message.accountKeys, base58, в исходном порядке. */
  accountKeys: readonly string[];
  preBalances: readonly bigint[];
  postBalances: readonly bigint[];
  confirmation: Confirmation;
}

export interface PaymentExpectation {
  /** Кошелёк-казначейство тиража. */
  treasury: string;
  /** Точная ожидаемая сумма: база тиража + номер заказа. */
  expectedLamports: bigint;
  /** Кошелёк покупателя, если известен: платёж обязан идти с него. */
  payerWallet?: string | null;
  /** Не принимать транзакции раньше этого времени (защита от древних переводов). */
  minBlockTime?: bigint | null;
}

export type VerdictCode =
  | 'OK'
  | 'NOT_FINALIZED'
  | 'TX_FAILED'
  | 'TREASURY_NOT_INVOLVED'
  | 'NO_INFLOW'
  | 'AMOUNT_SHORT'
  | 'AMOUNT_OVERPAID'
  | 'PAYER_MISMATCH'
  | 'TOO_OLD';

export interface Verdict {
  code: VerdictCode;
  /** Платёж можно засчитывать автоматически. */
  ok: boolean;
  /** Требуется взгляд оператора (деньги пришли, но зачесть автоматически нельзя). */
  needsManualReview: boolean;
  /** Сколько лампортов реально дошло до казначейства (0, если не дошло). */
  receivedUnits: bigint;
  slot: bigint;
  detail: string;
}

function fail(
  code: VerdictCode,
  view: ChainTransferView,
  detail: string,
  received: bigint,
  needsManualReview = false,
): Verdict {
  return { code, ok: false, needsManualReview, receivedUnits: received, slot: view.slot, detail };
}

/**
 * Разбирает дельту баланса казначейства. Возвращает индекс и сколько пришло.
 * Индекс берётся из accountKeys, а не «первый совпавший»: порядок балансов
 * в Solana соответствует порядку ключей, и любое другое предположение — баг.
 */
export function treasuryInflow(
  view: ChainTransferView,
  treasury: string,
): { index: number; received: bigint } | null {
  const index = view.accountKeys.findIndex(k => k === treasury);
  if (index < 0) return null;
  const pre = view.preBalances[index];
  const post = view.postBalances[index];
  if (pre === undefined || post === undefined) return null;
  return { index, received: post - pre };
}

export function verifyPayment(
  view: ChainTransferView,
  expect: PaymentExpectation,
): Verdict {
  // 1. Только финализированная транзакция. Откатившийся перевод, засчитанный
  //    как оплата, — это выдача пака без денег.
  if (view.confirmation !== 'finalized') {
    return fail('NOT_FINALIZED', view, `статус ${view.confirmation}, нужен finalized`, 0n);
  }

  // 2. Упавшая транзакция ничего не перевела, даже если в ней был перевод.
  if (view.err !== null && view.err !== undefined) {
    return fail('TX_FAILED', view, `транзакция завершилась ошибкой: ${JSON.stringify(view.err)}`, 0n);
  }

  // 3. Древняя транзакция: подпись уникальна, но принимать платёж месячной
  //    давности за текущий заказ — значит принять перевод, сделанный не для него.
  if (expect.minBlockTime != null) {
    if (view.blockTime === null) {
      return fail('TOO_OLD', view, 'в транзакции нет blockTime, возраст проверить нельзя', 0n, true);
    }
    if (view.blockTime < expect.minBlockTime) {
      return fail(
        'TOO_OLD', view,
        `blockTime ${view.blockTime} раньше порога ${expect.minBlockTime}`, 0n, true,
      );
    }
  }

  const inflow = treasuryInflow(view, expect.treasury);
  if (!inflow) {
    return fail('TREASURY_NOT_INVOLVED', view, `казначейство ${expect.treasury} не участвует в транзакции`, 0n);
  }
  if (inflow.received <= 0n) {
    return fail('NO_INFLOW', view, 'баланс казначейства не вырос: перевода не было', 0n);
  }

  // 4. Сумма обязана совпадать точно — в этом и состоит lamport-пыль.
  if (inflow.received < expect.expectedLamports) {
    return fail(
      'AMOUNT_SHORT', view,
      `пришло ${inflow.received}, ожидалось ${expect.expectedLamports}`,
      inflow.received, true,
    );
  }
  if (inflow.received > expect.expectedLamports) {
    // Не «округляем до нужного»: избыток может означать, что в одной
    // транзакции смешаны два платежа, и зачесть её за один заказ нельзя.
    return fail(
      'AMOUNT_OVERPAID', view,
      `пришло ${inflow.received}, ожидалось ровно ${expect.expectedLamports}`,
      inflow.received, true,
    );
  }

  // 5. Плательщик. Балансов достаточно: если кошелёк покупателя в транзакции
  //    не потерял хотя бы сумму перевода, деньги пришли не от него.
  if (expect.payerWallet) {
    const payerIndex = view.accountKeys.findIndex(k => k === expect.payerWallet);
    if (payerIndex < 0) {
      return fail(
        'PAYER_MISMATCH', view,
        `кошелёк покупателя ${expect.payerWallet} не участвует в транзакции`,
        inflow.received, true,
      );
    }
    const pre = view.preBalances[payerIndex];
    const post = view.postBalances[payerIndex];
    if (pre === undefined || post === undefined) {
      return fail('PAYER_MISMATCH', view, 'нет балансов кошелька покупателя', inflow.received, true);
    }
    // Комиссия сети списывается сверх перевода, поэтому «потерял не меньше».
    if (pre - post < inflow.received) {
      return fail(
        'PAYER_MISMATCH', view,
        `кошелёк покупателя потерял ${pre - post}, а дошло ${inflow.received}`,
        inflow.received, true,
      );
    }
  }

  return {
    code: 'OK',
    ok: true,
    needsManualReview: false,
    receivedUnits: inflow.received,
    slot: view.slot,
    detail: 'платёж совпал по получателю, сумме и плательщику',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Платёж в SPL-токене (SKR)
//
// Отдельная функция, а не «флаг валюты» в verifyPayment: у нативного перевода
// источником правды служат pre/postBalances аккаунтов, а у токен-перевода —
// pre/postTokenBalances, где баланс привязан к (accountIndex, mint, owner).
// Объединять их в одну функцию — значит дать способ перепутать лампорты
// с атомами SKR, а это ошибка ровно в 1000 раз.
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenBalanceView {
  accountIndex: number;
  mint: string;
  owner: string;
  /** Базовые единицы (для SKR — атомы, 10^-6). */
  amount: bigint;
}

export interface ChainTokenTransferView {
  signature: string;
  slot: bigint;
  blockTime: bigint | null;
  err: unknown;
  accountKeys: readonly string[];
  preTokenBalances: readonly TokenBalanceView[];
  postTokenBalances: readonly TokenBalanceView[];
  confirmation: Confirmation;
}

export interface TokenPaymentExpectation {
  /** ТОКЕН-аккаунт казначейства (ATA), а не кошелёк. */
  treasuryAta: string;
  /** Минт, который мы принимаем. Другой токен — не оплата. */
  mint: string;
  expectedUnits: bigint;
  payerWallet?: string | null;
  minBlockTime?: bigint | null;
}

function failToken(
  code: VerdictCode,
  view: ChainTokenTransferView,
  detail: string,
  received: bigint,
  needsManualReview = false,
): Verdict {
  return { code, ok: false, needsManualReview, receivedUnits: received, slot: view.slot, detail };
}

/**
 * Приток токена к конкретному (аккаунт, минт). Ищем по owner+ mint в post-снимке
 * и сравниваем с pre-снимком того же аккаунта: совпадение по accountIndex —
 * единственный корректный способ сопоставить два снимка.
 */
export function tokenInflow(
  view: ChainTokenTransferView,
  owner: string,
  mint: string,
): { accountIndex: number; received: bigint } | null {
  const post = view.postTokenBalances.find(b => b.owner === owner && b.mint === mint);
  if (!post) return null;
  const pre = view.preTokenBalances.find(
    b => b.accountIndex === post.accountIndex && b.mint === mint,
  );
  return { accountIndex: post.accountIndex, received: post.amount - (pre?.amount ?? 0n) };
}

export function verifyTokenPayment(
  view: ChainTokenTransferView,
  expect: TokenPaymentExpectation,
): Verdict {
  if (view.confirmation !== 'finalized') {
    return failToken('NOT_FINALIZED', view, `статус ${view.confirmation}, нужен finalized`, 0n);
  }
  if (view.err !== null && view.err !== undefined) {
    return failToken('TX_FAILED', view, `транзакция завершилась ошибкой: ${JSON.stringify(view.err)}`, 0n);
  }
  if (expect.minBlockTime != null) {
    if (view.blockTime === null) {
      return failToken('TOO_OLD', view, 'в транзакции нет blockTime, возраст проверить нельзя', 0n, true);
    }
    if (view.blockTime < expect.minBlockTime) {
      return failToken('TOO_OLD', view,
        `blockTime ${view.blockTime} раньше порога ${expect.minBlockTime}`, 0n, true);
    }
  }

  // Токен-аккаунт казначейства ищем по ИНДЕКСУ в accountKeys: в Solana порядок
  // pre/postTokenBalances привязан к accountIndex, а поле `owner` внутри записи —
  // это кошелёк-владелец ATA, а не сам ATA. Перепутать их — значит искать баланс
  // не того аккаунта и молча принять чужой платёж.
  const treasuryIndex = view.accountKeys.findIndex(k => k === expect.treasuryAta);
  if (treasuryIndex < 0) {
    return failToken('TREASURY_NOT_INVOLVED', view,
      `токен-аккаунт ${expect.treasuryAta} не участвует в транзакции`, 0n);
  }
  const post = view.postTokenBalances.find(b => b.accountIndex === treasuryIndex);
  if (!post) {
    return failToken('TREASURY_NOT_INVOLVED', view,
      `у аккаунта ${expect.treasuryAta} нет записи баланса в транзакции`, 0n);
  }
  if (post.mint !== expect.mint) {
    return failToken('TREASURY_NOT_INVOLVED', view,
      `на аккаунте казначейства минт ${post.mint}, ожидался ${expect.mint}`, 0n);
  }
  const pre = view.preTokenBalances.find(
    b => b.accountIndex === treasuryIndex && b.mint === expect.mint,
  );
  const received = post.amount - (pre?.amount ?? 0n);

  if (received <= 0n) {
    return failToken('NO_INFLOW', view, 'баланс казначейства не вырос: перевода не было', 0n);
  }
  if (received < expect.expectedUnits) {
    return failToken('AMOUNT_SHORT', view,
      `пришло ${received}, ожидалось ${expect.expectedUnits}`, received, true);
  }
  if (received > expect.expectedUnits) {
    return failToken('AMOUNT_OVERPAID', view,
      `пришло ${received}, ожидалось ровно ${expect.expectedUnits}`, received, true);
  }

  if (expect.payerWallet) {
    const payerIn = tokenInflow(view, expect.payerWallet, expect.mint);
    if (!payerIn) {
      return failToken('PAYER_MISMATCH', view,
        `у кошелька покупателя ${expect.payerWallet} нет баланса в минте ${expect.mint}`,
        received, true);
    }
    if (payerIn.received >= 0n) {
      return failToken('PAYER_MISMATCH', view,
        'баланс покупателя в этом минте не уменьшился: токен пришёл не от него',
        received, true);
    }
    if (-payerIn.received < received) {
      return failToken('PAYER_MISMATCH', view,
        `покупатель отправил ${-payerIn.received}, а дошло ${received}`,
        received, true);
    }
  }

  return {
    code: 'OK',
    ok: true,
    needsManualReview: false,
    receivedUnits: received,
    slot: view.slot,
    detail: 'токен-платёж совпал по минту, получателю, сумме и плательщику',
  };
}
