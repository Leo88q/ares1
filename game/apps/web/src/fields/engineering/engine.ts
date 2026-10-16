/**
 * Independent, deterministic engineering lesson for an EXISTING field ID.
 * ARES-LAB/2 parameters are game assumptions, NOT validated Mars agriculture.
 * No token balances, accounts, RPC, storage, randomness or wall-clock ticks.
 */
import { BEDS, LAB } from '../../organism/parameters'
import { harvestFactor } from '../../organism/beds'
export { LAB }

export type CropStage = 'empty' | 'seedling' | 'vegetative' | 'tuber' | 'mature' | 'dead'
export type Bottleneck = 'none' | 'pump' | 'water' | 'power' | 'nutrients' | 'storage' | 'temperature' | 'dead'
export interface FoodLot {
  id: number
  kind: 'raw' | 'processed'
  kg: number
  bornHour: number
  ageHours: number
  baseQuality: number
}
export interface ProcessingJob { remainingKg: number; ageHours: number; baseQuality: number; outputId: number }
export interface Crop { planted: boolean; progress: number; health: number; matureHour?: number; plantedHour?: number }
export interface LabSample {
  hour: number; battery: number; water: number; growth: number; health: number
  solarKw: number; servedKw: number; light: number; irrigation: number; cold: number
  temperatureC: number; outsideC: number; targetC: number; temperatureFactor: number
  climateMode: 'idle' | 'heating' | 'cooling'; climateKw: number; climateFraction: number
}
export type LabEventCode = 'seed' | 'harvest' | 'refill' | 'fault' | 'repair' | 'dust' | 'process' | 'processed' | 'spoiled' | 'dead' | 'cold'
export interface LabEvent { hour: number; code: LabEventCode; amount: number }
export interface EngineeringState {
  profileVersion: string
  fieldId: string
  tier: 0 | 1 | 2
  hour: number
  batteryKwh: number
  temperatureC: number
  tankL: number
  supplyL: number
  lineL: number
  nutrientsKg: number
  seeds: number
  spares: number
  crop: Crop
  controls: { lights: boolean; pump: boolean; battery: boolean; cooling: boolean; pumpFault: boolean; climate: boolean; targetC: number; priority: 'crop' | 'food' }
  dustUntil: number
  coldUntil: number
  lots: FoodLot[]
  processing: ProcessingJob | null
  nextLotId: number
  history: LabSample[]
  events: LabEvent[]
  last: LabSample & { bottleneck: Bottleneck }
  totals: {
    solarKwh: number; servedKwh: number; unservedKwh: number; curtailedKwh: number
    chargeInputKwh: number; dischargeOutputKwh: number
    waterConsumedL: number; nutrientsConsumedKg: number
    harvestedKg: number; spoiledKg: number; processingLossKg: number
    heaterHeatKwh: number; lampHeatKwh: number; passiveHeatKwh: number
    climateRemovedKwh: number; evaporationKwh: number
  }
}
export type EngineeringAction =
  | { type: 'advance'; hours: number }
  | { type: 'toggle'; control: 'lights' | 'pump' | 'battery' | 'cooling' | 'climate' }
  | { type: 'plant' | 'clear' | 'harvest' | 'refill' | 'fault' | 'repair' | 'dust' | 'cold' }
  | { type: 'process'; lotId: number }
  | { type: 'setpoint'; value: number }
  | { type: 'priority'; value: 'crop' | 'food' }

const EPS = 1e-9
const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n))
export const labScale = (tier: 0 | 1 | 2): number => [1, 1.35, 1.7][tier]
export const cropStage = (crop: Crop): CropStage => !crop.planted ? 'empty' : crop.health <= EPS ? 'dead' : crop.progress >= 1 - EPS ? 'mature' : crop.progress < 0.2 ? 'seedling' : crop.progress < 0.55 ? 'vegetative' : 'tuber'
export const lotQuality = (lot: Pick<FoodLot, 'kind' | 'baseQuality' | 'ageHours'>): number => clamp(lot.baseQuality * (1 - lot.ageHours / (lot.kind === 'raw' ? LAB.rawShelfHours : LAB.processedShelfHours)))
export const storageKg = (state: EngineeringState): number => state.lots.reduce((sum, lot) => sum + lot.kg, 0) + (state.processing?.remainingKg ?? 0)
/**
 * Maturity ratio for the harvest window (WP11). Before maturity: growth progress (0…1).
 * After maturity: 1 + hours since maturity / overripeHours. Dead or unplanted crops: 0.
 */
export const maturityRatio = (state: EngineeringState): number => {
  const crop = state.crop
  if (!crop.planted || crop.health <= EPS) return 0
  if (crop.progress < 1 - EPS) return crop.progress
  const since = Math.max(0, state.hour - (crop.matureHour ?? state.hour))
  return 1 + since / LAB.overripeHours
}
/**
 * T4 (approved, H): cost of delay. Time from planting to harvest beyond nominalCycleHours
 * reduces yield linearly, reaching 0 at 2 × nominalCycleHours. Crops without plantedHour: 1.
 */
export const delayFactor = (state: EngineeringState): number => {
  if (state.crop.plantedHour === undefined) return 1
  const elapsed = Math.max(0, state.hour - state.crop.plantedHour)
  return clamp(1 - Math.max(0, elapsed - LAB.nominalCycleHours) / LAB.nominalCycleHours)
}
/** Harvest mass now: base × scale × health × window factor × delay factor (T4). */
export const harvestMass = (state: EngineeringState): number =>
  LAB.harvestKg * labScale(state.tier) * clamp(state.crop.health) * harvestFactor(maturityRatio(state)) * delayFactor(state)
export const canHarvest = (state: EngineeringState): boolean => harvestFactor(maturityRatio(state)) > 0 && state.lots.length < LAB.maxLots && storageKg(state) + harvestMass(state) <= LAB.storageCapacityKg * labScale(state.tier) + EPS
export const solarFraction = (hour: number): number => Math.max(0, Math.sin(Math.PI * (((hour + 8) % LAB.solHours) / LAB.solHours * 2 - 0.5)))
export const lightsScheduled = (hour: number): boolean => {
  const phase = (hour + 8) % LAB.solHours
  return phase >= 4 && phase < 4 + LAB.lightHoursPerSol
}

/** Versioned game response curve; not a measured cultivar-specific model. */
// T6b (approved, H): the cold branch below 16 °C is squared, so cold costs more growth than before
// (0.67 → 0.44 at 12 °C). Continuous at 16 °C (value 1) and at 4 °C (value 0).
export const temperatureGrowthFactor = (celsius: number): number =>
  !Number.isFinite(celsius) || celsius <= 4 || celsius >= 36 ? 0
    : celsius < 16 ? ((celsius - 4) / 12) ** 2 : celsius <= 22 ? 1 : (36 - celsius) / 14
export const outsideTemperature = (hour: number, coldUntil = 0): number =>
  LAB.outsideMinC + LAB.outsideDayAmplitudeC * solarFraction(hour) - (hour < coldUntil ? LAB.coldEventDropC : 0)

function event(state: EngineeringState, code: LabEventCode, amount = 0, hour = state.hour): void {
  state.events = [...state.events, { hour, code, amount }].slice(-LAB.maxEvents)
}
export function initialEngineering(fieldId: string, tier: 0 | 1 | 2): EngineeringState {
  const scale = labScale(tier)
  const sample: LabSample = { hour: 0, battery: LAB.batteryInitialKwh / LAB.batteryCapacityKwh, water: LAB.tankInitialL / LAB.tankCapacityL, growth: 0, health: 1, solarKw: LAB.solarPeakKw * scale * solarFraction(0), servedKw: 0, light: 1, irrigation: 1, cold: 0, temperatureC: LAB.initialTemperatureC, outsideC: outsideTemperature(0), targetC: LAB.targetTemperatureC, temperatureFactor: 1, climateMode: 'idle', climateKw: 0, climateFraction: 0 }
  return {
    profileVersion: LAB.version, fieldId, tier, hour: 0, temperatureC: LAB.initialTemperatureC, batteryKwh: LAB.batteryInitialKwh * scale,
    tankL: LAB.tankInitialL * scale, supplyL: LAB.supplyInitialL * scale, lineL: LAB.lineInitialL * scale,
    nutrientsKg: LAB.nutrientsInitialKg * scale, seeds: LAB.seedsInitial - 1, spares: LAB.sparesInitial,
    crop: { planted: true, progress: 0, health: 1, plantedHour: 0 },
    controls: { lights: true, pump: true, battery: true, cooling: true, pumpFault: false, climate: true, targetC: LAB.targetTemperatureC, priority: 'crop' },
    dustUntil: 0, coldUntil: 0, lots: [], processing: null, nextLotId: 1, history: [sample], events: [{ hour: 0, code: 'seed', amount: 1 }],
    last: { ...sample, bottleneck: 'none' },
    totals: { solarKwh: 0, servedKwh: 0, unservedKwh: 0, curtailedKwh: 0, chargeInputKwh: 0, dischargeOutputKwh: 0, waterConsumedL: 0, nutrientsConsumedKg: 0, harvestedKg: 0, spoiledKg: 0, processingLossKg: 0, heaterHeatKwh: 0, lampHeatKwh: 0, passiveHeatKwh: 0, climateRemovedKwh: 0, evaporationKwh: 0 },
  }
}
function clone(state: EngineeringState): EngineeringState {
  return { ...state, crop: { ...state.crop }, controls: { ...state.controls }, lots: state.lots.map(lot => ({ ...lot })), processing: state.processing ? { ...state.processing } : null, totals: { ...state.totals }, last: { ...state.last }, history: [...state.history], events: [...state.events] }
}

/** Fixed-step dispatch with water, energy, nutrients and food mass accounting. */
function tick(state: EngineeringState, dt: number): void {
  const scale = labScale(state.tier), hour = state.hour + dt / 2
  const living = state.crop.planted && state.crop.health > EPS
  const scheduled = living && state.controls.lights && lightsScheduled(hour)
  const pumpWorking = state.controls.pump && !state.controls.pumpFault && state.tankL > EPS && state.lineL < LAB.lineCapacityL * scale - EPS
  const needsCold = state.lots.some(lot => lot.kg > EPS) || !!state.processing
  const demandPump = pumpWorking ? LAB.pumpKw * scale * dt : 0
  const demandLight = scheduled ? LAB.lampKw * scale * dt : 0
  const demandCold = state.controls.cooling && needsCold ? LAB.coolerKw * scale * dt : 0
  const demandProcess = state.processing ? LAB.processorKw * scale * dt : 0
  const outsideC = outsideTemperature(hour, state.coldUntil)
  const startTemperature = state.temperatureC
  const waterRate = living ? (0.25 + state.crop.progress * 0.22) * scale * clamp(1 + (startTemperature - 20) * 0.02, 0.6, 1.35) : 0
  const expectedHeatLossKw = LAB.envelopeKwPerC * scale * (startTemperature - outsideC)
    + waterRate * LAB.evapFraction * LAB.latentKwhPerL - (scheduled ? LAB.lampKw * scale * LAB.lampHeatFraction : 0)
  const heatNeedKw = expectedHeatLossKw + (state.controls.targetC - startTemperature) * LAB.thermalCapacityKwhPerC * scale / LAB.thermostatResponseHours
  const climateMode: LabSample['climateMode'] = !state.controls.climate ? 'idle' : heatNeedKw >= 0 ? 'heating' : 'cooling'
  const climateKw = climateMode === 'heating' ? Math.min(LAB.heaterKw * scale, Math.max(0, heatNeedKw))
    : climateMode === 'cooling' ? Math.min(LAB.climateCoolerKw * scale, Math.max(0, -heatNeedKw) / LAB.climateCoolingCop) : 0
  const demandClimate = climateKw * dt
  const demand = demandPump + demandLight + demandCold + demandProcess + demandClimate
  const solar = LAB.solarPeakKw * scale * solarFraction(hour) * (hour < state.dustUntil ? 0.18 : 1) * dt
  const direct = Math.min(solar, demand)
  const discharge = state.controls.battery ? Math.min(demand - direct, state.batteryKwh * LAB.dischargeEfficiency) : 0
  state.batteryKwh -= discharge / LAB.dischargeEfficiency
  const charge = Math.min(Math.max(0, solar - direct), Math.max(0, LAB.batteryCapacityKwh * scale - state.batteryKwh) / LAB.chargeEfficiency)
  state.batteryKwh += charge * LAB.chargeEfficiency
  const curtailed = Math.max(0, solar - direct - charge)
  // Water always comes first. The operator explicitly chooses what to protect next.
  const needs = { pump: demandPump, climate: demandClimate, light: demandLight, cold: demandCold, processing: demandProcess }
  const fractions = { pump: 0, climate: 0, light: 0, cold: 0, processing: 0 }
  const order: (keyof typeof needs)[] = state.controls.priority === 'food'
    ? ['pump', 'cold', 'climate', 'light', 'processing'] : ['pump', 'climate', 'light', 'cold', 'processing']
  let remaining = direct + discharge
  for (const node of order) {
    const allocation = Math.min(needs[node], Math.max(0, remaining)); remaining -= allocation
    fractions[node] = needs[node] > EPS ? allocation / needs[node] : 0
  }
  const { pump: pumpFraction, climate: climateFraction, light: lightFraction, cold: coldFraction, processing: processFraction } = fractions
  const served = direct + discharge - Math.max(0, remaining)
  state.totals.solarKwh += solar; state.totals.servedKwh += served
  state.totals.unservedKwh += Math.max(0, demand - served); state.totals.curtailedKwh += curtailed
  state.totals.chargeInputKwh += charge; state.totals.dischargeOutputKwh += discharge

  const delivered = Math.min(state.tankL, Math.max(0, LAB.lineCapacityL * scale - state.lineL), LAB.pumpRateLph * scale * dt * pumpFraction)
  state.tankL -= delivered; state.lineL += delivered
  const waterNeed = waterRate * dt
  const waterUsed = Math.min(state.lineL, waterNeed)
  state.lineL -= waterUsed; state.totals.waterConsumedL += waterUsed
  const irrigation = waterNeed > EPS ? waterUsed / waterNeed : 1
  const heaterHeat = climateMode === 'heating' ? demandClimate * climateFraction : 0
  const climateRemoved = climateMode === 'cooling' ? demandClimate * climateFraction * LAB.climateCoolingCop : 0
  const lampHeat = demandLight * lightFraction * LAB.lampHeatFraction
  const passiveHeat = LAB.envelopeKwPerC * scale * (outsideC - startTemperature) * dt
  const evaporationHeat = waterUsed * LAB.evapFraction * LAB.latentKwhPerL
  state.temperatureC += (heaterHeat + lampHeat + passiveHeat - climateRemoved - evaporationHeat) / (LAB.thermalCapacityKwhPerC * scale)
  state.totals.heaterHeatKwh += heaterHeat; state.totals.lampHeatKwh += lampHeat; state.totals.passiveHeatKwh += passiveHeat
  state.totals.climateRemovedKwh += climateRemoved; state.totals.evaporationKwh += evaporationHeat
  const temperatureFactor = temperatureGrowthFactor((startTemperature + state.temperatureC) / 2)
  let nutrientFraction = 1
  if (living && state.crop.progress < 1 - EPS) {
    const potential = Math.min(1 - state.crop.progress, dt * lightFraction * irrigation * temperatureFactor * Math.max(0.2, state.crop.health) / LAB.growthLightHours)
    const need = potential * LAB.nutrientsPerCycleKg * scale
    nutrientFraction = need > EPS ? Math.min(1, state.nutrientsKg / need) : 1
    const used = need * nutrientFraction
    state.nutrientsKg -= used; state.totals.nutrientsConsumedKg += used
    state.crop.progress = clamp(state.crop.progress + potential * nutrientFraction)
    if (state.crop.progress >= 1 - EPS && state.crop.matureHour === undefined) state.crop.matureHour = state.hour + dt
  }
  if (living) {
    const resourceStress = irrigation < 0.6 ? (1 - irrigation) * LAB.irrigationStressPerHour : scheduled && lightFraction < 0.5 ? (1 - lightFraction) * 0.006 : nutrientFraction < 0.5 ? 0.009 : 0
    // T1: sustained heat above the plateau slowly damages health (per degree-hour above heatStressAboveC).
    const heatStress = Math.max(0, (startTemperature + state.temperatureC) / 2 - LAB.heatStressAboveC) * LAB.heatStressPerCHour
    const stress = resourceStress + heatStress + (temperatureFactor < 0.7 ? (1 - temperatureFactor) * 0.014 : 0)
    state.crop.health = clamp(state.crop.health + (stress > 0 ? -stress : 0.0018) * dt)
    if (state.crop.health <= EPS) { state.crop.health = 0; event(state, 'dead', 0, state.hour + dt) }
  }
  const ageFactor = 1 - coldFraction * (1 - LAB.coldAgeFactor)
  for (const lot of state.lots) {
    lot.ageHours += dt * ageFactor
    if (lot.kg > EPS && lotQuality(lot) <= EPS) { state.totals.spoiledKg += lot.kg; event(state, 'spoiled', lot.kg, state.hour + dt); lot.kg = 0 }
  }
  if (state.processing) {
    const job = state.processing
    job.ageHours += dt * ageFactor
    const quality = lotQuality({ ...job, kind: 'raw' })
    const output = state.lots.find(lot => lot.id === job.outputId)
    if (quality <= EPS || !output) {
      state.totals.spoiledKg += job.remainingKg; event(state, 'spoiled', job.remainingKg, state.hour + dt); state.processing = null
    } else {
      const input = Math.min(job.remainingKg, LAB.processorRateKgph * scale * dt * processFraction)
      const product = input * LAB.processingYield
      if (product > EPS) output.baseQuality = (output.baseQuality * output.kg + quality * product) / (output.kg + product)
      output.kg += product; job.remainingKg -= input
      state.totals.processingLossKg += input - product
      if (job.remainingKg <= EPS) { state.processing = null; event(state, 'processed', 0, state.hour + dt) }
    }
  }
  state.lots = state.lots.filter(lot => lot.kg > EPS || state.processing?.outputId === lot.id)
  state.hour += dt
  let bottleneck: Bottleneck = 'none'
  if (cropStage(state.crop) === 'dead') bottleneck = 'dead'
  else if (living && irrigation < 0.6) bottleneck = state.controls.pumpFault || !state.controls.pump ? 'pump' : state.tankL <= EPS ? 'water' : 'power'
  else if (living && temperatureFactor < 0.75) bottleneck = 'temperature'
  else if (scheduled && lightFraction < 0.5) bottleneck = 'power'
  else if (nutrientFraction < 0.5) bottleneck = 'nutrients'
  else if (maturityRatio(state) >= BEDS.harvestWindowMinRatio && !canHarvest(state)) bottleneck = 'storage'
  state.last = { hour: state.hour, battery: clamp(state.batteryKwh / (LAB.batteryCapacityKwh * scale)), water: clamp(state.tankL / (LAB.tankCapacityL * scale)), growth: state.crop.progress, health: state.crop.health, solarKw: solar / dt, servedKw: served / dt, light: lightFraction, irrigation, cold: coldFraction, temperatureC: state.temperatureC, outsideC, targetC: state.controls.targetC, temperatureFactor, climateMode, climateKw: climateKw * climateFraction, climateFraction, bottleneck }
}

export function advanceEngineering(input: EngineeringState, hours: number): EngineeringState {
  if (input.profileVersion !== LAB.version) throw new Error('Unsupported engineering profile; start a new SIM scenario')
  if (!Number.isFinite(hours) || hours <= 0 || input.hour >= LAB.maxHours - EPS) return input
  const state = clone(input)
  let remaining = Math.min(hours, LAB.maxAdvanceHours, LAB.maxHours - state.hour)
  while (remaining > EPS) {
    const before = Math.floor(state.hour), dt = Math.min(LAB.tickHours, remaining)
    tick(state, dt); remaining -= dt
    if (Math.floor(state.hour) !== before || remaining <= EPS) state.history = [...state.history, { ...state.last }].slice(-LAB.maxHistory)
  }
  // Only correct floating-point noise; do not manufacture reserves.
  for (const key of ['batteryKwh', 'tankL', 'lineL', 'supplyL', 'nutrientsKg'] as const) state[key] = Math.max(0, state[key])
  return state
}
export function engineeringAction(input: EngineeringState, action: EngineeringAction): EngineeringState {
  if (input.profileVersion !== LAB.version) throw new Error('Unsupported engineering profile; start a new SIM scenario')
  if (action.type === 'advance') return advanceEngineering(input, action.hours)
  const state = clone(input), scale = labScale(state.tier)
  switch (action.type) {
    case 'toggle': state.controls[action.control] = !state.controls[action.control]; return state
    case 'setpoint':
      if (!Number.isFinite(action.value)) return input
      state.controls.targetC = clamp(action.value, LAB.minTargetC, LAB.maxTargetC); return state
    case 'priority': state.controls.priority = action.value; return state
    case 'cold': state.coldUntil = state.hour + 2 * LAB.solHours; event(state, 'cold'); return state
    case 'plant':
      if (state.crop.planted || state.seeds <= 0) return input
      state.seeds -= 1; state.crop = { planted: true, progress: 0, health: 1, plantedHour: state.hour }; event(state, 'seed', 1); return state
    case 'clear':
      if (!state.crop.planted) return input
      state.crop = { planted: false, progress: 0, health: 1 }; return state
    case 'harvest': {
      if (!canHarvest(state)) return input
      const kg = harvestMass(state)
      state.lots.push({ id: state.nextLotId++, kind: 'raw', kg, bornHour: state.hour, ageHours: 0, baseQuality: state.crop.health })
      state.totals.harvestedKg += kg; state.crop = { planted: false, progress: 0, health: 1 }; event(state, 'harvest', kg); return state
    }
    case 'refill': {
      const liters = Math.min(LAB.tankCapacityL * scale - state.tankL, state.supplyL)
      if (liters <= EPS) return input
      state.supplyL -= liters; state.tankL += liters; event(state, 'refill', liters); return state
    }
    case 'fault':
      if (state.controls.pumpFault) return input
      state.controls.pumpFault = true; event(state, 'fault'); return state
    case 'repair':
      if (!state.controls.pumpFault || state.spares <= 0) return input
      state.spares -= 1; state.controls.pumpFault = false; event(state, 'repair', 1); return state
    case 'dust': state.dustUntil = state.hour + 2 * LAB.solHours; event(state, 'dust'); return state
    case 'process': {
      const lot = state.lots.find(item => item.id === action.lotId && item.kind === 'raw')
      if (state.processing || !lot || lotQuality(lot) < 0.25 || state.lots.length >= LAB.maxLots) return input
      const kg = Math.min(LAB.processBatchKg, lot.kg)
      if (kg <= EPS) return input
      const id = state.nextLotId++
      lot.kg -= kg
      state.processing = { remainingKg: kg, ageHours: lot.ageHours, baseQuality: lot.baseQuality, outputId: id }
      state.lots.push({ id, kind: 'processed', kg: 0, bornHour: state.hour, ageHours: 0, baseQuality: lotQuality(lot) })
      state.lots = state.lots.filter(item => item.kg > EPS || item.id === id)
      event(state, 'process', kg); return state
    }
  }
}
