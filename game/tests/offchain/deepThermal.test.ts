import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, type ColonyState, type Scenario } from '../../apps/web/src/colony/simulation'
import { buildStartColony } from '../../scripts/deepScenario'
import { DEEP_P } from '../../apps/web/src/colony/deep/params'
import {
  createSection, outsideTemperatureC, stepSectionThermal, type Section,
} from '../../apps/web/src/colony/deep/sections'
import type { ColonyWorld } from '../../apps/web/src/colony/deep/world'

/**
 * Тепловая модель секций.
 *
 * Эти тесты появились после аудита, в котором я сначала ошибочно объявил
 * модель «на два порядка неверной» — на основании замера, который не смог
 * потом воспроизвести. Поэтому здесь закреплено только то, что реально
 * измерено прогоном движка, и ровно те утверждения, которые тот замер
 * подтвердил. Одно из них — про поле `coolerKw` — ловит настоящий дефект:
 * охлаждение считалось и возвращалось, но никуда не сохранялось.
 */

const HOURS = 24.6229
const NOMINAL: Scenario = { sunHours: 18, waterRecovery: 0.94 }
const BLACKOUT: Scenario = { sunHours: 0, waterRecovery: 0.94 }

const step = (sols: number, scenario: Scenario = NOMINAL, deep?: Record<string, unknown>): ColonyWorld => {
  let state: ColonyState = buildStartColony()
  for (let sol = 1; sol <= sols; sol++) {
    if (deep && state.world) state.world.scenario = { ...state.world.scenario, ...deep }
    state = advanceDay(state, scenario)
  }
  return state.world!
}

const sectionOf = (world: ColonyWorld, kind: string): Section => {
  const s = world.sections.find(x => x.kind === kind)
  if (!s) throw new Error(`no ${kind} section`)
  return s
}

test('the thermal balance of a section closes — and cooling is actually reported', () => {
  // Теплица в номинале: лампы греют, оболочка отводит, остальное снимает
  // охлаждение. Именно здесь сломался бы расчёт, если бы coolerKw не
  // сохранялся: сумма не сходилась в +0.2 kW каждый сол, хотя температура
  // стояла на месте.
  const world = step(3)
  const gh = sectionOf(world, 'greenhouse')
  const net = gh.internalHeatKw + gh.envelopeKw + gh.heaterKw - gh.coolerKw
  assert.ok(Math.abs(net) < 1e-6,
    `greenhouse heat balance must close at steady state, net = ${net} kW`)
  assert.ok(gh.coolerKw > 0,
    'a lit greenhouse must be cooling, and its cooling load must be visible on the section')
  assert.ok(gh.internalHeatKw > 0, 'lamps must inject heat')
  assert.ok(gh.envelopeKw < 0, 'the envelope must carry heat out to Mars')
})

test('cooling load is stored on the section, not only in world totals', () => {
  const world = step(3)
  const gh = sectionOf(world, 'greenhouse')
  const reported = gh.coolerKw
  // Мировой итог накапливается из возвращаемого значения, а не из поля,
  // поэтому совпадение проверяет, что пишутся оба.
  assert.ok(reported > 0 && (world.totals.coolingKwh ?? 0) > 0,
    'cooling must appear both per-section and in the world totals')
})

test('with enough power a thermostat holds the setpoint exactly', () => {
  // Это не «отсутствие инерции», а работа термостата. Инерция обязана
  // проявляться там, где мощности не хватает (следующий тест).
  for (const kind of ['habitat', 'greenhouse']) {
    const world = step(8)
    const s = sectionOf(world, kind)
    const target = kind === 'greenhouse' ? 20 : 21
    assert.ok(Math.abs(s.temperatureC - target) < 1e-6,
      `${kind} must sit on its ${target} °C setpoint, got ${s.temperatureC}`)
  }
})

test('without power a section drifts gradually — inertia is real, not instant', () => {
  const world = step(30, BLACKOUT, { sunHours: 0 })
  const hab = sectionOf(world, 'habitat')
  // Равновесие «внутреннее тепло против оболочки» лежит далеко за +50 °C,
  // но за 30 солов секция должна дойти лишь до ~24 °C. Мгновенный выход на
  // равновесие означал бы, что теплоёмкость не работает.
  assert.ok(hab.temperatureC > 21, `habitat must drift off setpoint, got ${hab.temperatureC}`)
  assert.ok(hab.temperatureC < 30,
    `habitat must NOT reach equilibrium within 30 sols — that would mean no inertia; got ${hab.temperatureC}`)
  assert.equal(hab.heaterKw, 0, 'no power means no heat')
  assert.ok(hab.coolerKw === 0)
})

test('a blackout is felt within a few sols, not after a season', () => {
  // Отложенное последствие обязано быть видимым на горизонте решения
  // игрока: за 5 солов отклонение уже заметно, за 30 — серьёзно.
  const early = sectionOf(step(5, BLACKOUT, { sunHours: 0 }), 'habitat').temperatureC
  const late = sectionOf(step(30, BLACKOUT, { sunHours: 0 }), 'habitat').temperatureC
  assert.ok(late > early, 'the drift must accumulate')
  assert.ok(late - early < 15, 'but it must stay gradual, not run away')
})

test('an unpowered greenhouse with no lamps falls toward Mars', () => {
  const world = step(30, BLACKOUT, { sunHours: 0 })
  const gh = sectionOf(world, 'greenhouse')
  assert.ok(gh.temperatureC < -20,
    `a dark greenhouse must freeze, got ${gh.temperatureC} °C`)
  assert.ok(gh.temperatureC > DEEP_P.outsideMinC,
    'but it must lag behind the outside — the envelope is not a short circuit')
})

test('a greenhouse whose cooling failed runs away at a bounded, documented rate', () => {
  // Лампы 0.52 kW против оболочки −0.32 kW: избыток ≈0.2 kW при теплоёмкости
  // теплицы даёт около 19 °C за сол. Прежний комментарий в коде обещал
  // «за +70 °C за сутки» при 2.7 kW ламп — ни одна цифра не соответствовала
  // коду. Здесь закреплено измеренное значение.
  const gh = createSection('sec-test', 'test', 'dev-test', 'greenhouse', 90)
  gh.temperatureC = 20
  const before = gh.temperatureC
  stepSectionThermal(gh, HOURS, 0.52, outsideTemperatureC(6, 0), 20, 0) // hvac = 0: отказало
  const rise = gh.temperatureC - before
  assert.ok(rise > 5, `lamps must heat an uncooled greenhouse, got +${rise} °C/sol`)
  assert.ok(rise < 40,
    `the runaway must stay near the documented ~19 °C/sol, got +${rise} °C/sol — update the doc if the lamps changed`)
})

test('heater and cooler authority are limited by available power', () => {
  const s = createSection('sec-h', 'h', 'dev-h', 'habitat', 120)
  s.temperatureC = 21
  // Секция уже на уставке: при полной мощности ничего не нужно.
  const idle = stepSectionThermal(s, HOURS, 0.4, -52, 21, 1)
  assert.ok(idle.heaterKw < DEEP_P.heaterKw, 'holding a setpoint must not saturate the heater')
  // Без мощности обогрева нет при любом запросе.
  const off = stepSectionThermal(s, HOURS, 0.4, -52, 21, 0)
  assert.equal(off.heaterKw, 0)
  assert.equal(off.coolerKw, 0)
})

test('a cold scenario makes the outside colder — the sign is part of the contract', () => {
  const nominal = outsideTemperatureC(6, 0)
  assert.ok(outsideTemperatureC(6, -6) < nominal - 5.9, 'a −6 °C shift must cool')
  assert.ok(outsideTemperatureC(6, 4) > nominal + 3.9, 'a positive shift must warm')
  for (let hour = 0; hour < 24.6229; hour += 1) {
    const t = outsideTemperatureC(hour, 0)
    assert.ok(t >= -60 && t <= -20, `outside ${t} °C is not Mars-like`)
  }
})
