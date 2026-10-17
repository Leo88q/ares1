import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harvestFactor } from '../../apps/web/src/organism/beds'
import { advanceDay, advanceDays, batteryCapacity, bedCycleKg, canHarvestBed, harvestBed, buildModule, buySupplies, canBuild, dailyBudget, DEFAULT_SCENARIO, deliverFood, foodDemand, foodReserve, greenhouseBeds, INITIAL_FOOD_KG, initialColony, PARAMETERS as P, repairColony, sellableKg, SLOTS, stepBeds, bedSummary } from '../../apps/web/src/colony/simulation'
import type { ColonyState } from '../../apps/web/src/colony/simulation'
import { syncView } from '../../apps/web/src/colony/simulation'

const close = (actual: number, expected: number, tolerance = 1e-7): void => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)
/** Ledger identity (P1b): start + harvested = raw + processed + eaten + exported + crafted + processing loss. */
/** Storage room for bed-logic tests: the starting 120 kg fills the 120 kg store, and a full store refuses harvest (P1 rule). */
const withRoom = (s: ColonyState): ColonyState => syncView({ ...s, ledger: { ...s.ledger, storageCapKg: 1000 } })

/** Puts bed timers into the ledger (the single source of truth), then re-derives the view. */
const withBeds = (s: ColonyState, moduleId: string, beds: number[]): ColonyState => syncView({
  ...s,
  ledger: { ...s.ledger, plots: s.ledger.plots.map(p => p.id === moduleId ? { ...p, beds } : p) },
})

const checkAccounting = (s: ColonyState): void => {
  close(s.credits, P.initialCredits + s.earnedCredits - s.spentCredits)
  const l = s.ledger
  close(s.foodKg, l.rawKg + l.processedKg)
  close(l.startKg + l.harvestedKg, l.rawKg + l.processedKg + l.eatenKg + l.exportedKg + l.craftedKg + l.processingLossKg)
  close(s.consumedFoodKg, l.eatenKg)
  close(s.deliveredKg, l.exportedKg)
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
  close(a.foodKg, INITIAL_FOOD_KG - 10 * foodDemand(s))
  assert.ok(a.modules.find(m => m.kind === 'greenhouse')!.growthDays > 69)
  assert.notEqual(initialColony().modules, initialColony().modules)
})

test('colony: each greenhouse bed is harvested once per 90-day cycle, staggered by 15 days', () => {
  assert.equal(bedCycleKg(), 36)
  // a new greenhouse plants bed i at day 15·i: nothing before day 90, then one 36 kg bed every 15 days
  let beds = greenhouseBeds(0), harvestDays: number[] = []
  for (let day = 1; day <= 180; day++) {
    const step = stepBeds(beds, 1)
    if (step.completed) harvestDays.push(day)
    beds = step.beds
  }
  assert.deepEqual(harvestDays, [90, 105, 120, 135, 150, 165, 180])
  // the starter greenhouse (lead at day 60) harvests bed 0 at day 30, bed 1 at day 45, ...
  let starter = greenhouseBeds(60), starterDays: number[] = []
  for (let day = 1; day <= 105; day++) {
    const step = stepBeds(starter, 1)
    if (step.completed) starterDays.push(day)
    starter = step.beds
  }
  assert.deepEqual(starterDays, [30, 45, 60, 75, 90, 105])
  // one day in the simulation: a bed completing at day 90 gives exactly one bed, not the whole greenhouse
  let s = initialColony()
  s = withBeds(withRoom(s), s.modules.find(m => m.kind === 'greenhouse')!.id, [89, 74, 59, 44, 29, 14])
  const next = advanceDay(s)
  close(next.harvestedKg, 36)
  // food = start + harvest − eaten − processing loss of that day (P1b: 15 % loss on processing)
  close(next.foodKg, s.foodKg + 36 - foodDemand(s) - (next.ledger.processingLossKg - s.ledger.processingLossKg))
  close(next.modules.find(m => m.kind === 'greenhouse')!.growthDays, 0)
  assert.deepEqual(next.modules.find(m => m.kind === 'greenhouse')!.beds!.map(v => Math.round(v)), [0, 75, 60, 45, 30, 15])
  checkAccounting(next)
})

test('colony: bed summary counts planted, ripe (≥ 80 % of cycle) and collected kg per greenhouse (§31)', () => {
  const starter = initialColony().modules.find(m => m.kind === 'greenhouse')!
  // starter: beds at 60, 45, 30, 15, 0 days (planted) and −15 (waiting to plant); none ≥ 72 days yet
  const a = bedSummary(starter)
  assert.equal(a.planted, 5)
  assert.equal(a.ripe, 0)
  assert.equal(a.total, 6)
  assert.deepEqual(a.beds.map(b => b.state), ['growing', 'growing', 'growing', 'growing', 'growing', 'waiting'])
  close(a.collectedKg, 0)
  // one bed in the ripe window (80 days ≥ 72), one planted early, four waiting
  const b = bedSummary({ ...starter, beds: [80, 50, -5, -20, -30, -40] })
  assert.equal(b.planted, 2)
  assert.equal(b.ripe, 1)
  assert.equal(b.beds[0].state, 'ripe')
  close(b.beds[0].progress, 80 / 90)
  // collected kg accumulate in the simulation: a bed completing at day 90 adds 36 kg to that greenhouse
  let s = initialColony()
  s = withBeds(withRoom(s), s.modules.find(m => m.kind === 'greenhouse')!.id, [89, 74, 59, 44, 29, 14])
  const next = advanceDay(s)
  const gh = next.modules.find(m => m.kind === 'greenhouse')!
  close(gh.bedsHarvestedKg!, 36)
  close(bedSummary(gh).collectedKg, 36)
  close(bedSummary(gh).planted, 6)
  // legacy save without beds: derived from growthDays (lead bed 60 → same as the starter)
  const legacy = bedSummary({ ...starter, beds: undefined, growthDays: 60 })
  assert.equal(legacy.planted, 5)
  assert.equal(legacy.ripe, 0)
  checkAccounting(next)
})

test('colony: without any player action the starting food lasts the first crop cycle plus 30 days', () => {
  let s = initialColony()
  for (let day = 1; day <= 120; day++) {
    s = advanceDay(s)
    assert.ok(s.foodKg > 0, `food ran out on day ${day}`)
    assert.equal(s.foodShortfallKg, 0)
  }
  checkAccounting(s)
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
  // day 60: the first 36 kg bed (day 30) and the second (day 45) are in; only PROCESSED food above reserve can be sold
  let s = advanceDays(initialColony(), 60)
  assert.ok(s.harvestedKg > 0)
  const surplus = s.ledger.processedKg - foodReserve(s)
  assert.ok(surplus > 0)
  for (let i = 0; i < 20; i++) s = deliverFood(s)
  // sold = min(surplus, funded contract); a single delivery is capped at 10 kg, so 20 calls exhaust either limit
  const expected = Math.min(surplus, P.contractKg)
  close(s.deliveredKg, expected)
  close(s.earnedCredits, expected * P.contractCreditsKg)
  assert.equal(sellableKg(s), 0)
  assert.ok(s.foodKg >= foodReserve(s))
  assert.equal(deliverFood(s), s)
  checkAccounting(s)
  const noRover = { ...initialColony(), modules: initialColony().modules.filter(m => m.kind !== 'rover') }
  assert.equal(sellableKg(noRover), 0)
  const base0 = initialColony()
  const reserveOnly = syncView({ ...base0, ledger: { ...base0.ledger, rawKg: 0, processedKg: foodReserve(base0) } })
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
      assert.ok(s.modules.every(m => m.condition >= 20 && m.condition <= 100 && m.growthDays >= 0 && m.growthDays <= 90))
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

test('colony: manual harvest (§31.12, unified T2 rule) window 30–120 %, factor from harvestFactor, bed restarts at 0', () => {
  const base = initialColony()
  const gh = base.modules.find(m => m.kind === 'greenhouse')!
  // beds: 80 days (ratio 0.89), 70 (early, reduced factor), 90 (100 %), 30 (33 %, floor), 15 (below 30 %, refused), -15 (waiting)
  const s = withBeds(withRoom(base), gh.id, [80, 70, 90, 30, 15, -15])
  assert.equal(canHarvestBed(s, gh.id, 0), true)
  assert.equal(canHarvestBed(s, gh.id, 1), true)
  assert.equal(canHarvestBed(s, gh.id, 2), true)
  assert.equal(canHarvestBed(s, gh.id, 3), true)
  assert.equal(canHarvestBed(s, gh.id, 4), false)
  assert.equal(canHarvestBed(s, gh.id, 5), false)
  assert.equal(canHarvestBed(s, gh.id, 6), false)
  assert.equal(canHarvestBed(s, gh.id, -1), false)
  assert.equal(canHarvestBed(s, 'missing', 0), false)
  // refused action returns the same object (no silent change)
  assert.equal(harvestBed(s, gh.id, 4), s)
  const after = harvestBed(s, gh.id, 0)
  const kg = bedCycleKg() * harvestFactor(80 / 90)
  const m2 = after.modules.find(m => m.id === gh.id)!
  assert.deepEqual(m2.beds, [0, 70, 90, 30, 15, -15])
  close(after.foodKg - s.foodKg, kg)
  close(after.harvestedKg - s.harvestedKg, kg)
  close(m2.bedsHarvestedKg! - (gh.bedsHarvestedKg ?? 0), kg)
  // an early harvest yields less than a full cycle (the trade-off is explicit)
  assert.ok(kg < bedCycleKg())
  checkAccounting(after)
  // the harvested bed is growing again and is not harvested twice
  assert.equal(canHarvestBed(after, gh.id, 0), false)
  const next = advanceDay(after)
  const bedsNext = next.modules.find(m => m.id === gh.id)!.beds!
  assert.ok(bedsNext[0] > 0 && bedsNext[0] < 2, `bed restarted from 0, got ${bedsNext[0]}`)
  checkAccounting(next)
})

test('colony: manual harvest refuses non-greenhouse modules and beds past the 120 % window', () => {
  const base = initialColony()
  const rover = base.modules.find(m => m.kind !== 'greenhouse')
  if (rover) assert.equal(canHarvestBed(base, rover.id, 0), false)
  const gh = base.modules.find(m => m.kind === 'greenhouse')!
  const late = withBeds(withRoom(base), gh.id, [109, 108, 0, 0, 0, -15])
  assert.equal(canHarvestBed(late, gh.id, 0), false)
  assert.equal(canHarvestBed(late, gh.id, 1), true)
  assert.equal(harvestBed(late, gh.id, 0), late)
})

