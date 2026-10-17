// WP13/WP14 (docs/ORGANISM_INTEGRATION.md §14.6, §14.8, §15 M3–M4): market entry and whale growth.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buyFieldsCostMicro, canLinkFieldToColony, fieldPriceMicro, fieldTaxPerDayMicro, fieldYieldPerDayMicro,
  microFieldPriceMicro, microFieldTaxPerDayMicro, microFieldYieldPerDayMicro, paybackDays,
} from '../../apps/web/src/organism/market'
import { MARKET } from '../../apps/web/src/organism/parameters'
import { SLOTS } from '../../apps/web/src/colony/simulation'

const POTATO = 1_000_000
const close = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)

test('entry (E-A + E-C): a newcomer with 25 POTATO can buy a micro-field; a Common field needs 100', () => {
  assert.equal(microFieldPriceMicro(0), 25 * POTATO)
  assert.equal(fieldPriceMicro(0, 0), 100 * POTATO)
  assert.equal(fieldPriceMicro(1, 0), 250 * POTATO)
  assert.equal(fieldPriceMicro(2, 0), 500 * POTATO)
  // the newcomer's first purchase is not grown by K-A (N = 0)
  assert.equal(microFieldPriceMicro(0), MARKET.microFieldPriceMicro)
})

test('payback matches §14.2 (Common ≈57, Rare ≈49, Epic ≈46 days), so tiers stay at parity', () => {
  const days = (t: 0 | 1 | 2): number => paybackDays(fieldPriceMicro(t, 0), fieldYieldPerDayMicro(t), fieldTaxPerDayMicro(t))
  assert.ok(Math.abs(days(0) - 57) < 0.5, `Common ${days(0)}`)
  assert.ok(Math.abs(days(1) - 49) < 0.5, `Rare ${days(1)}`)
  assert.ok(Math.abs(days(2) - 46) < 0.5, `Epic ${days(2)}`)
  // §14.2 table values: Common yield 2.10, tax 0.34 POTATO/day
  close(fieldYieldPerDayMicro(0) / POTATO, 2.1)
  assert.ok(Math.abs(fieldTaxPerDayMicro(0) / POTATO - 0.34) < 0.005)
})

test('micro-field (E-C) pays back within 60 days, the same as Common, at a quarter of the output', () => {
  const micro = paybackDays(microFieldPriceMicro(0), microFieldYieldPerDayMicro(), microFieldTaxPerDayMicro())
  const common = paybackDays(fieldPriceMicro(0, 0), fieldYieldPerDayMicro(0), fieldTaxPerDayMicro(0))
  assert.ok(micro <= 60, `micro payback ${micro}`)
  close(micro, common, 1e-6) // H: yield and tax scale with price, so the entry is not a worse deal
  close(microFieldYieldPerDayMicro() / fieldYieldPerDayMicro(0), MARKET.microFieldScale)
  // small harvest: a micro-field yields 0.525 POTATO/day
  close(microFieldYieldPerDayMicro() / POTATO, 0.525)
})

test('whale growth (K-A): the N-th field costs base × (1 + α·N); growth slows but never stops', () => {
  const prices = Array.from({ length: 24 }, (_, n) => fieldPriceMicro(0, n))
  for (let n = 1; n < prices.length; n++) assert.ok(prices[n] > prices[n - 1], `price must rise at N=${n}`)
  close(prices[0] / POTATO, 100)
  close(prices[20] / POTATO, 200) // N = 20: 1 + 0.05 × 20 = 2×
  // payback of the 24th field is longer than the first (the return falls), but stays finite
  const payback = (n: number): number => paybackDays(prices[n], fieldYieldPerDayMicro(0), fieldTaxPerDayMicro(0))
  assert.ok(payback(23) > payback(0))
  assert.ok(Number.isFinite(payback(23)))
  // a whale buying 24 fields pays more than the linear 24 × 100 POTATO, but the total is bounded by the formula
  const total = buyFieldsCostMicro(0, 0, 24) / POTATO
  // per-field floor to micro-POTATO: at most 1 micro unit lost per field, so tolerance 1e-3 POTATO
  close(total, 100 * (24 + MARKET.priceGrowthPerField * (24 * 23) / 2), 1e-3)
  // above linear (2400) but below 24 × the 24th price (100 × 2.15 = 215 POTATO each)
  assert.ok(total > 2400 && total < 24 * 215)
  // buying in two steps costs exactly the same as in one
  assert.equal(buyFieldsCostMicro(0, 0, 10) + buyFieldsCostMicro(0, 10, 14), buyFieldsCostMicro(0, 0, 24))
})

test('colony cap (K-C): colony-linked fields are limited by the colony pads, and the cap equals SLOTS', () => {
  assert.equal(MARKET.colonyLinkedFieldCap, SLOTS.length)
  assert.equal(canLinkFieldToColony(0), true)
  assert.equal(canLinkFieldToColony(SLOTS.length - 1), true)
  assert.equal(canLinkFieldToColony(SLOTS.length), false)
})

test('market parameters fail closed on invalid input', () => {
  const throws = (f: () => unknown): boolean => { try { f(); return false } catch (e) { return e instanceof RangeError } }
  assert.ok(throws(() => fieldPriceMicro(3 as 0, 0)))
  assert.ok(throws(() => fieldPriceMicro(0, -1)))
  assert.ok(throws(() => fieldPriceMicro(0, 1.5)))
  assert.ok(throws(() => microFieldPriceMicro(-1)))
  assert.ok(throws(() => buyFieldsCostMicro(0, 0, -1)))
  assert.ok(throws(() => canLinkFieldToColony(-1)))
  assert.equal(paybackDays(100, 1, 1), Infinity) // no net yield → never pays back
})
