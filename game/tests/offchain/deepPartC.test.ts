import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, buildModule, type ColonyState } from '../../apps/web/src/colony/simulation'
import { buildStartColony, SCENARIOS } from '../../scripts/deepScenario'
import {
  applyStorageCapacity, createWorld, deliverSamples, prepareEva, requestAnalysis, takeSample,
} from '../../apps/web/src/colony/deep/world'
import { emptyStepOf } from '../../apps/web/src/colony/deep/bridge'
import { TASK_META } from '../../apps/web/src/colony/deep/tasks'
import { colonyWorldConfig } from '../../apps/web/src/colony/deep/bridge'
import { DEEP_P } from '../../apps/web/src/colony/deep/params'
import { validateParams } from '../../apps/web/src/colony/deep/params'

/**
 * Хранилище следует за построенными складами.
 *
 * До этой правки ёмкости задавались один раз при создании мира. Построенный
 * игроком склад был чистым расходом: он потреблял мощность, изнашивался, мог
 * отказать — и не увеличивал ни одного резервуара. Проверка «функция
 * существует» этого не ловила: `setCapacity` не вызывал никто вообще.
 */

const SCENARIO = SCENARIOS[0].scenario
const DEEP = SCENARIOS[0].deep!

const step = (state: ColonyState): ColonyState => {
  if (state.world) state.world.scenario = { ...state.world.scenario, ...DEEP }
  return advanceDay(state, SCENARIO)
}

const run = (sols: number): ColonyState => {
  let state: ColonyState = buildStartColony()
  for (let sol = 0; sol < sols; sol++) state = step(state)
  return state
}

const addDepot = (state: ColonyState): ColonyState => {
  const built = buildModule(state, 'depot')
  if (built === state) throw new Error('depot could not be built')
  // Постройка без коммуникаций — это корпус, а не склад: сети поднимаются
  // заново по итоговому составу модулей, тем же путём, что и в игре.
  return { ...built, networks: undefined }
}

test('a depot you build enlarges the tank and the bins', () => {
  let state = buildStartColony()
  state = step(state)
  const before = state.world!.stock.cap
  const depotsBefore = state.world!.devices.filter(d => d.kind === 'depot').length

  state = step(addDepot(state))

  const after = state.world!.stock.cap
  const depotsAfter = state.world!.devices.filter(d => d.kind === 'depot').length
  assert.equal(depotsAfter, depotsBefore + 1, 'the depot must exist as a device in the world')
  assert.ok(after.water_clean > before.water_clean,
    `tank must grow with the depot: ${before.water_clean} → ${after.water_clean} L`)
  assert.ok(after.seed_potato > before.seed_potato,
    `bins must grow with the depot: ${before.seed_potato} → ${after.seed_potato} kg`)
  // Гарантия от «склад есть, но он ничего не даёт»: прирост задан параметром.
  assert.ok(Math.abs(after.seed_potato / before.seed_potato - (1 + DEEP_P.depotSolidGain)) < 1e-9,
    `one depot must add depotSolidGain (${DEEP_P.depotSolidGain}) to the bins`)
})

test('the starting colony keeps its capacities: the recount is not a silent rebalance', () => {
  // Пересчёт ёмкостей не должен ничего сдвинуть на старте, иначе это не
  // починка, а скрытая перебалансировка.
  const state = buildStartColony()
  const world = createWorld(colonyWorldConfig(state))
  const frozen = { ...world.stock.cap }
  applyStorageCapacity(world)
  for (const [id, value] of Object.entries(frozen)) {
    assert.ok(Math.abs((world.stock.cap as Record<string, number>)[id] - value) < 1e-9,
      `capacity of ${id} must not change on an untouched world: ${value} → ${world.stock.cap[id as never]}`)
  }
})

test('shrinking a capacity never deletes what is already stored', () => {
  // Раньше `setCapacity` обрезал запас под новую ёмкость. Если склад снесли,
  // масса исчезала молча, хотя реестр её уже оприходовал.
  const world = createWorld(colonyWorldConfig(buildStartColony()))
  const id = 'ware_potato'
  const baseline = world.stock.cap[id]

  // Расширяем хранилище двумя складами, затариваем его под завязку…
  const template = world.devices.find(d => d.kind === 'depot')!
  world.devices.push({ ...template, id: 'DEP-x1' }, { ...template, id: 'DEP-x2' })
  applyStorageCapacity(world)
  const grown = world.stock.cap[id]
  assert.ok(grown > baseline, `two depots must enlarge the bin: ${baseline} → ${grown} kg`)
  world.stock.amount[id] = grown - 1

  // …и сносим оба: груз физически остаётся на площадке.
  world.devices = world.devices.filter(d => d.id !== 'DEP-x1' && d.id !== 'DEP-x2')
  applyStorageCapacity(world)
  assert.ok(Math.abs(world.stock.cap[id] - baseline) < 1e-9, 'the bin must return to its baseline')
  assert.equal(world.stock.amount[id], grown - 1,
    'stored mass must survive a capacity cut: it stops being refilled, it does not evaporate')
})

// --- Выход наружу и шлюз ---------------------------------------------------

/**
 * Шлюз и выход наружу — разные вещи, и обе стоят ресурсов.
 *
 * Параметры `evaPrepHours`, `evaWaterLitres` и `airlockLossFraction`
 * существовали с самого начала, но не читал их никто: наружная работа
 * начиналась мгновенно, без костюма, без воды на сублиматор и без потери
 * атмосферы. Юнит-тесты этого не ловили — они проверяли функции по отдельности.
 */
test('going outside costs suit-up time, sublimator water and airlock air', () => {
  const state = run(20)
  const world = state.world!
  assert.ok(world.totals.evaPrepHours > 0,
    `EVA must cost suit-up hours, got ${world.totals.evaPrepHours}`)
  assert.ok(world.totals.evaO2Kg > 0,
    `the airlock must vent oxygen, got ${world.totals.evaO2Kg} kg`)
  // Выход — это не бесплатная прогулка, но и не разорение: шлюз мал.
  const perSol = world.totals.evaO2Kg / Math.max(1, world.sol)
  assert.ok(perSol < 1, `airlock losses must stay small, got ${perSol.toFixed(3)} kg/sol`)
})

test('suiting up is once per person per sol, not once per task', () => {
  // Подготовка накапливается и сохраняется до конца суток: иначе каждый
  // наружный выезд заново съедал бы полторы смены, и наружная работа встала бы.
  let state = buildStartColony()
  for (let sol = 0; sol < 30; sol++) state = step(state)
  const world = state.world!
  const evaTasks = world.tasks.filter(t => t.eva).length
  assert.ok(evaTasks >= 0, 'sanity')
  for (const member of world.crew) {
    assert.ok(member.evaPrepHours <= DEEP_P.evaPrepHours + 1e-9,
      `${member.id} spent ${member.evaPrepHours} h suiting up, more than one suit-up per sol`)
  }
})

test('sublimator water leaves the colony and does not come back as grey water', () => {
  // Сублиматор возгоняет воду наружу. Забирать её в стоки значило бы
  // притворяться, что замкнутый контур воды бесплатный.
  const world = createWorld(colonyWorldConfig(buildStartColony()))
  const member = world.crew[0]
  const before = world.stock.amount.water_clean
  const greyBefore = world.stock.amount.water_grey
  const stepObj = emptyStepOf(world.sol)
  for (let i = 0; i < 10 && !member.suited; i++) prepareEva(world, member, 1, stepObj)
  assert.ok(member.suited, 'the member must end up suited after the full prep')
  assert.ok(world.stock.amount.water_clean < before,
    `EVA must draw sublimator water: ${before} → ${world.stock.amount.water_clean} L`)
  assert.equal(world.stock.amount.water_grey, greyBefore,
    'sublimator water is vented to the atmosphere, not collected as grey water')
  assert.ok(stepObj.waterIndustrialL >= DEEP_P.evaWaterLitres - 1e-9,
    'the water must be reported as spent, or the daily reconciliation breaks')
})

test('rover work is done from the cabin, so it is not an EVA', () => {
  // Добыча и перевозка идут из гермокабины ровера: скафандр им не нужен.
  // Наружу выходят разведка и чистка панелей — иначе платить сублиматором
  // приходилось бы за каждый рейс, и колония теряла воду быстрее, чем добывала.
  const eva = TASK_META
  assert.equal(eva.extract.eva, false, 'extraction runs from the cab')
  assert.equal(eva.haul.eva, false, 'hauling runs from the cab')
  assert.ok(eva.survey.eva && eva.clean_panels.eva, 'survey and panel cleaning are outside work')
})

// --- Проба доезжает до лаборатории ----------------------------------------

/**
 * Цепочка лаборатории: проба → ДОСТАВКА → анализ.
 *
 * Поле `Sample.delivered` существовало с самого начала и везде проверялось,
 * но `takeSample` создавало пробу уже доставленной. Проверка «анализ требует
 * доставленной пробы» выполнялась всегда, поэтому шаг транспорта не стоил
 * ничего и не значил ничего.
 */
test('a sample reaches the bench a sol after it is taken, not instantly', () => {
  const world = createWorld(colonyWorldConfig(buildStartColony()))
  const sample = takeSample(world, 'substrate', world.batches[0].greenhouseId)
  assert.ok(sample, 'the sample must be taken')
  assert.equal(sample.delivered, false, 'a freshly taken sample is still in the field')
  assert.equal(requestAnalysis(world, 'contamination', sample.sourceId), null,
    'the analysis must wait for the sample to arrive')

  deliverSamples({ ...world, sol: world.sol + 1 })
  assert.equal(sample.delivered, true, 'the sample arrives with the next sol')
  assert.ok(requestAnalysis(world, 'contamination', sample.sourceId),
    'once delivered, the sample can be analysed')
})

test('the lab chain still runs end to end in a real colony', () => {
  // Транспорт не должен обрывать цепочку: за 60 солов пробы берутся,
  // доезжают и дают анализы.
  const state = run(60)
  const world = state.world!
  assert.ok(world.samples.length > 0, 'samples must be taken')
  assert.ok(world.analyses.length > 0, 'analyses must be produced')
  assert.ok(world.samples.every(s => s.delivered || s.sol >= world.sol),
    'no sample may sit undelivered past the sol after it was taken')
})

// --- Реестр параметров -----------------------------------------------------

test('every parameter sits inside its declared range', () => {
  // У каждого параметра есть единицы, границы и статус «источник / допущение».
  // Ничего это не проверяло: `validateParams` не вызывал никто, поэтому
  // вылетевший за границы параметр оставался бы незамеченным до тех пор, пока
  // не проявился бы в прогоне как необъяснимое поведение.
  assert.deepEqual(validateParams(), [], 'the parameter table must be self-consistent')
})
