/**
 * Проверка оплаты слота SKR по снимку транзакции (S7, docs/S7_SLOT_AUTHORITY_SPEC.md §3).
 *
 * Функция чистая: не ходит в RPC и разбирает уже полученный снимок. Так решение
 * «деньги получены» можно покрыть тестами без живой ноды, как в presale/verify.ts.
 *
 * Правило: сомнительный платёж НЕ засчитывается. Любое несовпадение даёт код отказа,
 * а не частичный зачёт. Выдача слота происходит только при verdict.ok === true.
 */

export type SlotConfirmation = 'processed' | 'confirmed' | 'finalized';

const RANK: Record<SlotConfirmation, number> = { processed: 0, confirmed: 1, finalized: 2 };

/** Остаток токен-аккаунта до и после транзакции (из meta.preTokenBalances / postTokenBalances). */
export interface TokenBalanceView {
  accountIndex: number;
  mint: string;
  /** Владелец токен-аккаунта (кошелёк), если RPC его отдаёт. */
  owner: string | null;
  /** Базовые единицы токена. */
  amount: bigint;
}

export interface SlotPaymentSnapshot {
  signature: string;
  /** meta.err: null — успех. */
  err: unknown;
  blockTime: bigint | null;
  confirmation: SlotConfirmation;
  preTokenBalances: readonly TokenBalanceView[];
  postTokenBalances: readonly TokenBalanceView[];
}

export interface SlotPaymentExpectation {
  /** Mint SKR из конфигурации окружения. */
  mint: string;
  /** Кошелёк казначейства тиража (владелец получающего токен-аккаунта). */
  treasuryOwner: string;
  /** Кошелёк покупателя из записи: платёж обязан идти с его токен-аккаунта. */
  payerWallet: string;
  /** Точная сумма слота в базовых единицах SKR. Должна быть > 0. */
  expectedUnits: bigint;
  /** Не принимать транзакции раньше этого времени (unix, секунды). */
  minBlockTime: bigint;
  /** Требуемый уровень подтверждения. По решению S7 — finalized. */
  requiredConfirmation: SlotConfirmation;
}

export type SlotPaymentCode =
  | 'TX_FAILED'
  | 'NOT_CONFIRMED'
  | 'NO_BLOCK_TIME'
  | 'BLOCK_TOO_OLD'
  | 'WRONG_MINT'
  | 'AMOUNT_NOT_EXACT'
  | 'PAYER_NOT_SOURCE';

export type SlotPaymentVerdict = { ok: true } | { ok: false; code: SlotPaymentCode };

/** Суммарная дельта по токен-аккаунтам, у которых совпадают mint и владелец. */
function deltaFor(
  snapshot: SlotPaymentSnapshot,
  mint: string,
  owner: string,
): { delta: bigint; present: boolean } {
  const pre = new Map<number, bigint>();
  for (const b of snapshot.preTokenBalances) {
    if (b.mint === mint && b.owner === owner) pre.set(b.accountIndex, b.amount);
  }
  let delta = 0n;
  let present = false;
  const seen = new Set<number>();
  for (const b of snapshot.postTokenBalances) {
    if (b.mint !== mint || b.owner !== owner) continue;
    present = true;
    seen.add(b.accountIndex);
    delta += b.amount - (pre.get(b.accountIndex) ?? 0n);
  }
  // Аккаунт был до транзакции, а после исчез из снимка: остаток стал 0.
  for (const [index, amount] of pre) {
    if (!seen.has(index)) {
      present = true;
      delta -= amount;
    }
  }
  return { delta, present };
}

export function verifySlotPayment(
  snapshot: SlotPaymentSnapshot,
  expectation: SlotPaymentExpectation,
): SlotPaymentVerdict {
  if (expectation.expectedUnits <= 0n) {
    throw new RangeError('expectedUnits must be > 0');
  }
  if (snapshot.err !== null && snapshot.err !== undefined) {
    return { ok: false, code: 'TX_FAILED' };
  }
  if (RANK[snapshot.confirmation] < RANK[expectation.requiredConfirmation]) {
    return { ok: false, code: 'NOT_CONFIRMED' };
  }
  if (snapshot.blockTime === null) {
    return { ok: false, code: 'NO_BLOCK_TIME' };
  }
  if (snapshot.blockTime < expectation.minBlockTime) {
    return { ok: false, code: 'BLOCK_TOO_OLD' };
  }

  // Казначейство должно получить ровно expectedUnits в нужном mint.
  const treasury = deltaFor(snapshot, expectation.mint, expectation.treasuryOwner);
  if (!treasury.present) {
    // Казначейство есть в транзакции, но в другом mint — это не тот токен.
    const other = snapshot.postTokenBalances.some(
      b => b.owner === expectation.treasuryOwner && b.mint !== expectation.mint,
    );
    return { ok: false, code: other ? 'WRONG_MINT' : 'AMOUNT_NOT_EXACT' };
  }
  if (treasury.delta !== expectation.expectedUnits) {
    return { ok: false, code: 'AMOUNT_NOT_EXACT' };
  }

  // Списание ровно expectedUnits именно с кошелька покупателя.
  const payer = deltaFor(snapshot, expectation.mint, expectation.payerWallet);
  if (-payer.delta !== expectation.expectedUnits) {
    return { ok: false, code: 'PAYER_NOT_SOURCE' };
  }

  return { ok: true };
}
