import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, DEFAULT_SCENARIO, initialColony, syncView } from '../../apps/web/src/colony/simulation'

/** Food is set in the ledger (single source of truth), then the view is re-derived. */
const withFood = (s: ColonyState, kg: number): ColonyState => syncView({ ...s, ledger: { ...s.ledger, rawKg: 0, processedKg: kg } })
import type { ColonyState } from '../../apps/web/src/colony/simulation'
import { LOW_BATTERY, powerVisualState } from '../../apps/web/src/colony/organism'

const inUnit = (value: number): void => assert.ok(value >= 0 && value <= 1, `${value} outside 0..1`)

test('colony organism: idle base before any simulated day is neutral and stays in range', () => {
  const s = initialColony()
  const v = powerVisualState(s, DEFAULT_SCENARIO.sunHours)
  assert.equal(s.lastDay, null)
  assert.equal(v.blackout, false)
  assert.equal(v.unmetKwh, 0)
  assert.equal(v.turbineSpin, 0.25)
  inUnit(v.batteryFraction)
  inUnit(v.solarCoverage)
})

test('colony organism: a normal simulated day is powered, turbines turn, lights follow daylight', () => {
  const s = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const v = powerVisualState(s, DEFAULT_SCENARIO.sunHours)
  assert.equal(v.blackout, false)
  assert.ok(v.solarCoverage >= 1, 'day 1 solar covers demand in the default base')
  assert.ok(v.turbineSpin >= 0.25 && v.turbineSpin <= 1)
  assert.equal(v.lights, 'off', 'daylight with a healthy battery shows no lights')
  inUnit(v.batteryFraction)
})

test('colony organism: unmet power means blackout, red lights and stopped turbines', () => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const dark: ColonyState = {
    ...base,
    lastDay: { ...base.lastDay!, unmetKwh: 12, generationKwh: 0, demandKwh: 140 },
  }
  const v = powerVisualState(dark, DEFAULT_SCENARIO.sunHours)
  assert.equal(v.blackout, true)
  assert.equal(v.lights, 'red')
  assert.equal(v.turbineSpin, 0)
  assert.equal(v.solarTilt, 0)
  assert.equal(v.unmetKwh, 12)
})

test('colony organism: tiny rounding leftovers are not a blackout', () => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const s: ColonyState = { ...base, lastDay: { ...base.lastDay!, unmetKwh: 0.004 } }
  assert.equal(powerVisualState(s, DEFAULT_SCENARIO.sunHours).blackout, false)
})

test('colony organism: low battery shows amber lights when power is otherwise fine', () => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const cap = 100
  const s: ColonyState = { ...base, batteryKwh: cap * (LOW_BATTERY / 2), lastDay: { ...base.lastDay!, unmetKwh: 0 } }
  const v = powerVisualState(s, DEFAULT_SCENARIO.sunHours)
  assert.equal(v.blackout, false)
  assert.equal(v.lights, 'amber')
})

test('colony organism: night (short sun hours) shows green lights when power is fine', () => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const v = powerVisualState({ ...base, lastDay: { ...base.lastDay!, unmetKwh: 0 } }, 6)
  assert.equal(v.daylight, false)
  assert.equal(v.lights, 'green')
})

test('colony organism: read model never mutates the simulation state', () => {
  const s = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const before = JSON.stringify(s)
  powerVisualState(s, DEFAULT_SCENARIO.sunHours)
  assert.equal(JSON.stringify(s), before)
})

import { colonyVisualState, CARGO_CAPACITY_KG } from '../../apps/web/src/colony/organism'

test('colony organism: whole-base view links only adjacent occupied slots', () => {
  const s = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const v = colonyVisualState(s, DEFAULT_SCENARIO.sunHours)
  for (const [a, b] of v.links) {
    assert.ok(Math.abs(a - b) === 1 || Math.abs(a - b) === 6, `${a}-${b} not neighbours`)
    assert.ok(s.modules.some(m => m.slot === a) && s.modules.some(m => m.slot === b))
  }
  assert.equal(v.links.length > 0, true)
})

test('colony organism: oxygen shortfall turns habitat and recycler red, others follow power', () => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const s: ColonyState = { ...base, lastDay: { ...base.lastDay!, oxygenShortfallKg: 3 } }
  const v = colonyVisualState(s, DEFAULT_SCENARIO.sunHours)
  assert.equal(v.oxygenAlarm, true)
  for (const m of v.modules) {
    if (m.kind === 'habitat' || m.kind === 'recycler') assert.equal(m.lights, 'red')
    else assert.equal(m.lights, v.power.lights)
  }
})

test('colony organism: cargo stage follows food and spares fill', () => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const empty = colonyVisualState({ ...withFood(base, 0), sparesKg: 0 }, DEFAULT_SCENARIO.sunHours)
  const half = colonyVisualState({ ...base, foodKg: CARGO_CAPACITY_KG / 2, sparesKg: 0 }, DEFAULT_SCENARIO.sunHours)
  const full = colonyVisualState({ ...base, foodKg: CARGO_CAPACITY_KG * 2, sparesKg: 0 }, DEFAULT_SCENARIO.sunHours)
  assert.equal(empty.cargoStage, 0)
  assert.equal(half.cargoStage, 1)
  assert.equal(full.cargoStage, 2)
  assert.equal(full.cargoFill, 1)
})

test('colony organism: damaged modules are flagged below the condition threshold', () => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const worn = { ...base, modules: base.modules.map((m, i) => (i === 0 ? { ...m, condition: 10 } : m)) }
  const v = colonyVisualState(worn, DEFAULT_SCENARIO.sunHours)
  assert.equal(v.modules[0].damaged, true)
  assert.equal(v.modules.slice(1).every(m => !m.damaged), true)
})

test('colony organism: crew and rover flags follow the snapshot', () => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  assert.equal(colonyVisualState(base, DEFAULT_SCENARIO.sunHours).crewLanded, base.crew > 0)
  assert.equal(colonyVisualState({ ...base, crew: 0 }, DEFAULT_SCENARIO.sunHours).crewLanded, false)
  assert.equal(colonyVisualState(base, DEFAULT_SCENARIO.sunHours).roverDeployed, true)
})

test('colony organism: truck runs only with a rover and food available under the contract', () => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  assert.equal(colonyVisualState(base, DEFAULT_SCENARIO.sunHours).truckActive, true)
  assert.equal(colonyVisualState(withFood(base, 0), DEFAULT_SCENARIO.sunHours).truckActive, false)
  const noRover = { ...base, modules: base.modules.filter(m => m.kind !== 'rover') }
  assert.equal(colonyVisualState(noRover, DEFAULT_SCENARIO.sunHours).truckActive, false)
  const done = { ...base, deliveredKg: 60 }
  assert.equal(colonyVisualState(done, DEFAULT_SCENARIO.sunHours).truckActive, false)
  assert.equal(colonyVisualState(done, DEFAULT_SCENARIO.sunHours).contractProgress, 1)
})
