import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, advanceDays, batteryCapacity, buildModule, buySupplies, canBuild, dailyBudget, DEFAULT_SCENARIO, deliverFood, foodDemand, foodReserve, initialColony, PARAMETERS as P, repairColony, sellableKg, SLOTS } from '../../apps/web/src/colony/simulation'
import type { ColonyState } from '../../apps/web/src/colony/simulation'

const close = (actual: number, expected: number, tolerance = 1e-7): void => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)
const checkAccounting = (s: ColonyState): void => {
  close(s.credits, P.initialCredits + s.earnedCredits - s.spentCredits)
  close(s.foodKg, 80 + s.harvestedKg - s.consumedFoodKg - s.deliveredKg)
  assert.ok(s.deliveredKg <= P.contractKg)
  close(s.earnedCredits, s.deliveredKg * P.contractCreditsKg)
}

test('colony: explicit initial units and reference arithmetic', () => {
  const s = initialColony(), b = dailyBudget(s)
  close(b.generationKwh, 2 * 1.361 * 40 * 0.28 * 0.8 * 18)
  close(b.demandKwh, 20 * (0.2 * 16 + 0.04 * 24) + 24 + 4 + 2 + 101.2 * 0.03 + 1.6 * 15)
  close(b.waterUsedLitres, 101.2 * 0.06 + 1 + 20 * 0.12 * 0.8 + 1.6 * 1.125 * 0.06)
  close(b.oxygenProducedKg, 1.6 + 20 * 0.12 * 0.25)
  close(b.oxygenDemandKg, 4 * 0.84)
  close(b.oxygenEndKg, P.oxygenStartKg + b.oxygenProducedKg - b.oxygenDemandKg)
  assert.equal(b.oxygenShortfallKg, 0)
  close(b.growthFraction, 1, 1e-12)
  assert.equal(s.modules.find(m => m.kind === 'greenhouse')?.growthDays, 60)
})

test('colony: immutable deterministic steps, no instant harvest or credit mint', () => {
  const s = initialColony(), original = structuredClone(s)
  const a = advanceDays(s, 10), b = advanceDays(s, 10)
  assert.deepEqual(a, b)
  assert.deepEqual(s, original)
  assert.equal(a.harvestedKg, 0)
  assert.equal(a.credits, s.credits)
  close(a.foodKg, 80 - 10 * foodDemand(s))
  assert.ok(a.modules.find(m => m.kind === 'greenhouse')!.growthDays > 69)
  assert.notEqual(initialColony().modules, initialColony().modules)
})

test('colony: a productive 90-day crop is harvested as a batch exactly once', () => {
  const s = initialColony()
  s.modules = s.modules.map(m => m.kind === 'greenhouse' ? { ...m, growthDays: 89 } : m)
  const next = advanceDay(s)
  close(next.harvestedKg, 20 * 0.12 * 90)
  close(next.foodKg, s.foodKg + 216 - foodDemand(s))
  close(next.modules.find(m => m.kind === 'greenhouse')!.growthDays, 0)
  close(advanceDay(next).harvestedKg, next.harvestedKg)
  checkAccounting(next)
})

test('colony: battery dispatch conserves energy and never generates in darkness', () => {
  for (const sunHours of [0, 1, 6, 12, 18, 24]) {
    let s = initialColony()
    for (let day = 0; day < 25; day++) {
      const b = dailyBudget(s, { ...DEFAULT_SCENARIO, sunHours })
      close(b.generationKwh + b.batteryDischargeOutputKwh, b.servedKwh + b.batteryChargeInputKwh + b.curtailedKwh)
      close(s.batteryKwh + b.batteryChargeInputKwh * P.batteryChargeEfficiency - b.batteryDischargeOutputKwh / P.batteryDischargeEfficiency, b.batteryEndKwh)
      close(b.servedKwh + b.unmetKwh, b.demandKwh)
      assert.ok(b.batteryEndKwh >= 0 && b.batteryEndKwh <= batteryCapacity(s))
      assert.ok(b.batteryChargeInputKwh === 0 || b.batteryDischargeOutputKwh === 0)
      s = advanceDay(s, { ...DEFAULT_SCENARIO, sunHours })
    }
    if (sunHours === 0) { assert.equal(s.batteryKwh, 0); assert.equal(s.lastDay!.generationKwh, 0); assert.equal(s.lastDay!.growthFraction, 0) }
  }
})

test('colony: electricity, water, nutrients and habitat capacity independently constrain growth', () => {
  for (const resource of ['power', 'water', 'nutrients', 'crew'] as const) {
    const s = initialColony()
    if (resource === 'power') { s.modules = s.modules.filter(m => m.kind !== 'solar'); s.batteryKwh = 0 }
    if (resource === 'water') s.waterLitres = 0
    if (resource === 'nutrients') s.nutrientsKg = 0
    if (resource === 'crew') s.modules = s.modules.filter(m => m.kind !== 'habitat')
    const next = advanceDay(s)
    assert.equal(next.lastDay!.growthFraction, 0, resource)
    close(next.modules.find(m => m.kind === 'greenhouse')!.growthDays, 60)
    assert.equal(next.harvestedKg, 0)
  }
})

test('colony: oxygen comes only from powered recyclers and growing crop, and reconciles', () => {
  const base = initialColony()
  const noRecycler = { ...base, modules: base.modules.filter(m => m.kind !== 'recycler') }
  close(dailyBudget(noRecycler).oxygenProducedKg, 20 * 0.12 * 0.25)
  assert.equal(dailyBudget(noRecycler).oxygenShortfallKg, 0)
  assert.ok(dailyBudget({ ...noRecycler, oxygenKg: 0 }).oxygenShortfallKg > 0)
  const unpowered = { ...base, batteryKwh: 0, modules: base.modules.filter(m => m.kind !== 'solar') }
  assert.equal(dailyBudget(unpowered).oxygenProducedKg, 0)
  assert.ok(dailyBudget({ ...unpowered, oxygenKg: 0 }).oxygenShortfallKg > 0)
  const starved = { ...base, waterLitres: 0 }
  assert.equal(dailyBudget(starved).oxygenProducedKg, 0)
  let s = initialColony()
  for (let day = 0; day < 120; day++) {
    const before = s
    s = advanceDay(s, { sunHours: 12, waterRecovery: 0.94 })
    const b = s.lastDay!
    close(before.oxygenKg + b.oxygenProducedKg - b.oxygenDemandKg, b.oxygenEndKg + b.oxygenVentedKg - b.oxygenShortfallKg)
    assert.ok(s.oxygenKg >= 0 && s.oxygenKg <= P.oxygenTankKg)
  }
})

test('colony: finite recycling capacity, no unpowered or missing recycler credit', () => {
  const base = initialColony()
  const noRecycler = { ...base, modules: base.modules.filter(m => m.kind !== 'recycler') }
  close(dailyBudget(noRecycler).recovery, 0)
  assert.ok(dailyBudget(noRecycler).waterUsedLitres > dailyBudget(base).waterUsedLitres * 10)
  const enlarged = buildModule(buildModule(base, 'greenhouse'), 'greenhouse')
  assert.ok(dailyBudget(enlarged).recovery < dailyBudget(base).recovery)
  const unpowered = { ...base, batteryKwh: 0, modules: base.modules.filter(m => m.kind !== 'solar') }
  assert.equal(dailyBudget(unpowered).recovery, 0)
  assert.ok(dailyBudget(base, { ...DEFAULT_SCENARIO, waterRecovery: 0.98 }).waterUsedLitres < dailyBudget(base).waterUsedLitres)
})

test('colony: construction charges exactly once, unique pads, new crop starts at zero', () => {
  const s = initialColony(), next = buildModule(s, 'greenhouse')
  assert.equal(next.credits, s.credits - 250)
  assert.equal(next.sparesKg, s.sparesKg - 1)
  assert.equal(next.modules.at(-1)!.growthDays, 0)
  assert.equal(new Set(next.modules.map(m => m.slot)).size, next.modules.length)
  checkAccounting(next)
  for (const blocked of [{ ...s, credits: 0 }, { ...s, sparesKg: 0 }]) {
    assert.equal(canBuild(blocked, 'solar'), false)
    assert.equal(buildModule(blocked, 'solar'), blocked)
  }
  let full = { ...s, credits: 1_000_000, sparesKg: 100 }
  while (full.modules.length < SLOTS.length) full = buildModule(full, 'solar')
  assert.equal(buildModule(full, 'solar'), full)
  assert.equal(new Set(full.modules.map(m => m.slot)).size, SLOTS.length)
})

test('colony: servicing and resupply require real game budget and stock', () => {
  const worn = advanceDays(initialColony(), 10), repaired = repairColony(worn)
  assert.equal(repaired.credits, worn.credits - 20)
  assert.equal(repaired.sparesKg, worn.sparesKg - 2)
  assert.ok(repaired.modules.every(m => m.condition === 100))
  assert.equal(repaired.modules.find(m => m.kind === 'greenhouse')!.growthDays, worn.modules.find(m => m.kind === 'greenhouse')!.growthDays)
  const supplied = buySupplies(repaired)
  close(supplied.waterLitres, repaired.waterLitres + 100)
  close(supplied.nutrientsKg, repaired.nutrientsKg + 1)
  close(supplied.sparesKg, repaired.sparesKg + 2)
  checkAccounting(supplied)
  const noFunds = { ...worn, credits: 0 }
  assert.equal(repairColony(noFunds), noFunds)
  assert.equal(buySupplies(noFunds), noFunds)
  const noShop = { ...worn, modules: worn.modules.filter(m => m.kind !== 'workshop') }
  assert.equal(repairColony(noShop), noShop)
})

test('colony: deliveries preserve reserve and exhaust a funded order, not unlimited demand', () => {
  let s = advanceDays(initialColony(), 35)
  assert.ok(s.harvestedKg > 0)
  for (let i = 0; i < 20; i++) s = deliverFood(s)
  close(s.deliveredKg, 60)
  close(s.earnedCredits, 240)
  assert.ok(s.foodKg >= foodReserve(s))
  assert.equal(deliverFood(s), s)
  checkAccounting(s)
  const noRover = { ...initialColony(), modules: initialColony().modules.filter(m => m.kind !== 'rover') }
  assert.equal(sellableKg(noRover), 0)
  const reserveOnly = { ...initialColony(), foodKg: foodReserve(initialColony()) }
  assert.equal(sellableKg(reserveOnly), 0)
})

test('colony: 365-day sweeps stay finite, nonnegative, bounded and reconciled', () => {
  for (const sunHours of [0, 6, 18, 24]) for (const waterRecovery of [0, 0.94, 0.98]) {
    let s = initialColony()
    for (let day = 0; day < 365; day++) {
      const before = s
      s = advanceDay(s, { sunHours, waterRecovery })
      close(before.waterLitres - s.waterLitres, s.lastDay!.waterUsedLitres)
      close(before.nutrientsKg - s.nutrientsKg, s.lastDay!.nutrientsUsedKg)
      close(s.consumedFoodKg + s.foodShortfallKg, s.day * foodDemand(s))
      for (const value of [s.credits, s.foodKg, s.waterLitres, s.nutrientsKg, s.batteryKwh, s.harvestedKg]) assert.ok(Number.isFinite(value) && value >= 0)
      assert.ok(s.modules.every(m => m.condition >= 20 && m.condition <= 100 && m.growthDays >= 0 && m.growthDays < 90))
      checkAccounting(s)
    }
    assert.equal(advanceDay(s), s)
  }
})

test('colony: invalid scenarios and unbounded stepping fail closed', () => {
  const s = initialColony()
  for (const sunHours of [NaN, Infinity, -1, 25]) assert.throws(() => dailyBudget(s, { sunHours, waterRecovery: 0.94 }), RangeError)
  for (const waterRecovery of [NaN, Infinity, -1, 0.99]) assert.throws(() => dailyBudget(s, { sunHours: 18, waterRecovery }), RangeError)
  for (const days of [NaN, Infinity, -1, 0.5, 366]) assert.throws(() => advanceDays(s, days), RangeError)
})
