import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, DEFAULT_SCENARIO, initialColony } from '../../apps/web/src/colony/simulation'
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
