/**
 * Market as entry and whale growth (docs/ORGANISM_INTEGRATION.md §14.6, WP13/WP14). Pure functions, no chain, no wallet.
 * Units: micro-POTATO (1 POTATO = 1_000_000) and POTATO per day in the same micro units.
 * Every price here is a game rule of the off-chain design; on-chain prices and tiers are not changed by this module.
 */
import { ECONOMY, MARKET } from './parameters'

export type TierIndex = 0 | 1 | 2

function assertTier(tier: number): asserts tier is TierIndex {
  if (tier !== 0 && tier !== 1 && tier !== 2) throw new RangeError('tier must be 0, 1 or 2')
}
function assertOwned(owned: number): void {
  if (!Number.isInteger(owned) || owned < 0) throw new RangeError('owned fields must be an integer ≥ 0')
}

/** K-A: the N-th field a wallet buys (N = fields already owned, 0 for the first) costs base × (1 + α·N). */
export function fieldPriceMicro(tier: TierIndex, owned: number): number {
  assertTier(tier)
  assertOwned(owned)
  const base = (ECONOMY.baseFieldPriceMicro * ECONOMY.tiers[tier].costBps) / 10_000
  return Math.floor(base * (1 + MARKET.priceGrowthPerField * owned))
}

/** E-C: the micro-field entry price (25 POTATO), grown by the same K-A rule. */
export function microFieldPriceMicro(owned: number): number {
  assertOwned(owned)
  return Math.floor(MARKET.microFieldPriceMicro * (1 + MARKET.priceGrowthPerField * owned))
}

/** Field output per day (micro-POTATO) at full health: base yield × tier yield (§14.2: Common 2.10, Rare 6.00, Epic 12.60 POTATO/day). */
export function fieldYieldPerDayMicro(tier: TierIndex): number {
  assertTier(tier)
  return (ECONOMY.baseYieldMicroPerDay * ECONOMY.tiers[tier].yieldBps) / 10_000
}

/** Field tax per day (micro-POTATO): weekly tax × tier cost factor ÷ 7 (§14.2: Common 0.34 POTATO/day). */
export function fieldTaxPerDayMicro(tier: TierIndex): number {
  assertTier(tier)
  return (ECONOMY.baseTaxMicro * ECONOMY.tiers[tier].costBps) / 10_000 / 7
}

/** Micro-field output and tax: the same economics as Common, scaled by price (E-C). */
export function microFieldYieldPerDayMicro(): number {
  return fieldYieldPerDayMicro(0) * MARKET.microFieldScale
}
export function microFieldTaxPerDayMicro(): number {
  return fieldTaxPerDayMicro(0) * MARKET.microFieldScale
}

/** Days until the net yield (yield − tax) repays the price. Non-positive net yield never pays back. */
export function paybackDays(priceMicro: number, yieldPerDayMicro: number, taxPerDayMicro: number): number {
  const net = yieldPerDayMicro - taxPerDayMicro
  if (!(priceMicro > 0) || !(net > 0)) return Infinity
  return priceMicro / net
}

/** Total micro-POTATO to buy `count` fields, starting from `owned` already owned (K-A sums over N). */
export function buyFieldsCostMicro(tier: TierIndex, owned: number, count: number): number {
  assertTier(tier)
  assertOwned(owned)
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be an integer ≥ 0')
  let total = 0
  for (let i = 0; i < count; i++) total += fieldPriceMicro(tier, owned + i)
  return total
}

/** K-C: a field counts toward colony-linked output only while the colony has pads for it. */
export function canLinkFieldToColony(linked: number): boolean {
  assertOwned(linked)
  return linked < MARKET.colonyLinkedFieldCap
}
