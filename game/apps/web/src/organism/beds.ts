/**
 * Beds and slots (docs/ORGANISM_INTEGRATION.md §14.3, §16–19). Pure functions,
 * no state, no UI, no on-chain calls. The on-chain side is NOT changed here.
 *
 * Economy rules, all already decided:
 *  - slots 1–6 per field are free; slots 7–12 cost 500 SKR each (§18, S3);
 *  - a bed sits on a slot and is bought in POTATO at the field price of its tier;
 *  - beds are staggered by cycle / K so the field yields a small harvest daily;
 *  - harvest is allowed in the 80–120 % maturity window (M2).
 * Harvest-window ramp (0.8→1.0 and 1.0→1.2) is a game assumption (H), not validated.
 */
import { BEDS, ECONOMY, SLOTS } from './parameters'

export type TierIndex = 0 | 1 | 2

/** SKR atoms needed to occupy slot `index` (0-based). */
export function slotPriceSkrAtoms(index: number): bigint {
  if (!Number.isInteger(index) || index < 0 || index >= SLOTS.maxPerField) {
    throw new RangeError(`slot index must be an integer 0…${SLOTS.maxPerField - 1}`)
  }
  return index < SLOTS.freePerField ? 0n : SLOTS.priceSkrAtoms
}

/** Total SKR atoms to fill `occupied` slots on one field (0…maxPerField). */
export function totalSlotCostSkrAtoms(occupied: number): bigint {
  if (!Number.isInteger(occupied) || occupied < 0 || occupied > SLOTS.maxPerField) {
    throw new RangeError(`occupied must be an integer 0…${SLOTS.maxPerField}`)
  }
  let total = 0n
  for (let i = 0; i < occupied; i++) total += slotPriceSkrAtoms(i)
  return total
}

/** POTATO micro price of a bed = field price of the same tier (§18). */
export function bedPriceMicro(tier: TierIndex): number {
  const t = ECONOMY.tiers[tier]
  if (!t) throw new RangeError('tier must be 0, 1 or 2')
  return Math.floor((ECONOMY.baseFieldPriceMicro * t.costBps) / 10_000)
}

/** Start offset of bed `i` (0-based) inside one crop cycle, in the same units as cycleDays. */
export function bedOffsetDays(i: number, cycleDays: number, beds: number = BEDS.perField): number {
  if (!Number.isInteger(i) || i < 0 || i >= beds) throw new RangeError('bed index out of range')
  if (!(cycleDays > 0)) throw new RangeError('cycleDays must be positive')
  return (i * cycleDays) / beds
}

/** Kilograms harvested from one bed per cycle at full quality: an equal share of the field cycle. */
export function bedCycleKg(fieldCycleKg: number, beds: number = BEDS.perField): number {
  if (!(fieldCycleKg >= 0)) throw new RangeError('fieldCycleKg must be ≥ 0')
  return fieldCycleKg / beds
}

/**
 * Harvest factor by maturity ratio r = age / maturityAge.
 *  r < 0.8            → 0 (not allowed yet)
 *  0.8 ≤ r < 1.0      → ramp 0.5 → 1.0 (H)
 *  1.0 ≤ r ≤ 1.2      → ramp 1.0 → 0.5 (H, late harvest loses quality)
 *  r > 1.2            → 0 (window closed; spoiled)
 */
export function harvestFactor(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio < 0) throw new RangeError('ratio must be a finite number ≥ 0')
  const lo = BEDS.harvestWindowMinRatio, hi = BEDS.harvestWindowMaxRatio
  if (ratio < lo || ratio > hi) return 0
  if (ratio < 1) return 0.5 + 0.5 * ((ratio - lo) / (1 - lo))
  return 1 - 0.5 * ((ratio - 1) / (hi - 1))
}

/**
 * WP10 flow (§14.3). K beds are planted at t = 0 with offsets i × cycle / K. Bed i reaches
 * maturity at offset_i + cycle; the player harvests it there (ratio 1, full window factor).
 * Returns one event per bed in the first cycle after the first maturity.
 * Sum over one cycle = field cycle kg; one bed is ready every cycle / K days.
 */
export interface BedHarvestEvent { bed: number; day: number; kg: number }
export function bedHarvestSchedule(fieldCycleKg: number, cycleDays: number, beds: number = BEDS.perField, ratio = 1): BedHarvestEvent[] {
  const kgPerBed = bedCycleKg(fieldCycleKg, beds) * harvestFactor(ratio)
  return Array.from({ length: beds }, (_, bed) => ({
    bed,
    day: bedOffsetDays(bed, cycleDays, beds) + cycleDays,
    kg: kgPerBed,
  })).sort((a, b) => a.day - b.day)
}

/** Kilograms in the half-open day interval [from, to) for a list of harvest events. */
export function kgInInterval(events: readonly BedHarvestEvent[], from: number, to: number): number {
  return events.reduce((sum, e) => (e.day >= from && e.day < to ? sum + e.kg : sum), 0)
}
