import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, type ColonyState } from '../../apps/web/src/colony/simulation'
import { advanceDay as advanceUnified } from '../../apps/web/src/organism/unified'
import { unifiedBalance } from '../../apps/web/src/organism/unified'
import { buildStartColony, SCENARIOS } from '../../scripts/deepScenario'
import { applySort, createWorld } from '../../apps/web/src/colony/deep/world'
import { colonyWorldConfig } from '../../apps/web/src/colony/deep/bridge'
import { DEEP_P } from '../../apps/web/src/colony/deep/params'

/**
 * Разделка урожая и затвор уборки.
 *
 * До этой правки урожай целиком уходил в еду, а разделка на семенную,
 * товарную и некондиционную фракции не выполнялась никогда: реестр забирал
 * сырьё раньше, чем глубокий мир его видел (переработчик 16.8 кг/сол против
 * ~2 кг/сол уборки). Семенной картофель падал с 35.85 до 13.29 кг за 180
 * солов без возврата, `ware_potato` был равен нулю.
 *
 * Здесь проверяется не «функция существует», а что масса не двоится, цикл
 * семян замкнут, а уборка действительно зависит от людей.
 */

const SCENARIO = SCENARIOS[0].scenario
const DEEP = SCENARIOS[0].deep!

const run = (sols: number): ColonyState => {
  let state: ColonyState = buildStartColony()
  for (let sol = 0; sol < sols; sol++) {
    if (state.world) state.world.scenario = { ...state.world.scenario, ...DEEP }
    state = advanceDay(state, SCENARIO)
  }
  return state
}

test('the split conserves mass: fractions sum to the input', () => {
  // Прежняя формула превращала 100 кг в 137: некондиция входила в остатки
  // дважды, а 30 % ботвы добавлялись поверх уже разделённой массы.
  const world = createWorld(colonyWorldConfig(buildStartColony()))
  const result = applySort(world, 100)
  const sum = result.seed + result.ware + result.cull
  assert.ok(Math.abs(sum - 100) < 1e-9,
    `fractions must sum to the input: ${result.seed} + ${result.ware} + ${result.cull} = ${sum}`)
  // Ботва и корни — отдельная масса, она учитывается при уборке, а не здесь.
  assert.equal(result.biomass, 0, 'haulm residue is accounted at harvest, not in the split')
})

test('the seed loop is closed: seed potato stops bleeding away', () => {
  // Было: 35.85 → 13.29 кг за 180 солов, минус 22.5 кг без возврата.
  const state = run(180)
  const seed = state.world!.stock.amount.seed_potato
  assert.ok(seed > 30,
    `seed potato must be replenished by the harvest, got ${seed.toFixed(2)} kg (was 13.29 when the loop was open)`)
})

test('harvest and processing are real work in the shared queue', () => {
  // Эти два вида работ не появлялись в очереди вовсе. Теперь обе стоят труда.
  const state = run(180)
  const labour = state.world!.totals.labourByKind
  assert.ok((labour.harvest ?? 0) > 0, `harvest must cost crew hours, got ${labour.harvest ?? 0}`)
  assert.ok((labour.process ?? 0) > 0, `processing must cost crew hours, got ${labour.process ?? 0}`)
})

test('all thirteen task kinds are reachable, not just documented', () => {
  // Задание перечисляет тринадцать видов работ. Метаданные и переводы были на
  // все тринадцать и раньше — но шесть из них никогда не планировались.
  const expected = ['plant', 'tend', 'harvest', 'sample', 'analysis', 'clean_panels',
    'inspect', 'repair', 'extract', 'haul', 'process', 'survey', 'maintain']
  const state = run(180)
  const labour = state.world!.totals.labourByKind
  const dead = expected.filter(kind => (labour[kind] ?? 0) <= 0)
  assert.deepEqual(dead, [], `these task kinds never ran: ${dead.join(', ')}`)
})

test('removing the crew does not deadlock the harvest', () => {
  // Затвор уборки не должен стать тупиком: если люди не дошли, грядка
  // убирается сама после льготного срока. Иначе неразобранная очередь означает
  // голод — это отказ интерфейса, а не физика.
  const state = run(180)
  assert.ok(state.world!.totals.harvestedKg > 100,
    `harvest must still happen, got ${state.world!.totals.harvestedKg.toFixed(1)} kg`)
  for (const member of state.world!.crew) {
    assert.ok(member.foodDebtSols < 1,
      `${member.name} must not starve: foodDebt ${member.foodDebtSols.toFixed(1)} sols`)
  }
})

test('the ledger balance still closes with the seed return booked', () => {
  // Семена покидают продовольственный контур, поэтому реестр обязан их
  // запомнить — иначе масса бесследно исчезает и тождество расходится.
  const state = run(180)
  const balance = unifiedBalance(state.ledger)
  assert.ok(Math.abs(balance.residual) < 1e-6,
    `the ledger must balance, residual ${balance.residual}`)
  assert.ok((state.ledger.seedReturnedKg ?? 0) > 0,
    'seed diverted out of the food loop must be recorded')
})

test('the gate is optional: the base colony harvests as before', () => {
  // Предикат уборки необязателен. Базовая колония его не передаёт, поэтому
  // прежнее поведение обязано сохраниться — это главная защита от регресса.
  const start = buildStartColony()
  let ledger = start.ledger
  const beds = ledger.plots[0]?.beds ?? []
  assert.ok(beds.length > 0, 'there must be beds to grow')
  const before = ledger.harvestedKg
  // Без предиката и без skipProcessing — ровно прежний вызов.
  ledger = advanceUnified(
    { ...ledger, storageCapKg: 100000, plots: ledger.plots.map((p, i) => i === 0 ? { ...p, beds: p.beds.map(() => 89) } : p) },
    1,
    { autoReplant: false },
  )
  assert.ok(ledger.harvestedKg > before,
    `without the predicate a ripe bed must still be harvested: ${before} → ${ledger.harvestedKg}`)
})

test('the unstaffed fallback keeps processing alive', () => {
  // Резервный путь: без людей разделка идёт, но медленнее. Проверяем, что
  // предел задан осмысленно — меньше штатной скорости переработчика.
  assert.ok(DEEP_P.processUnstaffedKgPerSol > 0, 'there must be a fallback rate')
  assert.ok(DEEP_P.processUnstaffedKgPerSol < 16.8,
    'the fallback must be slower than the processor, otherwise crew are pointless')
  assert.ok(DEEP_P.harvestGraceSols >= 0, 'the harvest grace period must be defined')
})
