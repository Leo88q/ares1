// Visual-only read model: turns the colony simulation snapshot into values the 3D scene can show.
// Pure and framework-free so it can be tested offline. It never writes to ColonyState and has
// no effect on credits, rewards, tokens or any on-chain value.
import { batteryCapacity } from './simulation'
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
