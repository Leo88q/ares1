import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  colonyFreeStorageKg, colonyStock, drawFromColony, receiveLabFood, shippableKg, shippableLots,
  supplyGrant, SUPPLY_STEP, SUPPLY_UNIT,
} from '../../apps/web/src/lab/bridge'
import type { LabSupplyResource } from '../../apps/web/src/lab/bridge'
import { colonyLink, microFieldEconomics, tierEconomics } from '../../apps/web/src/lab/economics'
import { advanceDays, DEFAULT_SCENARIO, initialColony, SLOTS, syncView } from '../../apps/web/src/colony/simulation'
import type { ColonyState } from '../../apps/web/src/colony/simulation'
import {
  advanceEngineering, canHarvest, engineeringAction, harvestMass, initialEngineering, LAB, storageKg, supplyRoom,
} from '../../apps/web/src/fields/engineering/engine'
import type { EngineeringState } from '../../apps/web/src/fields/engineering/engine'
import { storedKg, unifiedBalance } from '../../apps/web/src/organism/unified'
import { fieldPriceMicro } from '../../apps/web/src/utils/constants'
import { canLinkFieldToColony, fieldTaxPerDayMicro, fieldYieldPerDayMicro, paybackDays } from '../../apps/web/src/organism/market'
import { MARKET } from '../../apps/web/src/organism/parameters'

/**
 * Мост «полевая лаборатория ↔ колония» (продакт-версия FIELD LAB, 2026-10-17).
 *
 * Секции обязаны видеть ОДИН запас: вода, питание и запчасти уходят из стока базы
 * ровно в том объёме, который принял стенд, а партия еды со стенда приходит в
 * хранилище базы и не ломает единый реестр organism/unified.ts. Ничего on-chain
 * здесь нет: мост не читает кошелёк, не минтит POTATO и не отправляет транзакции.
 */
const close = (a: number, b: number, epsilon = 1e-7): void => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`)
const colony = (): ColonyState => initialColony()
const bench = (tier: 0 | 1 | 2 = 0): EngineeringState => initialEngineering('lab-bench', tier)
const grownBench = (tier: 0 | 1 | 2 = 0): EngineeringState => advanceEngineering(bench(tier), 7 * LAB.solHours)
const harvestedBench = (tier: 0 | 1 | 2 = 0): EngineeringState => engineeringAction(grownBench(tier), { type: 'harvest' })

/** Оба реестра после передачи: сумма запаса не изменилась, приток стенда записан. */
function assertTransferConserved(before: ColonyState, after: ColonyState, beforeSim: EngineeringState, afterSim: EngineeringState, resource: LabSupplyResource): void {
  const total = (c: ColonyState, s: EngineeringState): number => resource === 'water'
    ? c.waterLitres + s.supplyL
    : resource === 'nutrients' ? c.nutrientsKg + s.nutrientsKg
      : c.sparesKg + s.spares
  close(total(after, afterSim), total(before, beforeSim))
  const inflow = resource === 'water' ? afterSim.totals.inflowLitres - beforeSim.totals.inflowLitres
    : resource === 'nutrients' ? afterSim.totals.inflowNutrientsKg - beforeSim.totals.inflowNutrientsKg
      : afterSim.totals.inflowSpares - beforeSim.totals.inflowSpares
  close(colonyStock(before, resource) - colonyStock(after, resource), inflow)
  assert.ok(inflow >= 0)
  // Единый реестр еды передача снабжения не трогает.
  assert.deepEqual(unifiedBalance(after.ledger), unifiedBalance(before.ledger))
}

/**
 * База с известным свободным местом хранилища. Стартовая колония забита под
 * потолок (120 кг из 120), поэтому кг честно съедаются экипажем: запас падает,
 * отток растёт, остаток единого реестра не меняется.
 */
function baseWithFreeKg(freeKg: number): ColonyState {
  const base = colony()
  const stored = storedKg(base.ledger)
  const eat = Math.min(stored, Math.max(0, stored - (base.ledger.storageCapKg - freeKg)))
  const fromProcessed = Math.min(eat, base.ledger.processedKg)
  const fromRaw = eat - fromProcessed
  return syncView({
    ...base,
    ledger: {
      ...base.ledger,
      processedKg: base.ledger.processedKg - fromProcessed,
      rawKg: base.ledger.rawKg - fromRaw,
      eatenKg: base.ledger.eatenKg + eat,
    },
  })
}

/** Передать снабжение так, как это делает экран лаборатории: стенд + сток базы. */
function transfer(state: ColonyState, sim: EngineeringState, resource: LabSupplyResource): { state: ColonyState; sim: EngineeringState; granted: number } {
  const granted = supplyGrant(state, sim, resource)
  if (granted <= 0) return { state, sim, granted: 0 }
  return {
    state: drawFromColony(state, resource, granted).state,
    sim: engineeringAction(sim, { type: 'supply', resource, amount: granted }),
    granted,
  }
}

test('supply grant is the minimum of the step, the colony stock and the free bench room', () => {
  const state = colony(), sim = bench()
  for (const resource of ['water', 'nutrients', 'spares'] as const) {
    const grant = supplyGrant(state, sim, resource)
    assert.equal(grant, Math.min(SUPPLY_STEP[resource], colonyStock(state, resource), supplyRoom(sim, resource)))
    assert.ok(grant > 0, `${resource}: a fresh colony and an empty bench must allow a delivery`)
    assert.ok(SUPPLY_UNIT[resource] === 'L' || SUPPLY_UNIT[resource] === 'kg' || SUPPLY_UNIT[resource] === 'pcs')
  }
  // Запчасти — целые детали: дробный сток базы не даёт половинку детали.
  assert.equal(supplyGrant({ ...state, sparesKg: 0.5 }, sim, 'spares'), 0)
  assert.equal(supplyGrant({ ...state, sparesKg: 2.7 }, sim, 'spares'), 1)
  // Пустой сток или заполненный стенд — отказ, а не отрицательная передача.
  for (const resource of ['water', 'nutrients', 'spares'] as const) {
    assert.equal(supplyGrant({ ...state, waterLitres: 0, nutrientsKg: 0, sparesKg: 0 }, sim, resource), 0)
    const full = resource === 'water' ? { ...sim, supplyL: LAB.supplyCapacityL }
      : resource === 'nutrients' ? { ...sim, nutrientsKg: LAB.nutrientCapacityKg }
        : { ...sim, spares: LAB.sparesCapacity }
    assert.equal(supplyGrant(state, full, resource), 0)
  }
})

test('a delivery leaves the colony stock and lands on the bench: mass is conserved on both ledgers', () => {
  for (const tier of [0, 1, 2] as const) {
    for (const resource of ['water', 'nutrients', 'spares'] as const) {
      const before = colony(), beforeSim = bench(tier)
      const { state, sim, granted } = transfer(before, beforeSim, resource)
      assert.ok(granted > 0)
      assertTransferConserved(before, state, beforeSim, sim, resource)
      // Сток базы не уходит в минус, стенд не переполняется.
      assert.ok(colonyStock(state, resource) >= 0)
      assert.ok(supplyRoom(sim, resource) >= 0)
      // Исходные объекты не изменены: мост чистый, состояние живёт в React-сторе.
      assert.deepEqual(before, colony())
      assert.deepEqual(beforeSim, bench(tier))
    }
  }
})

test('repeated deliveries drain the colony stock exactly and stop at the bench capacity', () => {
  let state = colony(), sim = bench(0)
  const startWater = state.waterLitres
  let moved = 0, guard = 0
  while (supplyGrant(state, sim, 'water') > 0) {
    const next = transfer(state, sim, 'water')
    moved += next.granted
    state = next.state; sim = next.sim
    assert.ok(++guard < 1000, 'water deliveries must terminate')
  }
  close(state.waterLitres, startWater - moved)
  close(sim.supplyL, LAB.supplyCapacityL)
  close(sim.totals.inflowLitres, moved)
  assert.equal(supplyGrant(state, sim, 'water'), 0)
  close(state.waterLitres + sim.supplyL, startWater + LAB.supplyInitialL)
  assert.deepEqual(unifiedBalance(state.ledger), unifiedBalance(colony().ledger))
})

test('a spare part is one kilogram of the colony spare stock, whole parts only', () => {
  let state = colony(), sim = bench(0)
  const startSpares = state.sparesKg, startParts = sim.spares
  let guard = 0
  while (supplyGrant(state, sim, 'spares') > 0) {
    const next = transfer(state, sim, 'spares')
    state = next.state; sim = next.sim
    assert.ok(Number.isInteger(sim.spares))
    assert.ok(++guard < 100, 'spare deliveries must terminate')
  }
  assert.equal(sim.spares, LAB.sparesCapacity)
  close(state.sparesKg, startSpares - (LAB.sparesCapacity - startParts))
  close(sim.totals.inflowSpares, LAB.sparesCapacity - startParts)
  assert.equal(supplyGrant(state, sim, 'spares'), 0)
})

test('lab food is accepted into the colony storage and keeps the unified ledger balanced', () => {
  for (const kind of ['raw', 'processed'] as const) {
    const sim = harvestedBench()
    const lot = shippableLots(sim)[0]
    assert.ok(lot && lot.kg > 0)
    close(lot.kg, harvestMass(grownBench()))

    const before = baseWithFreeKg(30)
    const freeBefore = colonyFreeStorageKg(before)
    close(freeBefore, 30)
    close(freeBefore, before.ledger.storageCapKg - storedKg(before.ledger))
    const kg = shippableKg(sim, lot.id, before)
    close(kg, Math.min(lot.kg, freeBefore))

    const accepted = receiveLabFood(before, kg, kind)
    close(accepted.accepted, kg)
    close(accepted.state.ledger.harvestedKg, before.ledger.harvestedKg + kg)
    close(kind === 'raw' ? accepted.state.ledger.rawKg : accepted.state.ledger.processedKg,
      (kind === 'raw' ? before.ledger.rawKg : before.ledger.processedKg) + kg)
    // Представление базы обновлено вместе с реестром: экраны видят одни числа.
    close(accepted.state.foodKg, storedKg(accepted.state.ledger))
    close(accepted.state.harvestedKg, accepted.state.ledger.harvestedKg)
    close(colonyFreeStorageKg(accepted.state), freeBefore - kg)

    // Баланс единого реестра: приток = запас + отток + остаток, остаток не изменился.
    const beforeBalance = unifiedBalance(before.ledger)
    const afterBalance = unifiedBalance(accepted.state.ledger)
    close(afterBalance.inflow, beforeBalance.inflow + kg)
    close(afterBalance.stock, beforeBalance.stock + kg)
    close(afterBalance.outflow, beforeBalance.outflow)
    close(afterBalance.residual, beforeBalance.residual)
    close(afterBalance.residual, afterBalance.inflow - afterBalance.stock - afterBalance.outflow)
    // Стенд потерял ровно столько же массы, сколько приняла база.
    const shipped = engineeringAction(sim, { type: 'ship', lotId: lot.id, kg })
    close(shipped.totals.shippedKg, kg)
    close(storageKg(shipped) + shipped.totals.shippedKg, shipped.totals.harvestedKg)
    close(storageKg(shipped), storageKg(sim) - kg)
  }
})

test('a full storage refuses the batch instead of losing or overfilling food', () => {
  const sim = harvestedBench()
  const lot = shippableLots(sim)[0]
  // Стартовая экспедиция забита под потолок: 120 кг из 120, принимать некуда.
  const full = colony()
  close(storedKg(full.ledger), full.ledger.storageCapKg)
  close(colonyFreeStorageKg(full), 0)
  assert.equal(shippableKg(sim, lot.id, full), 0)
  const refused = receiveLabFood(full, lot.kg, 'raw')
  assert.equal(refused.accepted, 0)
  assert.equal(refused.state, full)
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(receiveLabFood(baseWithFreeKg(10), bad, 'raw').accepted, 0)
  }
  // Частичный приём: помещается только свободное место, остаток остаётся на стенде.
  const tight = baseWithFreeKg(1.5)
  close(colonyFreeStorageKg(tight), 1.5)
  const partial = receiveLabFood(tight, 10, 'raw')
  close(partial.accepted, 1.5)
  close(colonyFreeStorageKg(partial.state), 0)
  close(partial.state.ledger.harvestedKg, tight.ledger.harvestedKg + 1.5)
  // Масса не появилась и не пропала: съеденное + принятое дают тот же остаток.
  close(unifiedBalance(partial.state.ledger).residual, unifiedBalance(full.ledger).residual)
})

test('ship helpers never promise more than the lot or the base can take', () => {
  const sim = harvestedBench()
  const lot = shippableLots(sim)[0]
  const state = colony()
  assert.deepEqual(shippableLots(sim).map(item => item.id), sim.lots.filter(item => item.kg > 0).map(item => item.id))
  assert.equal(shippableKg(sim, lot.id, state), Math.min(lot.kg, colonyFreeStorageKg(state)))
  assert.equal(shippableKg(sim, lot.id + 999, state), 0)
  assert.equal(shippableLots({ ...sim, lots: [] }).length, 0)
})

test('a 30-sol expedition: the bench draws supplies, ships food and both ledgers stay closed', () => {
  let state = colony(), sim = bench(1)
  const scale = 1.35 // tier 1
  const startLedger = unifiedBalance(state.ledger)
  let drawnWater = 0, drawnNutrients = 0, drawnSpares = 0, shippedKg = 0, harvests = 0

  for (let day = 0; day < 30; day++) {
    // Колония живёт своей жизнью: день тратит воду и еду, грядки созревают.
    state = advanceDays(state, 1, DEFAULT_SCENARIO)
    sim = advanceEngineering(sim, LAB.solHours)
    if (canHarvest(sim)) {
      sim = engineeringAction(sim, { type: 'harvest' })
      harvests++
      if (sim.seeds > 0) sim = engineeringAction(sim, { type: 'plant' })
    }

    // Передача снабжения: сколько ушло из стока базы, столько пришло на стенд.
    const stockBefore = { water: state.waterLitres, nutrients: state.nutrientsKg, spares: state.sparesKg }
    const benchBefore = { water: sim.supplyL, nutrients: sim.nutrientsKg, spares: sim.spares }
    for (const resource of ['water', 'nutrients', 'spares'] as const) {
      const next = transfer(state, sim, resource)
      state = next.state; sim = next.sim
      if (resource === 'water') drawnWater += next.granted
      else if (resource === 'nutrients') drawnNutrients += next.granted
      else drawnSpares += next.granted
    }
    close(stockBefore.water - state.waterLitres, sim.supplyL - benchBefore.water)
    close(stockBefore.nutrients - state.nutrientsKg, sim.nutrientsKg - benchBefore.nutrients)
    close(stockBefore.spares - state.sparesKg, sim.spares - benchBefore.spares)

    // Что созрело на стенде — уходит в хранилище базы (ровно принятыми кг).
    for (const lot of shippableLots(sim)) {
      const kg = shippableKg(sim, lot.id, state)
      if (kg <= 0) break
      const accepted = receiveLabFood(state, kg, lot.kind)
      state = accepted.state
      sim = engineeringAction(sim, { type: 'ship', lotId: lot.id, kg: accepted.accepted })
      shippedKg += accepted.accepted
      close(accepted.accepted, kg)
    }

    // Инварианты держатся каждый день, а не только в конце.
    close(sim.totals.inflowLitres, drawnWater)
    close(sim.totals.inflowNutrientsKg, drawnNutrients)
    close(sim.totals.inflowSpares, drawnSpares)
    close(sim.totals.shippedKg, shippedKg)
    close(state.foodKg, storedKg(state.ledger))
    close(sim.tankL + sim.supplyL + sim.lineL + sim.totals.waterConsumedL,
      (LAB.tankInitialL + LAB.supplyInitialL + LAB.lineInitialL) * scale + sim.totals.inflowLitres)
    close(sim.nutrientsKg + sim.totals.nutrientsConsumedKg, LAB.nutrientsInitialKg * scale + sim.totals.inflowNutrientsKg)
    close(storageKg(sim) + sim.totals.spoiledKg + sim.totals.processingLossKg + sim.totals.shippedKg, sim.totals.harvestedKg)
    const balance = unifiedBalance(state.ledger)
    close(balance.residual, startLedger.residual, 1e-6)
    close(balance.residual, balance.inflow - balance.stock - balance.outflow, 1e-6)
    assert.ok(Number.isInteger(sim.spares) && sim.spares >= 0 && sim.spares <= LAB.sparesCapacity)
    assert.ok(state.waterLitres >= 0 && state.nutrientsKg >= 0 && state.sparesKg >= 0)
    assert.ok(supplyRoom(sim, 'water') >= 0 && supplyRoom(sim, 'nutrients') >= 0 && supplyRoom(sim, 'spares') >= 0)
  }

  assert.ok(harvests > 0, 'the bench must harvest during the expedition')
  assert.ok(drawnWater > 0 && drawnNutrients > 0 && drawnSpares > 0, 'the expedition must actually move resources')
  assert.ok(shippedKg > 0, 'the bench must feed the base')
  // Итог: партии стенда вошли в приток единого реестра базы, остаток не вырос из воздуха.
  const endLedger = unifiedBalance(state.ledger)
  assert.ok(endLedger.inflow >= startLedger.inflow + shippedKg - 1e-6)
  close(endLedger.residual, startLedger.residual, 1e-6)
  close(endLedger.residual, endLedger.inflow - endLedger.stock - endLedger.outflow, 1e-6)
})

test('colony link rules mirror the accepted market entry limits', () => {
  const pads = SLOTS.length
  const cap = Math.min(MARKET.colonyLinkedFieldCap, pads)
  assert.equal(cap, pads)
  for (const owned of [-1, 0, 1, 5, cap, cap + 7]) {
    const link = colonyLink(owned, Math.max(0, Math.min(owned, pads)))
    assert.equal(link.pads, pads)
    assert.equal(link.cap, cap)
    assert.equal(link.linkedFields, Math.min(Math.max(0, owned), cap))
    assert.equal(link.occupiedPads, Math.max(0, Math.min(owned, pads)))
    assert.equal(link.freePads, pads - link.occupiedPads)
    assert.equal(link.hasRoom, canLinkFieldToColony(link.linkedFields))
  }
  // Отрицательные и превышающие входные данные не ломают счётчики.
  const odd = colonyLink(999, -5)
  assert.equal(odd.linkedFields, cap)
  assert.equal(odd.occupiedPads, 0)
  assert.equal(odd.freePads, pads)
})

test('tier and micro-field economics are derived from the program mirror, never invented', () => {
  for (const balance of [0, 25_000_000, 250_000_000, 1_000_000_000]) {
    const rows = tierEconomics(balance)
    assert.equal(rows.length, 3)
    for (const row of rows) {
      assert.equal(row.priceMicro, fieldPriceMicro(row.tier))
      assert.equal(row.yieldPerDayMicro, fieldYieldPerDayMicro(row.tier))
      assert.equal(row.taxPerDayMicro, fieldTaxPerDayMicro(row.tier))
      assert.equal(row.payback, paybackDays(row.priceMicro, row.yieldPerDayMicro, row.taxPerDayMicro))
      assert.equal(row.affordable, balance >= row.priceMicro)
      assert.ok(row.priceMicro > 0 && row.yieldPerDayMicro > 0 && row.taxPerDayMicro >= 0)
      assert.ok(row.payback > 0)
      assert.ok(row.name.length > 0)
    }
    const micro = microFieldEconomics(0, balance)
    assert.ok(micro.priceMicro > 0 && micro.priceMicro < rows[0].priceMicro)
    assert.equal(micro.payback, paybackDays(micro.priceMicro, micro.yieldPerDayMicro, micro.taxPerDayMicro))
    assert.equal(micro.affordable, balance >= micro.priceMicro)
  }
  // E-C: каждое предыдущее поле делает микро-поле дороже.
  const prices = [0, 1, 2, 3, 10].map(owned => microFieldEconomics(owned, Number.MAX_SAFE_INTEGER).priceMicro)
  for (let i = 1; i < prices.length; i++) assert.ok(prices[i] >= prices[i - 1])
  // Нулевой баланс: ничего не «доступно», но цены остаются настоящими.
  assert.deepEqual(tierEconomics(0).map(row => row.affordable), [false, false, false])
})
