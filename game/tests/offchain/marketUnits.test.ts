import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solToLamports, lamportsToSol, marketTotalLamports, MARKET_MIN_TOTAL_LAMPORTS } from '../../apps/web/src/utils/marketUnits';

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
test('price conversion rejects nonfinite, negative and unsafe input', () => {
  for (const value of [NaN, Infinity, -1, 0, Number.MAX_VALUE, 1e-12]) assert.throws(() => solToLamports(value));
});
