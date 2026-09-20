import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skrToAtoms, skrAtomsToTokens, marketTotalSkrAtoms } from '../../apps/web/src/utils/marketUnits';

test('SKR v2 quotes use 1e6 atoms, never SOL lamports', () => {
  assert.equal(skrToAtoms(0.001), 1_000n);
  assert.equal(skrToAtoms(1), 1_000_000n);
  assert.equal(skrAtomsToTokens(1_000_000), 1);
  const total = marketTotalSkrAtoms(10_000_000n, skrToAtoms(0.0001));
  assert.equal(total, 1_000);
  assert.equal(skrAtomsToTokens(total), 0.001);
});
test('order total follows on-chain integer division without float intermediates', () => {
  const amount = 999_999_999_999n;
  const price = 8_999_999_999n;
  assert.equal(BigInt(marketTotalSkrAtoms(amount, price)), amount * price / 1_000_000n);
  assert.throws(() => marketTotalSkrAtoms(10n ** 18n, 10n ** 18n));
});
test('price conversion rejects nonfinite, negative and unsafe input', () => {
  for (const value of [NaN, Infinity, -1, 0, Number.MAX_VALUE, 1e-12, 0.0000009, 1.0000001]) assert.throws(() => skrToAtoms(value));
});
