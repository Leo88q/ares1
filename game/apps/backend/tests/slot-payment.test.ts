import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifySlotPayment,
  type SlotPaymentExpectation,
  type SlotPaymentSnapshot,
  type TokenBalanceView,
} from '../src/slots/payment.js';

const MINT = 'SKRmint1111111111111111111111111111111111';
const OTHER_MINT = 'OTHERmint111111111111111111111111111111111';
const TREASURY = 'Treasury11111111111111111111111111111111111';
const PAYER = 'Payer111111111111111111111111111111111111111';
const STRANGER = 'Stranger1111111111111111111111111111111111';
const PRICE = 500_000_000n; // базовые единицы SKR: значение условное, в тесте важна точность

const expectation: SlotPaymentExpectation = {
  mint: MINT,
  treasuryOwner: TREASURY,
  payerWallet: PAYER,
  expectedUnits: PRICE,
  minBlockTime: 1_700_000_000n,
  requiredConfirmation: 'finalized',
};

const bal = (accountIndex: number, mint: string, owner: string | null, amount: bigint): TokenBalanceView =>
  ({ accountIndex, mint, owner, amount });

/** Успешный платёж: плательщик отдаёт PRICE, казначейство получает PRICE. */
function paid(overrides: Partial<SlotPaymentSnapshot> = {}): SlotPaymentSnapshot {
  return {
    signature: 'sig',
    err: null,
    blockTime: 1_700_000_100n,
    confirmation: 'finalized',
    preTokenBalances: [
      bal(1, MINT, PAYER, 1_000_000_000_000n),
      bal(2, MINT, TREASURY, 0n),
    ],
    postTokenBalances: [
      bal(1, MINT, PAYER, 1_000_000_000_000n - PRICE),
      bal(2, MINT, TREASURY, PRICE),
    ],
    ...overrides,
  };
}

test('slot payment: exact transfer from the buyer to the treasury, finalized, in time → ok', () => {
  assert.deepEqual(verifySlotPayment(paid(), expectation), { ok: true });
});

test('slot payment: failed transaction is never credited', () => {
  assert.deepEqual(verifySlotPayment(paid({ err: { InstructionError: [0, 'Custom'] } }), expectation), { ok: false, code: 'TX_FAILED' });
});

test('slot payment: only finalized is accepted under the S7 rule (confirmed and processed are not)', () => {
  assert.deepEqual(verifySlotPayment(paid({ confirmation: 'confirmed' }), expectation), { ok: false, code: 'NOT_CONFIRMED' });
  assert.deepEqual(verifySlotPayment(paid({ confirmation: 'processed' }), expectation), { ok: false, code: 'NOT_CONFIRMED' });
});

test('slot payment: missing block time is refused, not assumed', () => {
  assert.deepEqual(verifySlotPayment(paid({ blockTime: null }), expectation), { ok: false, code: 'NO_BLOCK_TIME' });
});

test('slot payment: a transfer older than the order cannot pay for a new slot', () => {
  assert.deepEqual(verifySlotPayment(paid({ blockTime: 1_699_999_999n }), expectation), { ok: false, code: 'BLOCK_TOO_OLD' });
});

test('slot payment: one base unit short is not a partial credit', () => {
  const short = paid({ postTokenBalances: [bal(1, MINT, PAYER, 1_000_000_000_000n - PRICE + 1n), bal(2, MINT, TREASURY, PRICE - 1n)] });
  assert.deepEqual(verifySlotPayment(short, expectation), { ok: false, code: 'AMOUNT_NOT_EXACT' });
});

test('slot payment: overpayment is refused (exact amount only)', () => {
  const over = paid({ postTokenBalances: [bal(1, MINT, PAYER, 1_000_000_000_000n - PRICE - 1n), bal(2, MINT, TREASURY, PRICE + 1n)] });
  assert.deepEqual(verifySlotPayment(over, expectation), { ok: false, code: 'AMOUNT_NOT_EXACT' });
});

test('slot payment: money from a stranger does not pay for the buyer', () => {
  const stranger = paid({
    preTokenBalances: [bal(1, MINT, STRANGER, 10n * PRICE), bal(2, MINT, TREASURY, 0n)],
    postTokenBalances: [bal(1, MINT, STRANGER, 9n * PRICE), bal(2, MINT, TREASURY, PRICE)],
  });
  assert.deepEqual(verifySlotPayment(stranger, expectation), { ok: false, code: 'PAYER_NOT_SOURCE' });
});

test('slot payment: the treasury receiving the wrong token is WRONG_MINT', () => {
  const wrong = paid({
    preTokenBalances: [bal(1, OTHER_MINT, PAYER, 10n * PRICE), bal(2, OTHER_MINT, TREASURY, 0n)],
    postTokenBalances: [bal(1, OTHER_MINT, PAYER, 9n * PRICE), bal(2, OTHER_MINT, TREASURY, PRICE)],
  });
  assert.deepEqual(verifySlotPayment(wrong, expectation), { ok: false, code: 'WRONG_MINT' });
});

test('slot payment: exact total split across two treasury token accounts → ok', () => {
  // Казначейство получает через два токен-аккаунта: суммарный приход ровно PRICE.
  const split = paid({
    preTokenBalances: [bal(1, MINT, PAYER, 1_000_000_000_000n), bal(2, MINT, TREASURY, 0n), bal(3, MINT, TREASURY, 0n)],
    postTokenBalances: [bal(1, MINT, PAYER, 1_000_000_000_000n - PRICE), bal(2, MINT, TREASURY, PRICE / 2n), bal(3, MINT, TREASURY, PRICE - PRICE / 2n)],
  });
  assert.deepEqual(verifySlotPayment(split, expectation), { ok: true });
});

test('slot payment: a treasury account that disappears from the snapshot counts as drained', () => {
  const drained = paid({
    preTokenBalances: [bal(1, MINT, PAYER, 1_000_000_000_000n), bal(2, MINT, TREASURY, 3n * PRICE)],
    postTokenBalances: [bal(1, MINT, PAYER, 1_000_000_000_000n - PRICE)],
  });
  // казначейство потеряло 3*PRICE — это не приход, отказ
  assert.deepEqual(verifySlotPayment(drained, expectation), { ok: false, code: 'AMOUNT_NOT_EXACT' });
});

test('slot payment: zero or negative expected amount is a programming error, not a verdict', () => {
  assert.throws(() => verifySlotPayment(paid(), { ...expectation, expectedUnits: 0n }), RangeError);
});
