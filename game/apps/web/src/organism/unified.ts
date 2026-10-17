/**
 * ARES «Единый организм», P1 (docs/ORGANISM_INTEGRATION.md §32.4).
 *
 * One ledger for the whole base. A kilogram goes:
 *   growth → harvest → storage → processing → crew food | export | craft
 * Off-chain accounting only. Nothing here mints POTATO. Crafting stays disabled
 * until PotatoPerKg is calibrated (§13.2, marked H), so `potatoPerKg === null` means "not calibrated".
 *
 * Conservation (checked by tests and by `unifiedBalance`):
 *   startKg + harvestedKg = rawKg + processedKg + eatenKg + exportedKg + craftedKg + processingLossKg
 */
import { BEDS, LAB, PARAMETERS } from './parameters'
import { bedCycleKg, harvestFactor } from './beds'

/** Tier yield multipliers. Taken from LAB (1 / 1.35 / 1.7) until the on-chain tiers are reconciled (§13.4 G7). */
export const UNIFIED_TIER_MULT: readonly [number, number, number] = [1, 1.35, 1.7]

/** One cycle of growth for every bed, in days (colony value, §13.4 G8 resolved to this). */
export const UNIFIED_CYCLE_DAYS: number = PARAMETERS.cropCycleDays

/** kg of one full field cycle for a tier. */
export function fieldCycleKg(tier: 0 | 1 | 2): number {
  return PARAMETERS.cropAreaM2 * PARAMETERS.cropKgM2Day * UNIFIED_CYCLE_DAYS * UNIFIED_TIER_MULT[tier]
}

/** kg of one bed at full cycle for a tier. */
export function bedFullKg(tier: 0 | 1 | 2): number {
  return bedCycleKg(fieldCycleKg(tier), BEDS.perField)
}

export interface UnifiedPlot {
  id: string
  tier: 0 | 1 | 2
  /** Days of growth per bed. Negative = not planted yet. Harvest resets a bed to 0. */
  beds: number[]
}

export interface UnifiedBase {
  day: number
  plots: UnifiedPlot[]
  crew: number
  /** Storage limit for raw + processed kg. Harvest that does not fit is refused, never silently lost. */
  storageCapKg: number
  rawKg: number
  processedKg: number
  /** Accounting base: kg that were in the base at the start. */
  startKg: number
  harvestedKg: number
  eatenKg: number
  exportedKg: number
  craftedKg: number
  processingLossKg: number
  foodShortfallKg: number
  /** POTATO earned from crafting, off-chain ledger only. Never minted by this module. */
  potatoLedger: number
  /** POTATO per crafted kg. `null` = not calibrated, crafting refused. */
  potatoPerKg: number | null
}

export interface UnifiedInit {
  plots: UnifiedPlot[]
  crew: number
  storageCapKg: number
  startKg: number
  potatoPerKg?: number | null
}

export function initialUnifiedBase(init: UnifiedInit): UnifiedBase {
  if (!(init.storageCapKg >= 0) || !(init.startKg >= 0) || !(init.crew >= 0)) throw new RangeError('invalid base parameters')
  return {
    day: 0,
    plots: init.plots.map(p => ({ ...p, beds: [...p.beds] })),
    crew: init.crew,
    storageCapKg: init.storageCapKg,
    rawKg: 0,
    processedKg: init.startKg,
    startKg: init.startKg,
    harvestedKg: 0,
    eatenKg: 0,
    exportedKg: 0,
    craftedKg: 0,
    processingLossKg: 0,
    foodShortfallKg: 0,
    potatoLedger: 0,
    potatoPerKg: init.potatoPerKg ?? null,
  }
}

/** Kilograms in storage (raw + processed). */
export const storedKg = (b: UnifiedBase): number => b.rawKg + b.processedKg
const freeKg = (b: UnifiedBase): number => Math.max(0, b.storageCapKg - storedKg(b))

/** Kilograms that leave the base or are used; together with stock they must equal the inflow. */
export function unifiedBalance(b: UnifiedBase): { inflow: number; stock: number; outflow: number; residual: number } {
  const inflow = b.startKg + b.harvestedKg
  const stock = b.rawKg + b.processedKg
  const outflow = b.eatenKg + b.exportedKg + b.craftedKg + b.processingLossKg
  return { inflow, stock, outflow, residual: inflow - stock - outflow }
}

function findPlot(b: UnifiedBase, plotId: string): number {
  return b.plots.findIndex(p => p.id === plotId)
}

/** A bed can be harvested by hand when the harvest factor (T2 + window, §31.2) is above zero and the bed is planted. */
export function canHarvestBed(b: UnifiedBase, plotId: string, index: number): boolean {
  const pi = findPlot(b, plotId)
  if (pi < 0 || !Number.isInteger(index) || index < 0 || index >= BEDS.perField) return false
  const plot = b.plots[pi]
  const v = plot.beds[index]
  if (v === undefined || v < 0) return false
  const kg = bedFullKg(plot.tier) * harvestFactor(v / UNIFIED_CYCLE_DAYS)
  return kg > 0 && kg <= freeKg(b) + 1e-9
}

/** Manual harvest. Refused (same object returned) when the factor is zero or storage is full. */
export function harvestBed(b: UnifiedBase, plotId: string, index: number): UnifiedBase {
  if (!canHarvestBed(b, plotId, index)) return b
  const pi = findPlot(b, plotId)
  const plot = b.plots[pi]
  const kg = bedFullKg(plot.tier) * harvestFactor(plot.beds[index] / UNIFIED_CYCLE_DAYS)
  const beds = [...plot.beds]
  beds[index] = 0
  const plots = b.plots.map((p, i) => (i === pi ? { ...p, beds } : p))
  return { ...b, plots, rawKg: b.rawKg + kg, harvestedKg: b.harvestedKg + kg }
}

/** Grow every planted bed by `growth` days. A bed at full cycle is harvested automatically if storage has room; otherwise it waits (no loss). */
function growBeds(b: UnifiedBase, growth: number): UnifiedBase {
  let cur = b
  cur = { ...cur, plots: cur.plots.map(p => ({ ...p, beds: p.beds.map(v => {
    if (v < 0) return v + growth >= 0 ? 0 : v + growth
    return v + growth
  }) })) }
  // automatic harvest of ripe beds (value ≥ cycle), one bed at a time, while storage allows
  for (let pi = 0; pi < cur.plots.length; pi++) {
    for (let bi = 0; bi < BEDS.perField; bi++) {
      const plot = cur.plots[pi]
      const v = plot.beds[bi]
      if (v < UNIFIED_CYCLE_DAYS - 1e-9) continue
      const kg = bedFullKg(plot.tier)
      if (kg > freeKg(cur) + 1e-9) continue // waits at full cycle; retried next day
      const beds = [...plot.beds]
      beds[bi] = v - UNIFIED_CYCLE_DAYS
      cur = {
        ...cur,
        plots: cur.plots.map((p, i) => (i === pi ? { ...p, beds } : p)),
        rawKg: cur.rawKg + kg,
        harvestedKg: cur.harvestedKg + kg,
      }
    }
  }
  return cur
}

/** Raw → processed, at the LAB line rate (0.7 kg/h × 24 h) with its 85 % yield. */
function processDay(b: UnifiedBase): UnifiedBase {
  const x = Math.min(b.rawKg, LAB.processorRateKgph * 24)
  if (x <= 0) return b
  return {
    ...b,
    rawKg: b.rawKg - x,
    processedKg: b.processedKg + x * LAB.processingYield,
    processingLossKg: b.processingLossKg + x * (1 - LAB.processingYield),
  }
}

/** Crew eats processed food first; any deficit is recorded, not hidden. */
function feedCrew(b: UnifiedBase): UnifiedBase {
  const demand = b.crew * PARAMETERS.freshFoodKgCrewDay
  const eaten = Math.min(b.processedKg, demand)
  return { ...b, processedKg: b.processedKg - eaten, eatenKg: b.eatenKg + eaten, foodShortfallKg: b.foodShortfallKg + (demand - eaten) }
}

/**
 * One day. `growth` is growth in days added to each planted bed (1 = a full day of growth).
 * Energy and water limits will set `growth` in P1b; P1 takes it as an input.
 */
export function advanceDay(b: UnifiedBase, growth: number): UnifiedBase {
  if (!(growth >= 0)) throw new RangeError('growth must be ≥ 0')
  let cur = growBeds({ ...b, day: b.day + 1 }, growth)
  cur = processDay(cur)
  cur = feedCrew(cur)
  return cur
}

/** Export processed kg to a buyer. Only processed food leaves the base. */
export function exportKg(b: UnifiedBase, kg: number): UnifiedBase {
  const x = Math.min(b.processedKg, Math.max(0, kg))
  if (x <= 0) return b
  return { ...b, processedKg: b.processedKg - x, exportedKg: b.exportedKg + x }
}

/** Craft processed kg into POTATO (off-chain ledger). Refused until PotatoPerKg is calibrated. */
export function craftPotato(b: UnifiedBase, kg: number): UnifiedBase {
  if (b.potatoPerKg === null) return b
  const x = Math.min(b.processedKg, Math.max(0, kg))
  if (x <= 0) return b
  return {
    ...b,
    processedKg: b.processedKg - x,
    craftedKg: b.craftedKg + x,
    potatoLedger: b.potatoLedger + x * b.potatoPerKg,
  }
}
