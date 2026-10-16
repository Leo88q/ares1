// Visual-only read model: turns the colony simulation snapshot into values the 3D scene can show.
// Pure and framework-free so it can be tested offline. It never writes to ColonyState and has
// no effect on credits, rewards, tokens or any on-chain value.
import { batteryCapacity, PARAMETERS, sellableKg } from './simulation'
import type { ColonyState } from './simulation'

export interface PowerVisual {
  /** Share of the last day's demand covered by solar generation, 0–1. 0 when there was no data. */
  solarCoverage: number
  /** Energy missing after battery use on the last day, kWh. */
  unmetKwh: number
  /** Battery charge as a share of capacity, 0–1. 0 when there is no battery. */
  batteryFraction: number
  /** Whether the base is short of power on the last day. */
  blackout: boolean
  /** Daylight proxy from the scenario: true when sunHours is at least 12. */
  daylight: boolean
  /** Turbine rotation speed, 0–1. Stops during a blackout. Wind is not simulated; this is decoration. */
  turbineSpin: number
  /** Solar panel tilt toward the sun, 0–1. */
  solarTilt: number
  /** Lights: 'red' during blackout, 'amber' when the battery is low, otherwise 'green' at night, 'off' by day. */
  lights: 'off' | 'green' | 'amber' | 'red'
}

/** Battery fraction below this shows amber lights. */
export const LOW_BATTERY = 0.2

export function powerVisualState(state: ColonyState, sunHours: number): PowerVisual {
  const budget = state.lastDay
  const capacity = batteryCapacity(state)
  const batteryFraction = capacity > 0 ? Math.min(1, Math.max(0, state.batteryKwh / capacity)) : 0
  const daylight = sunHours >= 12
  if (!budget) {
    // No simulated day yet: show a neutral idle base instead of guessing.
    return {
      solarCoverage: 0, unmetKwh: 0, batteryFraction, blackout: false, daylight,
      turbineSpin: 0.25, solarTilt: daylight ? 0.5 : 0, lights: daylight ? 'off' : 'green',
    }
  }
  const demand = Math.max(budget.demandKwh, 1e-9)
  const solarCoverage = Math.min(1, Math.max(0, budget.generationKwh / demand))
  const blackout = budget.unmetKwh > 0.01
  const lights: PowerVisual['lights'] = blackout ? 'red' : batteryFraction < LOW_BATTERY ? 'amber' : daylight ? 'off' : 'green'
  return {
    solarCoverage,
    unmetKwh: budget.unmetKwh,
    batteryFraction,
    blackout,
    daylight,
    turbineSpin: blackout ? 0 : Math.max(0.25, solarCoverage),
    solarTilt: solarCoverage,
    lights,
  }
}

// ---------------------------------------------------------------------------
// Whole-base read model: every visible system derived from the same snapshot.
// ---------------------------------------------------------------------------

/** Visual scale only for cargo crates; not a game rule. */
export const CARGO_CAPACITY_KG = 120
/** Condition below this shows damage on a module pad. */
export const DAMAGED_CONDITION = 50
/** Slot grid used by the scene (6 columns, 4 rows). */
const COLUMNS = 6
const ROWS = 4

export interface ModuleVisual {
  id: string
  kind: string
  slot: number
  lights: 'off' | 'green' | 'amber' | 'red'
  damaged: boolean
}

export interface ColonyVisual {
  power: PowerVisual
  /** Oxygen shortfall on the last simulated day: habitat and recycler glow red. */
  oxygenAlarm: boolean
  /** Share of the cargo capacity used by food and spares, 0–1. */
  cargoFill: number
  /** Crate stage: 0 empty, 1 packed, 2 stacked. */
  cargoStage: 0 | 1 | 2
  /** Pairs of occupied neighbouring slots that get a tunnel. */
  links: Array<[number, number]>
  /** A rover is docked, so the truck and garage show activity. */
  roverDeployed: boolean
  /** Crew present, so the lander pad shows a landed craft. */
  crewLanded: boolean
  /** Truck drives only while a rover exists and food can be sold under the contract. */
  truckActive: boolean
  /** Delivered share of the contract, 0–1. */
  contractProgress: number
  modules: ModuleVisual[]
}

const OXYGEN_KINDS = new Set(['habitat', 'recycler'])

export function colonyVisualState(state: ColonyState, sunHours: number): ColonyVisual {
  const power = powerVisualState(state, sunHours)
  const oxygenAlarm = (state.lastDay?.oxygenShortfallKg ?? 0) > 0.01
  const cargoFill = Math.min(1, Math.max(0, (state.foodKg + state.sparesKg) / CARGO_CAPACITY_KG))
  const cargoStage: 0 | 1 | 2 = cargoFill < 1 / 3 ? 0 : cargoFill < 2 / 3 ? 1 : 2
  const occupied = new Set(state.modules.map(m => m.slot))
  const links: Array<[number, number]> = []
  for (const slot of occupied) {
    const col = slot % COLUMNS
    const row = Math.floor(slot / COLUMNS)
    if (col < COLUMNS - 1 && occupied.has(slot + 1)) links.push([slot, slot + 1])
    if (row < ROWS - 1 && occupied.has(slot + COLUMNS)) links.push([slot, slot + COLUMNS])
  }
  const modules: ModuleVisual[] = state.modules.map(m => {
    const alarm = oxygenAlarm && OXYGEN_KINDS.has(m.kind)
    return {
      id: m.id,
      kind: m.kind,
      slot: m.slot,
      lights: alarm ? 'red' : power.lights,
      damaged: m.condition < DAMAGED_CONDITION,
    }
  })
  return {
    power,
    oxygenAlarm,
    cargoFill,
    cargoStage,
    links,
    roverDeployed: state.modules.some(m => m.kind === 'rover' && m.condition >= DAMAGED_CONDITION),
    crewLanded: state.crew > 0,
    truckActive: sellableKg(state) > 0,
    contractProgress: Math.min(1, Math.max(0, state.deliveredKg / PARAMETERS.contractKg)),
    modules,
  }
}
