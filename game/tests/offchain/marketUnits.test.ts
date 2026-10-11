import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solToLamports, lamportsToSol, marketTotalLamports, MARKET_MIN_TOTAL_LAMPORTS, parseFixedPointUnits, formatFixedPointUnits, formatFixedPointUnitsExact } from '../../apps/web/src/utils/marketUnits';

test('market quotes use native SOL (1e9), never SKR atoms (1e6)', () => {
  assert.equal(solToLamports(0.001), 1_000_000n);
  assert.equal(solToLamports(1), 1_000_000_000n);
  assert.equal(lamportsToSol(1_000_000), 0.001);
  const total = marketTotalLamports(10_000_000n, solToLamports(0.0001));
  assert.equal(total, MARKET_MIN_TOTAL_LAMPORTS);
  assert.equal(lamportsToSol(total), 0.001);
});
test('order total follows on-chain integer division without float intermediates', () => {
  const amount = 999_999_999_999n;
  const price = 8_999_999_999n;
  assert.equal(BigInt(marketTotalLamports(amount, price)), amount * price / 1_000_000n);
  assert.throws(() => marketTotalLamports(10n ** 18n, 10n ** 18n));
});
test('V2 decimal inputs and displays stay exact for SOL and six-decimal SKR', () => {
  assert.equal(parseFixedPointUnits('0.000000001', 9), 1n);
  assert.equal(parseFixedPointUnits('12.340000000', 9), 12_340_000_000n);
  assert.equal(parseFixedPointUnits('12.340000', 6), 12_340_000n);
  assert.equal(parseFixedPointUnits('12,34', 6), 12_340_000n);
  assert.equal(formatFixedPointUnits(12_345_678_901n, 9, 4), '12.3457');
  assert.equal(formatFixedPointUnits(999_999_999n, 9, 4), '1.0000');
  assert.equal(formatFixedPointUnits(12_340_000n, 6, 0), '12');
  assert.equal(formatFixedPointUnitsExact(1_000_000_000n, 9), '1');
  assert.equal(formatFixedPointUnitsExact(1n, 9), '0.000000001');
  assert.equal(formatFixedPointUnitsExact(1_230_000n, 6), '1.23');
  assert.throws(() => parseFixedPointUnits('1e-3', 9));
  assert.throws(() => parseFixedPointUnits('-1', 6));
  assert.throws(() => parseFixedPointUnits('0.0000001', 6));
});

test('price conversion rejects nonfinite, negative and unsafe input', () => {
  for (const value of [NaN, Infinity, -1, 0, Number.MAX_VALUE, 1e-12]) assert.throws(() => solToLamports(value));
});
