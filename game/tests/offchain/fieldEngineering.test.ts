import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceEngineering, canHarvest, cropStage, engineeringAction, harvestMass, initialEngineering, LAB, labScale, lotQuality, storageKg, supplyRoom, temperatureGrowthFactor, outsideTemperature } from '../../apps/web/src/fields/engineering/engine'
import type { EngineeringState } from '../../apps/web/src/fields/engineering/engine'
import { engineeringPresentation } from '../../apps/web/src/fields/engineering/presentation'
import type { FieldVisual } from '../../apps/web/src/fields/model'

const close = (a: number, b: number, epsilon = 1e-7): void => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`)
const initial = (): EngineeringState => initialEngineering('account-a', 0)
const grown = (): EngineeringState => advanceEngineering(initial(), 7 * LAB.solHours)
const harvested = (): EngineeringState => engineeringAction(grown(), { type: 'harvest' })
function accounting(s: EngineeringState): void {
  const scale = labScale(s.tier)
  close(s.batteryKwh, LAB.batteryInitialKwh * scale + s.totals.chargeInputKwh * LAB.chargeEfficiency - s.totals.dischargeOutputKwh / LAB.dischargeEfficiency)
  close(s.totals.solarKwh + s.totals.dischargeOutputKwh, s.totals.servedKwh + s.totals.chargeInputKwh + s.totals.curtailedKwh)
  // Колония может довезти воду, питание и запчасти: приток входит в баланс массы,
  // поэтому «сколько przyjęл стенд» всегда равно «сколько списано у базы».
  close(s.tankL + s.supplyL + s.lineL + s.totals.waterConsumedL, (LAB.tankInitialL + LAB.supplyInitialL + LAB.lineInitialL) * scale + s.totals.inflowLitres)
  close(s.nutrientsKg + s.totals.nutrientsConsumedKg, LAB.nutrientsInitialKg * scale + s.totals.inflowNutrientsKg)
  // Отправленная на базу партия покидает стенд, но остаётся в учёте массы еды.
  close(storageKg(s) + s.totals.spoiledKg + s.totals.processingLossKg + s.totals.shippedKg, s.totals.harvestedKg)
  close(s.temperatureC, LAB.initialTemperatureC + (s.totals.heaterHeatKwh + s.totals.lampHeatKwh + s.totals.passiveHeatKwh - s.totals.climateRemovedKwh - s.totals.evaporationKwh) / (LAB.thermalCapacityKwhPerC * scale))
  assert.ok(s.batteryKwh >= 0 && s.batteryKwh <= LAB.batteryCapacityKwh * scale + 1e-7)
  assert.ok(s.tankL >= 0 && s.tankL <= LAB.tankCapacityL * scale + 1e-7)
  assert.ok(s.supplyL >= 0 && s.supplyL <= LAB.supplyCapacityL * scale + 1e-7)
  assert.ok(s.lineL >= 0 && s.lineL <= LAB.lineCapacityL * scale + 1e-7)
  assert.ok(s.nutrientsKg >= 0 && s.nutrientsKg <= LAB.nutrientCapacityKg * scale + 1e-7)
  // Запчасти — целые детали на общей полке стенда (без масштабирования тира).
  assert.ok(Number.isInteger(s.spares) && s.spares >= 0 && s.spares <= LAB.sparesCapacity)
  assert.ok(storageKg(s) <= LAB.storageCapacityKg * scale + 1e-7)
  assert.ok(s.history.length <= LAB.maxHistory && s.events.length <= LAB.maxEvents)
}

test('engineering initial profile is finite, versioned, ID-bound and has no token state', () => {
  const s = initial()
  assert.equal(s.fieldId, 'account-a'); assert.equal(s.tier, 0); assert.equal(s.hour, 0)
  assert.equal(s.crop.progress, 0); assert.equal(s.seeds, LAB.seedsInitial - 1)
  assert.equal(storageKg(s), 0); assert.equal(canHarvest(s), false)
  assert.equal(LAB.version, 'ARES-LAB/2'); assert.ok(!('credits' in s) && !('potatoBalance' in s))
  accounting(s)
})
test('same commands are deterministic and all transitions leave source state untouched', () => {
  const s = initial(), original = structuredClone(s)
  const a = advanceEngineering(s, 24), b = advanceEngineering(s, 24)
  assert.deepEqual(a, b); assert.deepEqual(s, original)
  let split = s; for (let i = 0; i < 24; i++) split = advanceEngineering(split, 1)
  assert.deepEqual(a, split)
  const toggled = engineeringAction(s, { type: 'toggle', control: 'lights' })
  assert.equal(toggled.controls.lights, false); assert.equal(s.controls.lights, true)
})
test('energy, water, nutrients and food accounting hold across three tier profiles and dispatch modes', () => {
  for (const tier of [0, 1, 2] as const) for (const mode of ['normal', 'dust', 'no-battery', 'pump-fault'] as const) {
    let s = initialEngineering(`account-${tier}`, tier)
    if (mode === 'dust') s = engineeringAction(s, { type: 'dust' })
    if (mode === 'no-battery') s = engineeringAction(s, { type: 'toggle', control: 'battery' })
    if (mode === 'pump-fault') s = engineeringAction(s, { type: 'fault' })
    for (let hour = 0; hour < 100; hour++) { s = advanceEngineering(s, 1); accounting(s) }
  }
})
test('growth passes staged development and cannot harvest an immature crop', () => {
  let s = initial()
  assert.equal(cropStage(s.crop), 'seedling')
  assert.equal(engineeringAction(s, { type: 'harvest' }), s)
  s = advanceEngineering(s, 2 * LAB.solHours)
  assert.equal(cropStage(s.crop), 'vegetative')
  s = advanceEngineering(s, 3 * LAB.solHours)
  assert.equal(cropStage(s.crop), 'tuber')
  s = advanceEngineering(s, 2 * LAB.solHours)
  assert.equal(cropStage(s.crop), 'mature'); assert.equal(canHarvest(s), true)
  accounting(s)
})
test('turning lights off stops development but does not mint or remove token balances', () => {
  const s = engineeringAction(initial(), { type: 'toggle', control: 'lights' })
  const next = advanceEngineering(s, 48)
  assert.equal(next.crop.progress, 0); assert.equal(next.totals.harvestedKg, 0)
  assert.ok(next.totals.waterConsumedL > 0)
  accounting(next)
})
test('pump fault uses a finite line buffer first, then causes water stress', () => {
  const s = engineeringAction(initial(), { type: 'fault' })
  const buffered = advanceEngineering(s, 1)
  assert.equal(buffered.last.irrigation, 1)
  const dry = advanceEngineering(buffered, 24)
  assert.equal(dry.last.bottleneck, 'pump'); assert.ok(dry.crop.health < 1)
  assert.equal(dry.lineL, 0); assert.equal(dry.tankL, s.tankL)
  accounting(dry)
})
test('repair consumes a real spare once and never restores resources or health instantly', () => {
  let s = advanceEngineering(engineeringAction(initial(), { type: 'fault' }), 24)
  const before = structuredClone(s)
  s = engineeringAction(s, { type: 'repair' })
  assert.equal(s.spares, before.spares - 1); assert.equal(s.controls.pumpFault, false)
  assert.equal(s.crop.health, before.crop.health); assert.equal(s.tankL, before.tankL)
  assert.equal(engineeringAction(s, { type: 'repair' }), s)
  for (let i = 0; i < 4; i++) { s = engineeringAction(s, { type: 'fault' }); s = engineeringAction(s, { type: 'repair' }) }
  assert.equal(s.spares, 0); assert.equal(s.controls.pumpFault, true)
})
test('refill transfers finite reserve water, never creates water', () => {
  let s = initial()
  const total = s.tankL + s.supplyL + s.lineL
  s = engineeringAction(s, { type: 'refill' })
  close(s.tankL, LAB.tankCapacityL); close(s.supplyL, LAB.supplyInitialL - 20)
  close(s.tankL + s.supplyL + s.lineL, total)
  assert.equal(engineeringAction(s, { type: 'refill' }), s)
  const exhausted = { ...s, supplyL: 0, tankL: 0 }
  assert.equal(engineeringAction(exhausted, { type: 'refill' }), exhausted)
  accounting(s)
})
test('supply accepts a colony delivery into the finite bench room and records the inflow', () => {
  // Стенд не умеет создавать массу: он лишь принимает то, что списала колония.
  let s = initial()
  const before = { litres: s.supplyL, nutrients: s.nutrientsKg, spares: s.spares }
  s = engineeringAction(s, { type: 'supply', resource: 'water', amount: 40 })
  close(s.supplyL, before.litres + 40); close(s.totals.inflowLitres, 40)
  close(s.totals.inflowNutrientsKg, 0); close(s.totals.inflowSpares, 0)
  s = engineeringAction(s, { type: 'supply', resource: 'nutrients', amount: 0.2 })
  close(s.nutrientsKg, before.nutrients + 0.2); close(s.totals.inflowNutrientsKg, 0.2)
  s = engineeringAction(s, { type: 'supply', resource: 'spares', amount: 1 })
  assert.equal(s.spares, before.spares + 1); close(s.totals.inflowSpares, 1)
  accounting(s)

  // Мусор на входе и дробные запчасти игнорируются: возвращается тот же объект.
  assert.equal(engineeringAction(s, { type: 'supply', resource: 'spares', amount: 0.5 }), s)
  for (const bad of [0, -12, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(engineeringAction(s, { type: 'supply', resource: 'water', amount: bad }), s)
  }

  // Полка запчастей заполняется целыми деталями до LAB.sparesCapacity и встаёт.
  let shelf = s
  while (supplyRoom(shelf, 'spares') >= 1) shelf = engineeringAction(shelf, { type: 'supply', resource: 'spares', amount: 1 })
  assert.equal(shelf.spares, LAB.sparesCapacity); close(shelf.totals.inflowSpares, LAB.sparesCapacity - before.spares)
  assert.equal(engineeringAction(shelf, { type: 'supply', resource: 'spares', amount: 3 }), shelf)
  accounting(shelf)

  // Резерв воды заполняется шагом 40 л, последний заезд урезается до свободного места.
  let tank = s
  while (supplyRoom(tank, 'water') >= 40) tank = engineeringAction(tank, { type: 'supply', resource: 'water', amount: 40 })
  const roomLeft = supplyRoom(tank, 'water')
  assert.ok(roomLeft >= 0 && roomLeft < 40)
  const partial = engineeringAction(tank, { type: 'supply', resource: 'water', amount: 40 })
  close(partial.supplyL, LAB.supplyCapacityL * labScale(tank.tier))
  close(partial.totals.inflowLitres, tank.totals.inflowLitres + roomLeft)
  assert.equal(engineeringAction(partial, { type: 'supply', resource: 'water', amount: 40 }), partial)
  accounting(tank); accounting(partial)
})
test('supply scales with the tier room and keeps every tier profile closed', () => {
  for (const tier of [0, 1, 2] as const) {
    let s = initialEngineering(`bench-${tier}`, tier)
    const roomLitres = supplyRoom(s, 'water')
    const roomNutrients = supplyRoom(s, 'nutrients')
    close(roomLitres, LAB.supplyCapacityL * labScale(tier) - LAB.supplyInitialL * labScale(tier))
    close(roomNutrients, LAB.nutrientCapacityKg * labScale(tier) - LAB.nutrientsInitialKg * labScale(tier))
    s = engineeringAction(s, { type: 'supply', resource: 'water', amount: roomLitres })
    close(s.supplyL, LAB.supplyCapacityL * labScale(tier))
    s = engineeringAction(s, { type: 'supply', resource: 'nutrients', amount: roomNutrients })
    close(s.nutrientsKg, LAB.nutrientCapacityKg * labScale(tier))
    assert.equal(engineeringAction(s, { type: 'supply', resource: 'water', amount: 1 }), s)
    assert.equal(engineeringAction(s, { type: 'supply', resource: 'nutrients', amount: 1 }), s)
    accounting(s)
  }
})
test('ship moves a SIM food lot off the bench without creating or losing the rest', () => {
  let s = harvested()
  const lotId = s.lots[0].id, mass = s.lots[0].kg
  // Частичная отгрузка: масса уходит из партии и попадает в счётчик отгруженного.
  s = engineeringAction(s, { type: 'ship', lotId, kg: mass / 2 })
  close(s.lots[0].kg, mass / 2); close(s.totals.shippedKg, mass / 2)
  close(storageKg(s) + s.totals.shippedKg, s.totals.harvestedKg)
  // Отгрузка больше остатка партии невозможна: урезается до фактических кг.
  s = engineeringAction(s, { type: 'ship', lotId, kg: mass })
  close(s.totals.shippedKg, mass); assert.equal(s.lots.length, 0)
  close(s.totals.shippedKg, s.totals.harvestedKg)
  // Пустая партия, чужой id и мусор на входе — отказ без изменений состояния.
  assert.equal(engineeringAction(s, { type: 'ship', lotId, kg: 5 }), s)
  assert.equal(engineeringAction(s, { type: 'ship', lotId: 999, kg: 5 }), s)
  const fresh = harvested()
  for (const bad of [0, -3, Number.NaN]) assert.equal(engineeringAction(fresh, { type: 'ship', lotId, kg: bad }), fresh)
  accounting(s)
})
test('ship keeps the rest of the bench untouched and never invents token state', () => {
  const s = harvested()
  const snapshot = { seeds: s.seeds, spares: s.spares, crop: s.crop, water: s.tankL + s.supplyL + s.lineL, nutrients: s.nutrientsKg }
  const shipped = engineeringAction(s, { type: 'ship', lotId: s.lots[0].id, kg: s.lots[0].kg })
  assert.deepEqual({ seeds: shipped.seeds, spares: shipped.spares, crop: shipped.crop, water: shipped.tankL + shipped.supplyL + shipped.lineL, nutrients: shipped.nutrientsKg }, snapshot)
  assert.ok(!('credits' in shipped) && !('potatoBalance' in shipped))
  accounting(shipped)
})
test('dust attenuates solar generation and expires at simulated time', () => {
  const normal = advanceEngineering(initial(), 2 * LAB.solHours)
  const storm = advanceEngineering(engineeringAction(initial(), { type: 'dust' }), 2 * LAB.solHours)
  assert.ok(storm.totals.solarKwh < normal.totals.solarKwh * 0.2)
  assert.ok(storm.totals.unservedKwh > 0)
  assert.ok(storm.crop.progress < normal.crop.progress)
  assert.ok(storm.hour >= storm.dustUntil)
  accounting(storm)
})
test('harvest creates exactly one SIM food lot from a mature crop', () => {
  const s = grown(), mass = harvestMass(s), next = engineeringAction(s, { type: 'harvest' })
  assert.equal(next.lots.length, 1); close(next.lots[0].kg, mass)
  assert.equal(next.crop.planted, false); assert.equal(next.seeds, s.seeds)
  assert.equal(engineeringAction(next, { type: 'harvest' }), next)
  accounting(next)
})
test('seeding consumes finite packets; clearing cannot refund them', () => {
  let s = initial()
  for (let i = 0; i < 5; i++) { s = engineeringAction(s, { type: 'clear' }); s = engineeringAction(s, { type: 'plant' }) }
  assert.equal(s.seeds, 0); assert.equal(s.crop.planted, false)
  assert.equal(engineeringAction(s, { type: 'plant' }), s)
})
test('storage capacity blocks a whole harvest rather than discarding or overfilling food', () => {
  let s = initial()
  for (let cycle = 0; cycle < 2; cycle++) {
    s = engineeringAction(s, { type: 'refill' }); s = advanceEngineering(s, 7 * LAB.solHours)
    s = engineeringAction(s, { type: 'harvest' }); s = engineeringAction(s, { type: 'plant' })
  }
  s = engineeringAction(s, { type: 'refill' }); s = advanceEngineering(s, 7 * LAB.solHours)
  assert.equal(cropStage(s.crop), 'mature')
  // Fill storage explicitly so the next harvest would overflow (the yield itself is not tuned by this test).
  const cap = LAB.storageCapacityKg * labScale(s.tier)
  const filler = cap - storageKg(s) - harvestMass(s) / 2
  assert.ok(filler > 0)
  const full = { ...s, lots: [...s.lots, { id: 99, kind: 'raw' as const, kg: filler, bornHour: 0, ageHours: 0, baseQuality: 1 }] }
  assert.ok(storageKg(full) + harvestMass(full) > cap)
  assert.equal(canHarvest(full), false)
  assert.equal(engineeringAction(full, { type: 'harvest' }), full)
  accounting(s)
})
test('processing is time/energy bounded and conserves input mass plus declared loss', () => {
  const start = harvested()
  let s = engineeringAction(start, { type: 'process', lotId: start.lots[0].id })
  assert.ok(s.processing); assert.equal(s.lots.find(lot => lot.kind === 'processed')?.kg, 0)
  close(storageKg(s), storageKg(start))
  const active = s
  assert.equal(engineeringAction(s, { type: 'process', lotId: start.lots[0].id }), s)
  s = advanceEngineering(s, 12)
  assert.equal(s.processing, null)
  close(s.lots.find(lot => lot.kind === 'processed')!.kg, LAB.processBatchKg * LAB.processingYield)
  close(s.totals.processingLossKg, LAB.processBatchKg * (1 - LAB.processingYield))
  assert.ok(s.totals.servedKwh > active.totals.servedKwh)
  accounting(s)
})
test('warm storage spoils batches; powered cooling slows aging, not time or balances', () => {
  const coldStart = harvested()
  const cold = advanceEngineering(coldStart, 100)
  const warm = advanceEngineering(engineeringAction(coldStart, { type: 'toggle', control: 'cooling' }), 100)
  assert.equal(cold.totals.spoiledKg, 0); assert.ok(cold.lots.length > 0)
  close(warm.totals.spoiledKg, warm.totals.harvestedKg); assert.equal(warm.lots.length, 0)
  assert.equal(cold.hour, warm.hour); accounting(cold); accounting(warm)
})
test('old/unknown lots cannot be processed to restore quality', () => {
  let s = harvested()
  s = advanceEngineering(engineeringAction(s, { type: 'toggle', control: 'cooling' }), 60)
  assert.ok(lotQuality(s.lots[0]) < 0.25)
  assert.equal(engineeringAction(s, { type: 'process', lotId: s.lots[0].id }), s)
  assert.equal(engineeringAction(s, { type: 'process', lotId: -1 }), s)
})
test('invalid and extreme time increments are bounded; history/logs remain finite', () => {
  const s = initial()
  for (const hours of [0, -1, NaN, Infinity]) assert.equal(advanceEngineering(s, hours), s)
  const next = advanceEngineering(s, 1e12)
  close(next.hour, LAB.maxAdvanceHours)
  assert.ok(next.history.length <= LAB.maxHistory)
  let capped = s
  for (let i = 0; i < 12; i++) capped = advanceEngineering(capped, LAB.maxAdvanceHours)
  close(capped.hour, LAB.maxHours); assert.equal(advanceEngineering(capped, 24), capped)
  accounting(capped)
})
test('visual adapter is account-bound, immutable and never modifies pending POTATO', () => {
  const field: FieldVisual = { id: 'account-a', tier: 0, level: 3, condition: 0.9, active: true, ready: true, fertilized: true, taxExpired: true, mutation: 1, growth: 1, pendingMicro: 500_000 }
  const before = structuredClone(field), state = initial()
  const view = engineeringPresentation(field, state)
  assert.equal(view.id, field.id); assert.equal(view.pendingMicro, field.pendingMicro)
  assert.equal(view.ready, false); assert.ok(view.engineering)
  assert.deepEqual(field, before)
  assert.throws(() => engineeringPresentation(field, initialEngineering('account-b', 0)), /identity/)
})


test('climate response is bounded, explicit and distinct from token yield', () => {
  for (const celsius of [-52, 0, 4, 12, 16, 20, 22, 26, 36, 99]) {
    const factor = temperatureGrowthFactor(celsius)
    assert.ok(factor >= 0 && factor <= 1)
  }
  assert.equal(temperatureGrowthFactor(4), 0); assert.equal(temperatureGrowthFactor(36), 0)
  assert.equal(temperatureGrowthFactor(16), 1); assert.equal(temperatureGrowthFactor(22), 1)
  assert.ok(temperatureGrowthFactor(12) < 1); assert.ok(temperatureGrowthFactor(26) < 1)
  assert.equal(temperatureGrowthFactor(NaN), 0)
})
test('thermostat maintains a healthy controlled cycle; heat ledger is conserved for every tier', () => {
  for (const tier of [0, 1, 2] as const) {
    let s = initialEngineering(`account-${tier}`, tier)
    for (let hour = 0; hour < 100; hour++) {
      s = advanceEngineering(s, 1)
      assert.ok(s.temperatureC >= 18 && s.temperatureC <= 22)
      assert.ok(s.last.climateKw <= Math.max(LAB.heaterKw, LAB.climateCoolerKw) * labScale(tier) + 1e-7)
      accounting(s)
    }
    assert.ok(s.totals.heaterHeatKwh > 0); assert.ok(s.totals.passiveHeatKwh < 0)
  }
})
test('disabling climate loses stored heat, slows growth and can kill a crop, without free energy', () => {
  const controlled = grown()
  const unheated = advanceEngineering(engineeringAction(initial(), { type: 'toggle', control: 'climate' }), 7 * LAB.solHours)
  assert.equal(unheated.totals.heaterHeatKwh, 0)
  assert.equal(unheated.totals.climateRemovedKwh, 0)
  assert.ok(unheated.temperatureC < controlled.temperatureC)
  assert.ok(unheated.crop.progress < controlled.crop.progress)
  assert.equal(cropStage(unheated.crop), 'dead')
  accounting(unheated)
})
test('target adjustment is clamped and cannot change temperature or time instantaneously', () => {
  const s = initial()
  const low = engineeringAction(s, { type: 'setpoint', value: -100 })
  const high = engineeringAction(s, { type: 'setpoint', value: 100 })
  assert.equal(low.controls.targetC, LAB.minTargetC); assert.equal(high.controls.targetC, LAB.maxTargetC)
  assert.equal(low.temperatureC, s.temperatureC); assert.equal(high.temperatureC, s.temperatureC)
  assert.equal(low.hour, s.hour)
  assert.equal(engineeringAction(s, { type: 'setpoint', value: NaN }), s)
  assert.equal(engineeringAction(s, { type: 'setpoint', value: Infinity }), s)
})
test('climate cooling requires power and heat removal appears in the thermal ledger', () => {
  const targeted = engineeringAction(initial(), { type: 'setpoint', value: 12 })
  const cooled = advanceEngineering(targeted, 1)
  assert.equal(cooled.last.climateMode, 'cooling')
  assert.ok(cooled.totals.climateRemovedKwh > 0)
  assert.ok(cooled.temperatureC < targeted.temperatureC)
  assert.ok(cooled.totals.servedKwh > 0)
  accounting(cooled)
})
test('cold scenario is deterministic, expires in SIM time and introduces no electrical resource', () => {
  const s = engineeringAction(initial(), { type: 'cold' })
  close(outsideTemperature(0, s.coldUntil), outsideTemperature(0) - LAB.coldEventDropC)
  close(outsideTemperature(s.coldUntil, s.coldUntil), outsideTemperature(s.coldUntil))
  const cold = advanceEngineering(s, 2 * LAB.solHours), normal = advanceEngineering(initial(), 2 * LAB.solHours)
  close(cold.totals.solarKwh, normal.totals.solarKwh)
  assert.ok(cold.totals.heaterHeatKwh > normal.totals.heaterHeatKwh)
  accounting(cold)
})
test('food-vs-crop priorities allocate the same scarce energy differently without duplication', () => {
  let s = engineeringAction(harvested(), { type: 'plant' })
  s = { ...s, batteryKwh: 0, controls: { ...s.controls, battery: false } }
  // This artificial dispatch fixture deliberately drains the battery; compare
  // conservation for each step delta rather than the original battery total.
  s = engineeringAction(s, { type: 'dust' })
  const crop = advanceEngineering(s, 0.25)
  const food = advanceEngineering(engineeringAction(s, { type: 'priority', value: 'food' }), 0.25)
  assert.ok(food.last.cold > crop.last.cold)
  assert.ok(food.last.light < crop.last.light)
  close(food.totals.servedKwh - s.totals.servedKwh, crop.totals.servedKwh - s.totals.servedKwh)
  close(food.totals.solarKwh - s.totals.solarKwh, crop.totals.solarKwh - s.totals.solarKwh)
  assert.equal(s.controls.priority, 'crop')
})
test('LAB/1 and malformed profile snapshots cannot be mixed with the LAB/2 heat ledger', () => {
  const old = { ...initial(), profileVersion: 'ARES-LAB/1' }
  assert.throws(() => advanceEngineering(old, 1), /Unsupported engineering profile/)
  assert.throws(() => engineeringAction(old, { type: 'toggle', control: 'climate' }), /Unsupported engineering profile/)
})
