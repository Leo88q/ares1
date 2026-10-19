import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, initialColony, DEFAULT_SCENARIO } from '../../apps/web/src/colony/simulation'
import type { ColonyState } from '../../apps/web/src/colony/simulation'
import type { ColonyWorld } from '../../apps/web/src/colony/deep/world'

/**
 * Питательный раствор: питание доставляется водой.
 *
 * Здесь собраны три дефекта одной природы — механизм был написан, но не был
 * подключён, при этом юнит-тесты оставались зелёными, потому что проверяли
 * функцию изолированно, а не её место в цепочке.
 *
 *   1. Охлаждение корневой зоны было константой. `irrigationRatio` считался
 *      как clamp01(1 / max(0.2, waterFraction)), а `fraction` УЖЕ обрезает
 *      в 0…1 — значит 1/x ≥ 1, и clamp01 снова давал ровно 1 при ЛЮБОМ
 *      дефиците воды. Корни всегда получали ровно −2.5 °C.
 *   2. N/P/K не зависели от воды: склад полон → фактор 1.0, даже если
 *      субстрат сухой. Раствор доставлялся по воздуху.
 *   3. `feedRate` обрезался в 1.0, поэтому рецепт «rich» (1.35) честно
 *      работал в лабораторном A/B и молча не работал в теплице.
 *
 * Тесты идут по полному `advanceDay`, а не по отдельным функциям.
 *
 * Как устроен прогон. Внутри суток `operateEquipment` (добыча и очистка)
 * идёт РАНЬШЕ `growCrops`, поэтому исправный контур успевает наполнить бак
 * до того, как грядки начнут пить: в номинале колония даёт ~800 л/сол при
 * спросе грядок ~86 л/сол. Запас превышает спрос примерно в 9 раз, и затвор
 * честно НЕ срабатывает — дефицита просто нет. Поэтому «сухой» прогон гасит
 * сам контур воды: это не синтетика, а ровно третий сценарий из ТЗ.
 *
 * Сушить нужно бак МИРА, а не `state.waterLitres`: `syncWorldFromState` воду
 * не синхронизирует (глубокий слой — единственный писатель), поэтому правка
 * состояния до мира не доходит.
 */

const WATER_CHAIN = ['extractor', 'recycler', 'purifier']

/** Глубокий мир с заданным запасом воды; при `breakChain` контур воды погашен. */
const seeded = (waterLitres: number, breakChain: boolean): ColonyState => {
  const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const world = base.world!
  world.stock.amount.water_clean = waterLitres
  if (breakChain) {
    world.stock.amount.water_raw = 0
    world.stock.amount.water_grey = 0
    // condition, а не fault: отказ здесь же и починят (авторемонт работает),
    // а износ агрегата до нуля — это и есть отказ насоса из ТЗ.
    for (const device of world.devices) {
      if (WATER_CHAIN.includes(device.kind)) { device.condition = 0; device.wear = 1 }
    }
  }
  return base
}

/**
 * Приращение величин за ОДНИ сутки. totals.* — накопительные итоги от нуля,
 * поэтому сравнивать их напрямую нельзя: в них уже лежит вся история.
 */
const deltaOverOneSol = (waterLitres: number, breakChain: boolean, sols = 1) => {
  let state = seeded(waterLitres, breakChain)
  for (let i = 0; i < sols; i++) state = advanceDay(state, DEFAULT_SCENARIO)
  const before = state.world!
  const after = advanceDay(state, DEFAULT_SCENARIO).world!
  return {
    before, after,
    nutrientKg: after.totals.nutrientAppliedKg - before.totals.nutrientAppliedKg,
    waterL: after.totals.waterIndustrialL - before.totals.waterIndustrialL,
    development: sumDev(after) - sumDev(before),
  }
}

const planted = (w: ColonyWorld) => w.batches.filter(b => b.plantedSol !== null)
const sumDev = (w: ColonyWorld): number => planted(w).reduce((s, b) => s + b.development, 0)
const meanRoot = (w: ColonyWorld): number => {
  const xs = planted(w).map(b => b.rootTemperatureC)
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

const nutrientIn = (w: ColonyWorld): number =>
  w.stock.amount.nutrient_n + w.stock.amount.nutrient_p + w.stock.amount.nutrient_k

const wet = () => deltaOverOneSol(4000, false)
const dry = () => deltaOverOneSol(3, true)

test('a dry root zone starves the plant even with a full fertiliser store', () => {
  // Суть проверки. Удобрения на складе есть в обоих прогонах (состояние не
  // трогаем), разница только в воде. Если питание доставляется раствором, то
  // без воды грядка не съест почти ничего — сколько бы ни лежало на складе.
  const w = wet(); const d = dry()
  assert.ok(w.nutrientKg > 1e-9, `the wet colony must feed its crop, got ${w.nutrientKg}`)
  assert.ok(d.nutrientKg < w.nutrientKg * 0.25,
    `nutrient uptake must collapse without water: wet ${w.nutrientKg.toFixed(5)} kg vs dry ${d.nutrientKg.toFixed(5)} kg`)
})

test('the nutrient the carrier did not deliver stays in the store', () => {
  // Обратная сторона: недолитый раствор не списывается. Если этого нет,
  // удобрения исчезают в никуда, а не остаются на складе.
  const w = wet(); const d = dry()
  const total = (x: typeof w): number => {
    const s = x.after.stock.amount
    return s.nutrient_n + s.nutrient_p + s.nutrient_k
  }
  assert.ok(total(d) > total(w),
    `a dry colony must hold MORE fertiliser: dry ${total(d).toFixed(4)} vs wet ${total(w).toFixed(4)}`)
  // И ничего не возникает из ничего. Склад за сутки может вырасти только на
  // возврат компоста — сравнивать надо с СОБСТВЕННЫМ «до» каждого прогона, а
  // не с чужим итогом: у сухого прогона контур сломан с первого сола, поэтому
  // он законно накопил больше за всю историю.
  for (const [label, run] of [['wet', w], ['dry', d]] as const) {
    const stockBefore = nutrientIn(run.before)
    const returned = run.after.totals.nutrientReturnedKg - run.before.totals.nutrientReturnedKg
    assert.ok(total(run) <= stockBefore + returned + 1e-6,
      `${label}: the store may only grow by compost — before ${stockBefore.toFixed(5)} + returned ${returned.toFixed(5)}, after ${total(run).toFixed(5)}`)
    assert.ok(total(run) >= 0, `${label}: the store must never go negative`)
  }
})

test('growth actually differs, not just the accounting', () => {
  // Списания можно задвоить и получить «учёт» без физики. Проверяем, что
  // растение реально развивается медленнее.
  const w = wet(); const d = dry()
  assert.ok(d.development < w.development,
    `a dry bed must grow slower: wet ${w.development.toFixed(6)} vs dry ${d.development.toFixed(6)}`)
})

test('root-zone chilling is dynamic, not a constant offset', () => {
  // Регрессия на дефект №1. Пока irrigationRatio всегда равнялся единице,
  // корни получали ровно −2.5 °C при любом поливе: обе температуры совпадали
  // бы до шестого знака (17.478 / 17.478), и тест не проходил бы.
  const w = meanRoot(wet().after)
  const d = meanRoot(dry().after)
  assert.ok(Math.abs(w - d) > 0.5,
    `root temperature must track irrigation: wet ${w.toFixed(3)} °C vs dry ${d.toFixed(3)} °C`)
  // Знак имеет значение: поливной воды нет — корням ТЕПЛЕЕ, не холоднее.
  assert.ok(d > w, `starved irrigation must leave roots warmer: dry ${d.toFixed(3)} vs wet ${w.toFixed(3)}`)
})

test('a water failure costs water too, and the crop is told about it', () => {
  // Тот же сценарий, что и проверка №1, но через расход воды: убеждаемся, что
  // «сухой» прогон сухой по-настоящему, а не только в части удобрений.
  const w = wet(); const d = dry()
  assert.ok(d.waterL < w.waterL,
    `a broken water chain must irrigate less: wet ${w.waterL.toFixed(2)} L vs dry ${d.waterL.toFixed(2)} L`)
})

test('the lab recipe is not silently clipped in the greenhouse', () => {
  // Дефект №3: лаборатория честно сравнивала режимы с feedRate > 1, а теплица
  // этот же рецепт обрезала до 1.0. Обе стороны обязаны считать одинаково.
  const run = (feedRate: number): number => {
    const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
    for (const batch of base.world!.batches) if (batch.plantedSol !== null) batch.feedRate = feedRate
    const before = base.world!.totals.nutrientAppliedKg
    return advanceDay(base, DEFAULT_SCENARIO).world!.totals.nutrientAppliedKg - before
  }
  const normal = run(1)
  const rich = run(1.35)
  assert.ok(rich > normal * 1.05,
    `a richer recipe must cost more: rich ${rich.toFixed(5)} vs normal ${normal.toFixed(5)}`)
  // Но перекорм не даёт сверхроста: это «роскошное» потребление плюс соли.
  const devOf = (feedRate: number): number => {
    const base = advanceDay(initialColony(), DEFAULT_SCENARIO)
    for (const batch of base.world!.batches) if (batch.plantedSol !== null) batch.feedRate = feedRate
    return sumDev(advanceDay(base, DEFAULT_SCENARIO).world!)
  }
  assert.ok(devOf(1.35) <= devOf(1) + 1e-9,
    'overfeeding must not buy extra growth — only extra fertiliser and salt')
})
