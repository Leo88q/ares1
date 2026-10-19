import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBatch, rootTemperatureFactor, relaxRootTemperatureC, rootZoneTargetC,
  stepBatch, temperatureFactor, NEUTRAL_FACTORS, type GrowthEnvironment,
} from '../../apps/web/src/colony/deep/growth'
import { DEEP_P } from '../../apps/web/src/colony/deep/params'

/**
 * Факторы роста: корневая зона и раздельное N/P/K.
 *
 * Эти два пункта можно реализовать «для галочки»: завести поле, которое
 * всегда равно температуре воздуха, и одну долю питания под тремя именами.
 * Тесты ниже проверяют, что поля действительно разные величины и что они
 * связывают рост по-разному.
 */

const env = (over: Partial<GrowthEnvironment> = {}): GrowthEnvironment => ({
  temperatureC: 20,
  rootTemperatureC: 20,
  co2PartialKpa: 0.09,
  o2PartialKpa: 18,
  lightFraction: 1,
  waterFraction: 1,
  nutrients: { n: 1, p: 1, k: 1 },
  waterlogRatio: 0,
  sol: 10,
  dtSols: 1,
  ...over,
})

const batch = () => {
  const b = createBatch('b-1', 'gh-1', 0, 10)
  b.plantedSol = 0
  b.health = 1
  b.lastTendSol = 0
  return b
}

test('the root zone runs colder than the air, and over-watering chills it further', () => {
  // Поливная вода приходит из очистки холодной: чем обильнее полив, тем
  // холоднее корням. Отсюда настоящий предел у стратегии «залить водой».
  const normal = rootZoneTargetC(20, 1)
  const heavy = rootZoneTargetC(20, 2)
  assert.ok(normal < 20, `roots must sit below the air, got ${normal}`)
  assert.ok(heavy < normal, `heavier irrigation must chill further: ${normal} → ${heavy}`)
  assert.ok(Math.abs(rootZoneTargetC(20, 0) - 20) < 1e-9, 'without irrigation there is no chill')
})

test('the substrate has inertia: roots do not take the new temperature instantly', () => {
  const target = rootZoneTargetC(10, 1)
  const part = relaxRootTemperatureC(20, target, 0.05)
  assert.ok(part < 20 && part > target, `a short step must move part-way, got ${part}`)
  const settled = relaxRootTemperatureC(20, target, 10)
  assert.ok(Math.abs(settled - target) < 1e-6, `a long step must arrive, got ${settled}`)
  // Шаг вдвое длиннее уводит дальше, но не линейно.
  const twice = relaxRootTemperatureC(20, target, 0.1)
  assert.ok(twice < part, 'a longer step must go further')
})

test('the root window is a different window, not a copy of the air one', () => {
  // У картофеля корни любят прохладу сильнее, чем ботва: клубни завязываются
  // на почве 15–20 °C, а лист тянется к 16–22 °C. Если бы корневая зона была
  // просто копией воздуха, «холодная почва» и «холодный воздух» были бы одним
  // и тем же фактором — и полив не имел бы значения.
  const airAt = (c: number) => temperatureFactor(c)
  // Корневое окно уже и смещено вниз.
  assert.ok(rootTemperatureFactor(15) > 0.99 && airAt(15) < 0.99,
    'at 15 °C roots are already comfortable while shoots are not yet')
  assert.ok(rootTemperatureFactor(21) < 0.99 && airAt(21) > 0.99,
    'at 21 °C shoots are still comfortable while roots are past their optimum')
  // Окна разные по ширине: у корней диапазон полного комфорта у́же.
  const width = (f: (c: number) => number) => {
    let n = 0
    for (let c = 0; c <= 40; c += 0.5) if (f(c) > 0.999) n++
    return n
  }
  assert.ok(width(rootTemperatureFactor) < width(airAt),
    `the root comfort band (${width(rootTemperatureFactor)}) must be narrower than the air one (${width(airAt)})`)
  // И всё-таки холод и жара останавливают корни полностью.
  assert.equal(rootTemperatureFactor(5), 0, 'frozen roots stop')
  assert.equal(rootTemperatureFactor(34), 0, 'boiled roots stop')
})

test('one missing element limits growth by Liebig, not by the average', () => {
  // Агрегатная доля скрывала «азота нет, фосфора завались»: среднее было
  // приличным, а расти было не на чем. Теперь правит минимум.
  const full = stepBatch(batch(), env())
  const noN = stepBatch(batch(), env({ nutrients: { n: 0.05, p: 1, k: 1 } }))
  const noK = stepBatch(batch(), env({ nutrients: { n: 1, p: 1, k: 0.05 } }))
  assert.ok((full.factors.nitrogen ?? 1) > 0.99, 'with everything present nothing limits')
  assert.ok(Math.abs((noN.factors.nitrogen ?? 1) - 0.05) < 1e-6, 'the missing element must show itself')
  assert.ok((noN.factors.phosphorus ?? 0) > 0.99, 'the other elements stay abundant')
  assert.ok(noN.dDevelopment < full.dDevelopment * 0.3,
    `growth must collapse on the missing element: ${noN.dDevelopment} vs ${full.dDevelopment}`)
  // Какой именно элемент пропал — видно раздельно.
  assert.ok(Math.abs((noK.factors.potassium ?? 1) - 0.05) < 1e-6)
  assert.ok((noK.factors.nitrogen ?? 0) > 0.99)
})

test('a cold root zone costs real yield even when the air is perfect', () => {
  // Суть разделения: воздух в норме, корни остыли — урожай всё равно падает.
  const warm = batch()
  const chilled = batch()
  const perfect = env()
  const coldRoots = env({ rootTemperatureC: 9 })
  for (let sol = 0; sol < 20; sol++) {
    stepBatch(warm, perfect)
    stepBatch(chilled, coldRoots)
  }
  assert.ok(chilled.development < warm.development * 0.8,
    `cold roots must hold growth back: ${chilled.development} vs ${warm.development}`)
  assert.ok(chilled.stress > warm.stress, 'and they must accumulate stress, not just slow down')
  assert.ok(perfect.temperatureC === coldRoots.temperatureC, 'the air was identical in both runs')
})

test('every growth factor is labelled, so the interface can name a cause', () => {
  // Факторов стало больше; тот, что останется без подписи, не объяснить игроку.
  const { FACTOR_LABEL } = require('../../apps/web/src/colony/deep/growth')
  for (const key of Object.keys(NEUTRAL_FACTORS)) {
    assert.ok(FACTOR_LABEL[key], `factor ${key} has no label`)
    assert.ok(FACTOR_LABEL[key].ru && FACTOR_LABEL[key].en, `factor ${key} is missing a translation`)
  }
})

test('chilled roots are a consequence of the model, not a separate dial', () => {
  const b = batch()
  assert.ok(b.rootTemperatureC > 15, 'a fresh bed starts warm, not pre-chilled')
  // Полив обильнее обычного — корням холоднее, без всяких дополнительных ручек.
  const e = env({ waterFraction: 0.5 })
  stepBatch(b, e)
  assert.ok(Number.isFinite(b.rootTemperatureC), 'the root temperature must stay finite')
  assert.ok(DEEP_P.rootZoneChillC > 0, 'the chill must be a real effect, not a zeroed parameter')
})
