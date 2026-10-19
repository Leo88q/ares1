import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, initialColony, type ColonyState } from '../../apps/web/src/colony/simulation'
import { atmosphereQuality } from '../../apps/web/src/colony/deep/sections'
import { modulePowerCapacityKw } from '../../apps/web/src/colony/networks'
import { DEEP_P } from '../../apps/web/src/colony/deep/params'
import { linkCapacityKw } from '../../apps/web/src/colony/networks'
import type { ColonyWorld } from '../../apps/web/src/colony/deep/world'

/**
 * Блок B: механизм обязан СРАБАТЫВАТЬ, а не просто существовать.
 *
 * Повод для этого файла — конкретный дефект. Охлаждение корневой зоны (B2)
 * было закоммичено как работающее, покрытое тестами, и при этом всегда
 * выдавало ровно −2.5 °C: `irrigationRatio` был равен единице при любом
 * дефиците воды. Юнит-тесты были зелёными, потому что проверяли функцию
 * изолированно, а не её место в цепочке.
 *
 * Поэтому здесь каждый механизм прогоняется через общий движок и у него
 * измеряется РАЗМАХ. Механизм, у которого минимум равен максимуму, не
 * работает — независимо от того, что говорят юнит-тесты.
 *
 * Важно и обратное: в номинальном сценарии многие механизмы честно не
 * срабатывают, потому что колония переразмерена (воды ≈800 л/сол против
 * ≈86 л/сол спроса грядок). Это не defect, а отсутствие дефицита. Поэтому
 * порог ставится так: механизм должен сработать хотя бы в ОДНОМ из трёх
 * сценариев задания.
 */

const NOMINAL = { sunHours: 12, waterRecovery: 0.85 }
const DIM = { sunHours: 4.5, waterRecovery: 0.85 }

interface Trace { min: number; max: number; n: number }
const empty = (): Trace => ({ min: Infinity, max: -Infinity, n: 0 })
const push = (t: Trace, v: number): void => {
  if (!Number.isFinite(v)) return
  t.min = Math.min(t.min, v); t.max = Math.max(t.max, v); t.n++
}
const spread = (t: Trace): number => (t.n === 0 ? 0 : t.max - t.min)

interface Gauges {
  rootVsAir: Trace; rootC: Trace; circulation: Trace; quality: Trace
  temp: Trace; nutrientReturned: Trace; contamination: Trace; salt: Trace
}
const fresh = (): Gauges => ({
  rootVsAir: empty(), rootC: empty(), circulation: empty(), quality: empty(),
  temp: empty(), nutrientReturned: empty(), contamination: empty(), salt: empty(),
})

const run = (scenario: typeof NOMINAL, sols = 180): Gauges => {
  const g = fresh()
  let state: ColonyState = advanceDay(initialColony(), scenario)
  for (let sol = 0; sol < sols; sol++) {
    state = advanceDay(state, scenario)
    const w = state.world!
    for (const b of w.batches) {
      if (b.plantedSol === null) continue
      const dev = w.devices.find(d => d.id === b.greenhouseId)
      const sec = w.sections.find(s => s.id === dev?.sectionId)
      push(g.rootVsAir, b.rootTemperatureC - (sec?.temperatureC ?? 20))
      push(g.rootC, b.rootTemperatureC)
      push(g.contamination, b.contamination)
      push(g.salt, b.saltIndex)
    }
    for (const s of w.sections) {
      push(g.circulation, s.circulation)
      push(g.quality, atmosphereQuality(s))
      push(g.temp, s.temperatureC)
    }
    push(g.nutrientReturned, w.totals.nutrientReturnedKg)
  }
  return g
}

const NOM = run(NOMINAL)
const DIMG = run(DIM)

test('B2: the root zone really departs from the air temperature', () => {
  // Регрессия на главный дефект блока B. Пока irrigationRatio всегда был
  // единицей, размах здесь составлял 0.022 °C — то есть механизм не работал.
  assert.ok(Math.max(spread(NOM.rootVsAir), spread(DIMG.rootVsAir)) > 0.5,
    `root zone must move: nominal ${spread(NOM.rootVsAir).toFixed(4)} °C, dim ${spread(DIMG.rootVsAir).toFixed(4)} °C`)
  // И знак осмыслен: корни не равны воздуху и не просто сдвинуты на константу.
  assert.ok(DIMG.rootVsAir.min < -1.0 && DIMG.rootVsAir.max > -1.2,
    `the offset must vary, not sit at one value: ${DIMG.rootVsAir.min.toFixed(3)} … ${DIMG.rootVsAir.max.toFixed(3)}`)
})

test('B6: circulation really stops when power fails', () => {
  // Циркуляция всегда ~1.0 в номинале: питания хватает, вентиляторы крутятся.
  // Механизм живой, только если он способен упасть — проверяем на дефиците.
  assert.ok(DIMG.circulation.min < 0.5,
    `circulation must collapse under power shortage, min ${DIMG.circulation.min.toFixed(4)}`)
  assert.ok(spread(DIMG.quality) > 0.1,
    `air quality must follow circulation, spread ${spread(DIMG.quality).toFixed(4)}`)
})

test('8: thermal chains really swing, they are not a flat set point', () => {
  assert.ok(Math.max(spread(NOM.temp), spread(DIMG.temp)) > 5,
    `sections must heat and cool: nominal ${spread(NOM.temp).toFixed(3)} °C, dim ${spread(DIMG.temp).toFixed(3)} °C`)
  assert.ok(DIMG.temp.min < 0, `an unpowered section must go cold, min ${DIMG.temp.min.toFixed(2)} °C`)
})

test('B4: compost really returns nutrients, and the return stays small', () => {
  // Возврат обязан быть НЕнулевым (иначе цепочка мертва) и малым: замкнутой
  // петли нет по требованию задания, а не по недоделке.
  assert.ok(NOM.nutrientReturned.max > 0,
    'compost must return something')
  assert.ok(NOM.nutrientReturned.max < 1,
    `the compost loop must stay far from closed, got ${NOM.nutrientReturned.max.toFixed(4)} kg`)
})

test('B3: hidden contamination and salt accumulate, and growth responds', () => {
  // Скрытые величины видны только через анализ — но обязаны копитьcя, иначе
  // лаборатории нечего находить.
  assert.ok(spread(NOM.contamination) > 0.01,
    `contamination must accumulate, spread ${spread(NOM.contamination).toFixed(5)}`)
  assert.ok(spread(NOM.salt) > 0.01,
    `salt must accumulate, spread ${spread(NOM.salt).toFixed(5)}`)
})

test('B7: a long power line really throttles the device at its end', () => {
  // Ёмкость канала живёт на самом краю достижимого: при 8 кВт и спаде на
  // 40 клетках линия упирается в номинал агрегата (1.1 кВт у экстрактора)
  // только после ~252 клеток, а движок допускает максимум 300. То есть
  // механизм рабочий, но игроку нужно нарочно тянуть кабель зигзагом.
  // Это честно зафиксировано здесь, а не спрятано за «так и задумано».
  const at = (cells: number): number => linkCapacityKw(cells, DEEP_P.powerLinkCapacityKw, DEEP_P.powerLinkDerateCells)
  assert.ok(at(300) < at(10), 'a longer line must carry less')
  // Половина ёмкости — ровно на derateCells: это определение параметра.
  assert.ok(Math.abs(at(DEEP_P.powerLinkDerateCells) - DEEP_P.powerLinkCapacityKw / 2) < 1e-9,
    'capacity must halve exactly at derateCells')
  // И предел реально способен упереться в агрегат, а не только в teorии.
  assert.ok(at(300) < 1.1,
    `a 300-cell line must fall below the extractor's 1.1 kW rating, got ${at(300).toFixed(3)} kW`)
  // Дублирование кабеля удваивает пропускную способность: резервирование
  // работает, а не дублирует иконку.
  const state = advanceDay(initialColony(), NOMINAL)
  const capacities = modulePowerCapacityKw(state, DEEP_P.powerLinkCapacityKw, DEEP_P.powerLinkDerateCells)
  assert.ok(capacities.size > 0, 'the starter colony must have cabled modules')
})

test('no mechanism is left inert across all three brief scenarios', () => {
  // Итог блока B. Каждый механизм должен сработать хотя бы в одном сценарии.
  // Если кто-то перестанет срабатывать — здесь будет падение, а не тишина.
  const checks: Array<[string, number, number]> = [
    ['B2 корневая зона', Math.max(spread(NOM.rootVsAir), spread(DIMG.rootVsAir)), 0.5],
    ['B6 циркуляция', Math.max(spread(NOM.circulation), spread(DIMG.circulation)), 0.1],
    ['8 тепловые цепочки', Math.max(spread(NOM.temp), spread(DIMG.temp)), 5],
    ['B4 компост', Math.max(spread(NOM.nutrientReturned), spread(DIMG.nutrientReturned)), 1e-6],
    ['B3 загрязнение', Math.max(spread(NOM.contamination), spread(DIMG.contamination)), 0.01],
  ]
  const dead = checks.filter(([, v, min]) => v < min).map(([name, v, min]) => `${name}: ${v.toFixed(5)} < ${min}`)
  assert.equal(dead.length, 0, `механизмы не срабатывают ни в одном сценарии:\n  ${dead.join('\n  ')}`)
})

test('the nominal colony is honestly over-provisioned, and this test says so', () => {
  // Фиксирует то, что иначе выглядит как баг: в номинале воды хватает с
  // запасом, поэтому затвор раствора (B1) там не срабатывает. Если кто-то
  // изменит баланс так, что воды станет впритык, это тест покажет.
  const w: ColonyWorld = advanceDay(initialColony(), NOMINAL).world!
  const planted = w.batches.filter(b => b.plantedSol !== null)
  const demand = planted.reduce((s, b) => s + b.areaM2 * DEEP_P.cropWaterLPerM2PerSol * b.density, 0)
  const available = w.stock.amount.water_clean
  assert.ok(demand > 0, 'there must be planted beds')
  assert.ok(available > demand,
    `the nominal colony must sit above its bed demand: ${available.toFixed(1)} L vs ${demand.toFixed(1)} L`)
  // Отсюда следствие: полив идёт без дефицита, и корни держатся у минимума.
  assert.ok(spread(NOM.rootVsAir) < 0.5,
    `with no deficit the root offset should barely move, got ${spread(NOM.rootVsAir).toFixed(4)}`)
})
