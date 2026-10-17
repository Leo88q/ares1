/**
 * A deterministic, LOCAL design sandbox, not the Solana economy or flight software.
 * Units: Earth days, kWh, litres, kg, crew-hours and non-convertible game credits.
 * Evidence, assumptions and deliberately omitted physics: docs/LUNAR_FARM_PLAN.md.
 * No wallet, RPC, token mint, random reward, price oracle or background accrual.
 */
export type ModuleKind = 'solar' | 'greenhouse' | 'habitat' | 'recycler' | 'rover' | 'workshop' | 'battery'

import { BEDS, PARAMETERS } from '../organism/parameters'
import {
  addPlot, advanceDay as unifiedAdvance, canHarvestBed as unifiedCanHarvest, exportKg, harvestBed as unifiedHarvest,
  initialUnifiedBase, storedKg, type UnifiedBase,
} from '../organism/unified'

/** Storage limit of the base (kg of raw + processed food). Decision §32 / P1b: 120 kg. */
export const COLONY_STORAGE_KG = 120
export { PARAMETERS }

export const CATALOG: Record<ModuleKind, { credits: number; wearDay: number; file: string; color: string }> = {
  solar: { credits: 120, wearDay: 0.25, file: 'solar.glb', color: '#e6bc6b' },
  greenhouse: { credits: 250, wearDay: 0.4, file: 'greenhouse.glb', color: '#91cba2' },
  habitat: { credits: 180, wearDay: 0.15, file: 'habitat.glb', color: '#d9e2ed' },
  recycler: { credits: 100, wearDay: 0.3, file: 'recycler.glb', color: '#72c5d5' },
  rover: { credits: 180, wearDay: 0.6, file: 'rover.glb', color: '#e89b6e' },
  workshop: { credits: 140, wearDay: 0.2, file: 'workshop.glb', color: '#adabc8' },
  battery: { credits: 90, wearDay: 0.15, file: 'battery.glb', color: '#d3be85' },
}
export const MODULE_KINDS = Object.keys(CATALOG) as ModuleKind[]
export const SLOTS = Array.from({ length: 24 }, (_, index) => ({
  x: ((index % 6) - 2.5) * 4.8,
  z: (Math.floor(index / 6) - 1.5) * 4.8,
}))

export interface ColonyModule {
  id: string
  kind: ModuleKind
  slot: number
  condition: number
  growthDays: number
  /**
   * WP10 (§14.3): greenhouse beds, one value per bed (K = BEDS.perField). Value = days of growth,
   * 0 ≤ v < cycle while growing; negative = not yet planted (staggered by cycle / K). growthDays mirrors
   * beds[0]. Missing (legacy saves) → derived from growthDays.
   */
  beds?: number[]
  /** Cumulative kg collected from this greenhouse's beds (each completed bed cycle, 36 kg by default). */
  bedsHarvestedKg?: number
}
export interface Scenario {
  sunHours: number
  waterRecovery: number
}
export const DEFAULT_SCENARIO: Scenario = { sunHours: 18, waterRecovery: 0.94 }

export interface ColonyState {
  day: number
  modules: ColonyModule[]
  crew: number
  credits: number
  spentCredits: number
  earnedCredits: number
  waterLitres: number
  nutrientsKg: number
  sparesKg: number
  foodKg: number
  oxygenKg: number
  oxygenShortfallKg: number
  batteryKwh: number
  harvestedKg: number
  consumedFoodKg: number
  foodShortfallKg: number
  deliveredKg: number
  lastDay: DayBudget | null
  /** Single source of truth for food, beds and harvest (organism/unified.ts). The fields above are views of it. */
  ledger: UnifiedBase
}

export interface DayBudget {
  generationKwh: number
  demandKwh: number
  servedKwh: number
  unmetKwh: number
  curtailedKwh: number
  batteryChargeInputKwh: number
  batteryDischargeOutputKwh: number
  batteryEndKwh: number
  essentialPowerFraction: number
  cropPowerFraction: number
  cropAreaM2: number
  recovery: number
  waterUsedLitres: number
  waterNeededLitres: number
  waterShortfallLitres: number
  nutrientsUsedKg: number
  growthFraction: number
  workHours: number
  availableWorkHours: number
  oxygenProducedKg: number
  oxygenDemandKg: number
  oxygenShortfallKg: number
  oxygenVentedKg: number
  oxygenEndKg: number
}

/** Starting food (kg). 120 kg lets a colony with no repairs get through the first full crop cycle plus 30 days
 *  without shortfall (80 kg ran out on day 112). Owner balance decision — see docs/ORGANISM_INTEGRATION.md §29. */
export const INITIAL_FOOD_KG = 120

export function initialColony(): ColonyState {
  const starter: Array<[ModuleKind, number]> = [
    ['solar', 0], ['solar', 6], ['battery', 1], ['habitat', 4],
    ['greenhouse', 9], ['recycler', 15], ['workshop', 17], ['rover', 21],
  ]
  const modules: ColonyModule[] = starter.map(([kind, slot], i) => ({
    id: `${kind}-${i + 1}`, kind, slot, condition: 100,
    // Existing expedition crop. NEW greenhouses always start at zero.
    growthDays: kind === 'greenhouse' ? 60 : 0,
    beds: kind === 'greenhouse' ? greenhouseBeds(60) : undefined,
  }))
  const ledger = initialUnifiedBase({
    plots: modules.filter(m => m.kind === 'greenhouse').map(m => ({ id: m.id, tier: 0 as const, beds: [...(m.beds ?? [])] })),
    crew: 4, storageCapKg: COLONY_STORAGE_KG, startKg: INITIAL_FOOD_KG,
  })
  return syncView({
    day: 0, modules, crew: 4, credits: PARAMETERS.initialCredits, spentCredits: 0, earnedCredits: 0,
    waterLitres: 800, nutrientsKg: 4, sparesKg: 8, foodKg: 0, oxygenKg: PARAMETERS.oxygenStartKg, oxygenShortfallKg: 0,
    batteryKwh: 80,
    harvestedKg: 0, consumedFoodKg: 0, foodShortfallKg: 0, deliveredKg: 0, lastDay: null, ledger,
  })
}

/** Recompute every view field from the ledger, so the UI and old tests read the same numbers as the ledger. */
export function syncView(state: ColonyState): ColonyState {
  const plotOf = new Map(state.ledger.plots.map(p => [p.id, p]))
  const modules = state.modules.map(m => {
    if (m.kind !== 'greenhouse') return m
    const plot = plotOf.get(m.id)
    if (!plot) return m
    return { ...m, beds: [...plot.beds], growthDays: Math.max(0, plot.beds[0] ?? 0), bedsHarvestedKg: plot.harvestedKg }
  })
  const l = state.ledger
  return {
    ...state, modules,
    foodKg: storedKg(l), harvestedKg: l.harvestedKg, consumedFoodKg: l.eatenKg,
    foodShortfallKg: l.foodShortfallKg, deliveredKg: l.exportedKg,
  }
}

export function validateScenario(s: Scenario): void {
  if (!Number.isFinite(s.sunHours) || s.sunHours < 0 || s.sunHours > 24
    || !Number.isFinite(s.waterRecovery) || s.waterRecovery < 0 || s.waterRecovery > 0.98) {
    throw new RangeError('Scenario: sunHours must be 0–24; waterRecovery must be 0–0.98')
  }
}
const fraction = (available: number, required: number): number => required > 0 ? Math.min(1, Math.max(0, available / required)) : 1
const capacityFactor = (m: ColonyModule): number => Math.max(0.2, m.condition / 100)

/** WP10: bed i is planted (cycle / K) days after bed i − 1. `leadDays` = growth of bed 0. */
export const bedStepDays = (): number => PARAMETERS.cropCycleDays / BEDS.perField
export function greenhouseBeds(leadDays: number): number[] {
  return Array.from({ length: BEDS.perField }, (_, i) => leadDays - i * bedStepDays())
}
/** Grow every bed by `growth` days; a bed that completes one cycle is harvested and restarts from the excess. */
export function stepBeds(beds: readonly number[], growth: number): { beds: number[]; completed: number } {
  const cycle = PARAMETERS.cropCycleDays
  let completed = 0
  const next = beds.map(v => {
    if (v < 0) return v + growth >= 0 ? 0 : v + growth // planting: the excess day is dropped
    let x = v + growth
    if (x >= cycle - 1e-9) { completed += 1; x -= cycle }
    return x
  })
  return { beds: next, completed }
}
/**
 * Per-bed summary for the colony screen. Planted = bed value ≥ 0 (values never go negative again once planted).
 * Ripe = inside the maturity window (≥ 80 % of the cycle, M2) but not yet collected. The colony model collects a
 * bed automatically at 100 % of the cycle, so "ripe" is the pre-harvest window, not a separate manual action.
 */
export type BedState = 'waiting' | 'growing' | 'ripe'
export interface BedSummary {
  beds: Array<{ state: BedState; progress: number }>
  planted: number
  ripe: number
  total: number
  collectedKg: number
}
export function bedSummary(m: ColonyModule): BedSummary {
  const values = m.beds ?? greenhouseBeds(m.growthDays)
  const cycle = PARAMETERS.cropCycleDays
  const beds = values.slice(0, BEDS.perField).map(v => {
    if (v < 0) return { state: 'waiting' as BedState, progress: 0 }
    const progress = Math.min(1, v / cycle)
    return { state: (progress >= BEDS.harvestWindowMinRatio ? 'ripe' : 'growing') as BedState, progress }
  })
  return {
    beds,
    planted: beds.filter(b => b.state !== 'waiting').length,
    ripe: beds.filter(b => b.state === 'ripe').length,
    total: BEDS.perField,
    collectedKg: m.bedsHarvestedKg ?? 0,
  }
}

/** kg of one bed at full cycle: area × yield × cycle ÷ K (216 kg / 6 = 36 kg for the default greenhouse). */
export const bedCycleKg = (): number => PARAMETERS.cropAreaM2 * PARAMETERS.cropKgM2Day * PARAMETERS.cropCycleDays / BEDS.perField

/**
 * Manual harvest of one greenhouse bed (§31.12, flag VITE_COLONY_MANUAL_HARVEST). One rule for the whole base
 * (organism/unified.ts): factor from harvestFactor (T2 30–80 %, window to 120 %), refused when storage is full.
 */
export function canHarvestBed(state: ColonyState, moduleId: string, index: number): boolean {
  return unifiedCanHarvest(state.ledger, moduleId, index)
}
export function harvestBed(state: ColonyState, moduleId: string, index: number): ColonyState {
  const ledger = unifiedHarvest(state.ledger, moduleId, index)
  return ledger === state.ledger ? state : syncView({ ...state, ledger })
}

export const countModules = (s: ColonyState, kind: ModuleKind): number => s.modules.filter(m => m.kind === kind).length
export const batteryCapacity = (s: ColonyState): number => countModules(s, 'battery') * PARAMETERS.batteryKwh
export const foodDemand = (s: ColonyState): number => s.crew * PARAMETERS.freshFoodKgCrewDay
export const foodReserve = (s: ColonyState): number => foodDemand(s) * PARAMETERS.reserveDays

/** Daily aggregate energy dispatch. It does NOT resolve within-day blackouts. */
export function dailyBudget(state: ColonyState, scenario: Scenario = DEFAULT_SCENARIO): DayBudget {
  validateScenario(scenario)
  const p = PARAMETERS
  const greenhouse = state.modules.filter(m => m.kind === 'greenhouse')
  const cropAreaM2 = greenhouse.length * p.cropAreaM2
  const healthyCropArea = greenhouse.reduce((sum, m) => sum + capacityFactor(m) * p.cropAreaM2, 0)
  const generationKwh = state.modules.filter(m => m.kind === 'solar')
    .reduce((sum, m) => sum + p.solarFluxKwM2 * p.panelAreaM2 * p.panelEfficiency * p.panelDerating * scenario.sunHours * capacityFactor(m), 0)
  const crewWater = state.crew * p.crewWaterLitresDay
  const evaporation = healthyCropArea * p.cropEvapLitresM2Day
  const grossLoopWater = crewWater + evaporation
  const recyclerCapacity = state.modules.filter(m => m.kind === 'recycler')
    .reduce((sum, m) => sum + p.recyclerLitresDay * capacityFactor(m), 0)
  const recyclerKwh = Math.min(grossLoopWater, recyclerCapacity) * p.recyclerKwhLitre
  const recyclerO2CapacityKg = state.modules.filter(m => m.kind === 'recycler')
    .reduce((sum, m) => sum + p.recyclerO2KgDay * capacityFactor(m), 0)
  const electrolysisKwh = recyclerO2CapacityKg * p.electrolysisKwhKgO2
  const essentialKwh = countModules(state, 'habitat') * p.habitatKwhDay
    + countModules(state, 'rover') * p.roverKwhDay
    + countModules(state, 'workshop') * p.workshopKwhDay + recyclerKwh + electrolysisKwh
  const cropKwh = cropAreaM2 * (p.ledKwM2 * p.photoperiodHours + p.cropUtilitiesKwM2 * 24)
  const demandKwh = essentialKwh + cropKwh
  const shortage = Math.max(0, demandKwh - generationKwh)
  const batteryDischargeOutputKwh = Math.min(shortage, state.batteryKwh * p.batteryDischargeEfficiency)
  const servedKwh = Math.min(demandKwh, generationKwh + batteryDischargeOutputKwh)
  const essentialPowerFraction = fraction(servedKwh, essentialKwh)
  const cropPowerFraction = fraction(Math.max(0, servedKwh - essentialKwh), cropKwh)
  const surplus = Math.max(0, generationKwh - demandKwh)
  const batteryChargeInputKwh = Math.min(surplus, Math.max(0, batteryCapacity(state) - state.batteryKwh) / p.batteryChargeEfficiency)
  const batteryEndKwh = Math.max(0, Math.min(batteryCapacity(state), state.batteryKwh
    - batteryDischargeOutputKwh / p.batteryDischargeEfficiency
    + batteryChargeInputKwh * p.batteryChargeEfficiency))

  // Treat operating all essential systems at the served fraction. No recycling
  // credit is given to unpowered hardware. Capacity is deliberately finite.
  const recovery = scenario.waterRecovery * fraction(recyclerCapacity, grossLoopWater) * essentialPowerFraction
  // Electrolysis water circulates in the same recycler loop as crew water; only the unrecovered share is makeup.
  // Electrolysis cannot run without makeup water in the tank: cap output by the water it can draw.
  const o2WaterCapKg = state.waterLitres / (p.electrolysisWaterKgPerKgO2 * (1 - recovery))
  const electrolysisO2Kg = Math.min(recyclerO2CapacityKg * essentialPowerFraction, o2WaterCapKg)
  const o2WaterLitres = electrolysisO2Kg * p.electrolysisWaterKgPerKgO2 * (1 - recovery)
  const crewMakeup = crewWater * (1 - recovery) + p.leakLitresDay + o2WaterLitres
  const cropMakeup = evaporation * (1 - recovery) + healthyCropArea * p.cropKgM2Day * p.cropWaterBoundLitresKg
  const workHours = healthyCropArea * p.cropWorkHoursM2Day
    + countModules(state, 'solar') * 0.2 + countModules(state, 'recycler') * 0.5
    + countModules(state, 'rover') * 0.8 + countModules(state, 'workshop') * 0.75
  const supportedCrew = Math.min(state.crew, countModules(state, 'habitat') * p.crewPerHabitat)
  const availableWorkHours = supportedCrew * p.workHoursCrewDay
  const workFraction = fraction(availableWorkHours, workHours)
  const nutrientsNeeded = healthyCropArea * p.cropKgM2Day * p.cropNutrientKgPerKg
  const growthFraction = Math.min(cropPowerFraction, workFraction,
    fraction(Math.max(0, state.waterLitres - crewMakeup), cropMakeup),
    fraction(state.nutrientsKg, nutrientsNeeded)) * essentialPowerFraction
  const waterNeededLitres = crewMakeup + cropMakeup * Math.min(cropPowerFraction, workFraction) * essentialPowerFraction
  const waterUsedLitres = Math.min(state.waterLitres, crewMakeup + cropMakeup * growthFraction)
  // Oxygen: electrolysis (powered recyclers) plus photosynthesis (actual biomass growth).
  const oxygenProducedKg = electrolysisO2Kg + healthyCropArea * p.cropKgM2Day * growthFraction * p.cropO2KgPerKgFresh
  const oxygenDemandKg = state.crew * p.crewO2KgDay
  const oxygenAvailableKg = state.oxygenKg + oxygenProducedKg
  return {
    generationKwh, demandKwh, servedKwh, unmetKwh: Math.max(0, demandKwh - servedKwh),
    curtailedKwh: surplus - batteryChargeInputKwh,
    batteryChargeInputKwh, batteryDischargeOutputKwh, batteryEndKwh,
    essentialPowerFraction, cropPowerFraction, cropAreaM2, recovery,
    waterUsedLitres, waterNeededLitres,
    waterShortfallLitres: Math.max(0, waterNeededLitres - state.waterLitres),
    nutrientsUsedKg: Math.min(state.nutrientsKg, nutrientsNeeded * growthFraction),
    growthFraction, workHours, availableWorkHours,
    oxygenProducedKg, oxygenDemandKg,
    oxygenShortfallKg: Math.max(0, oxygenDemandKg - oxygenAvailableKg),
    oxygenVentedKg: Math.max(0, oxygenAvailableKg - oxygenDemandKg - p.oxygenTankKg),
    oxygenEndKg: Math.min(p.oxygenTankKg, Math.max(0, oxygenAvailableKg - oxygenDemandKg)),
  }
}

export function advanceDay(state: ColonyState, scenario: Scenario = DEFAULT_SCENARIO): ColonyState {
  const budget = dailyBudget(state, scenario)
  if (state.day >= PARAMETERS.maxDays) return state
  // Growth of each greenhouse = energy/water/light budget × its condition (the same limits as before).
  const growthOf = (id: string): number => {
    const m = state.modules.find(x => x.id === id)
    return m ? budget.growthFraction * capacityFactor(m) : 0
  }
  const ledger = unifiedAdvance(state.ledger, growthOf)
  const modules = state.modules.map(m => ({ ...m, condition: Math.max(20, m.condition - CATALOG[m.kind].wearDay) }))
  return syncView({
    ...state, modules, day: state.day + 1, batteryKwh: budget.batteryEndKwh,
    oxygenKg: budget.oxygenEndKg, oxygenShortfallKg: state.oxygenShortfallKg + budget.oxygenShortfallKg,
    waterLitres: Math.max(0, state.waterLitres - budget.waterUsedLitres),
    nutrientsKg: Math.max(0, state.nutrientsKg - budget.nutrientsUsedKg),
    lastDay: budget, ledger,
  })
}

export function advanceDays(state: ColonyState, days: number, scenario: Scenario = DEFAULT_SCENARIO): ColonyState {
  validateScenario(scenario)
  if (!Number.isInteger(days) || days < 0 || days > PARAMETERS.maxDays) throw new RangeError('days must be an integer from 0 to 365')
  let next = state
  for (let i = 0; i < days && next.day < PARAMETERS.maxDays; i++) next = advanceDay(next, scenario)
  return next
}

export function canBuild(state: ColonyState, kind: ModuleKind): boolean {
  return state.modules.length < SLOTS.length && state.credits >= CATALOG[kind].credits && state.sparesKg >= 1
}
export function buildModule(state: ColonyState, kind: ModuleKind): ColonyState {
  if (!canBuild(state, kind)) return state
  const used = new Set(state.modules.map(m => m.slot))
  const slot = SLOTS.findIndex((_, i) => !used.has(i))
  const cost = CATALOG[kind].credits
  const id = `${kind}-${state.modules.length + 1}`
  const module: ColonyModule = { id, kind, slot, condition: 100, growthDays: 0, beds: kind === 'greenhouse' ? greenhouseBeds(0) : undefined }
  const ledger = kind === 'greenhouse' ? addPlot(state.ledger, { id, tier: 0, beds: greenhouseBeds(0), harvestedKg: 0 }) : state.ledger
  return syncView({ ...state, credits: state.credits - cost, spentCredits: state.spentCredits + cost,
    sparesKg: state.sparesKg - 1, modules: [...state.modules, module], ledger })
}

export function canRepair(state: ColonyState): boolean {
  return countModules(state, 'workshop') > 0 && state.credits >= PARAMETERS.repairCredits
    && state.sparesKg >= PARAMETERS.repairSparesKg && state.modules.some(m => m.condition < 100)
}
export function repairColony(state: ColonyState): ColonyState {
  if (!canRepair(state)) return state
  return { ...state, credits: state.credits - PARAMETERS.repairCredits,
    spentCredits: state.spentCredits + PARAMETERS.repairCredits, sparesKg: state.sparesKg - PARAMETERS.repairSparesKg,
    modules: state.modules.map(m => ({ ...m, condition: 100 })),
  }
}

export function buySupplies(state: ColonyState): ColonyState {
  const p = PARAMETERS
  if (state.credits < p.supplyCredits) return state
  return { ...state, credits: state.credits - p.supplyCredits, spentCredits: state.spentCredits + p.supplyCredits,
    waterLitres: state.waterLitres + p.supplyWaterLitres, nutrientsKg: state.nutrientsKg + p.supplyNutrientKg,
    sparesKg: state.sparesKg + p.supplySparesKg,
  }
}

export function sellableKg(state: ColonyState): number {
  // A finite, pre-funded fictional buyer, not an oracle, emission or market forecast.
  if (countModules(state, 'rover') === 0) return 0
  return Math.max(0, Math.min(10, state.ledger.processedKg - foodReserve(state), PARAMETERS.contractKg - state.deliveredKg))
}
export function deliverFood(state: ColonyState): ColonyState {
  const amount = sellableKg(state)
  if (!amount) return state
  const revenue = amount * PARAMETERS.contractCreditsKg
  return syncView({ ...state, ledger: exportKg(state.ledger, amount),
    credits: state.credits + revenue, earnedCredits: state.earnedCredits + revenue })
}
