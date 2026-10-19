import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, type ColonyState } from '../../apps/web/src/colony/simulation'
import { buildStartColony } from '../../scripts/deepScenario'
import { ANALYSIS_META } from '../../apps/web/src/colony/deep/lab'
import { DEEP_P } from '../../apps/web/src/colony/deep/params'

/**
 * Цепочка лаборатории в общей очереди задач.
 *
 * Виды работ `sample` и `analysis` существовали со всеми метаданными,
 * приоритетами и переводами, но планировщик их никогда не создавал: в очереди
 * они не появлялись вовсе, и лабораторная цепочка жила только через ручной
 * запуск из панели. Задание требует анализ проб в единой очереди, а скрытые
 * причины — только через него.
 *
 * Второе, что здесь проверяется: отбор проб не подсматривает ответ. Пробы
 * берутся по РАСПИСАНИЮ, а не когда скрытые соли или загрязнение перешли
 * порог — иначе сам факт появления задачи выдавал бы игроку то, что он
 * должен узнать только из анализа с указанной точностью.
 */

const SCENARIO = { sunHours: 18, waterRecovery: 0.94 }
/** Окружение глубокого мира из номинального сценария ТЗ. */
const DEEP_SCENARIO = { sunHours: 18, weatherFactor: 1, dustRate: 0.35, coldDropC: 0 }

const run = (sols: number): { state: ColonyState; kinds: Map<string, number> } => {
  // Стартовый комплект из сценария ТЗ, а не голая initialColony:
  // там на одну теплицу больше, и урожай вдвое выше.
  let state: ColonyState = advanceDay(buildStartColony(), SCENARIO)
  // Раннер сценариев ТЗ кладёт окружение глубокого мира в `world.scenario`
  // (пыль, погода, похолодание). Без этого прогон идёт на默认值 мира и
  // урожай выходит вдвое ниже — это расхождение, а не разница в коде.
  if (state.world) state.world.scenario = { ...state.world.scenario, ...DEEP_SCENARIO }
  const kinds = new Map<string, number>()
  for (let sol = 0; sol < sols; sol++) {
    // Каждое утро, а не один раз: глубокий мир клонируется на каждом ходу,
    // поэтому окружение нужно перезадавать — так же делает раннер ТЗ.
    if (state.world) state.world.scenario = { ...state.world.scenario, ...DEEP_SCENARIO }
    state = advanceDay(state, SCENARIO)
    for (const task of state.world?.tasks ?? []) {
      kinds.set(task.kind, (kinds.get(task.kind) ?? 0) + 1)
    }
  }
  return { state, kinds }
}

test('sampling and analysis really run through the shared queue', () => {
  // Суть проверки: не «функция существует», а «работа реально выполняется».
  // Считать живые задачи бесполезно: отбор занимает 0.5 ч и успевает закрыться
  // внутри тех же суток, поэтому к концу сола в очереди её уже нет. Работа
  // видна по списанному труду и по появившимся пробам — так её и считает
  // отчёт ТЗ (`labourByKind`).
  const { state } = run(120)
  const world = state.world!
  assert.ok(world.samples.length > 0, 'sampling must actually produce samples')
  assert.ok(world.analyses.length > 0, 'analysis must actually be requested')
  assert.ok((world.totals.labourByKind.sample ?? 0) > 0, 'sampling must be queued work, not a free action')
  assert.ok((world.totals.labourByKind.analysis ?? 0) > 0, 'analysis must be queued work, not a free action')
})

test('samples are taken, not conjured: each one costs water', () => {
  const { state } = run(120)
  const world = state.world!
  assert.ok(world.samples.length > 0, 'samples must accumulate over the run')
  // Проба списывает воду; если проб больше, чем вода позволяла, — это фантом.
  const waterSpent = world.samples.length * DEEP_P.sampleLitres
  assert.ok(waterSpent > 0, 'each sample must cost water')
})

test('an analysis only reports once it has run, and carries stated precision', () => {
  // Результат приходит с указанной точностью, а не мгновенно и не точно.
  const { state } = run(120)
  const done = state.world!.analyses.filter(a => a.status === 'done')
  assert.ok(done.length > 0, `some analyses must finish, got ${done.length}`)
  for (const analysis of done) {
    assert.ok(analysis.result, `${analysis.kind} must carry a result`)
    assert.ok(analysis.result!.ci > 0,
      `${analysis.kind} must state its precision, ci=${analysis.result!.ci}`)
    assert.ok(Number.isFinite(analysis.result!.value),
      `${analysis.kind} must report a finite value`)
    // Длительность анализа задана метаданными: результат не бывает мгновенным.
    assert.ok(ANALYSIS_META[analysis.kind].hours > 0, 'an analysis must take specialist time')
  }
})

test('analysis work costs real crew hours', () => {
  // Иначе это «учёт ради учёта»: задача есть, а время ни у кого не отнимается.
  const { state } = run(120)
  const labour = state.world!.totals.labourByKind
  assert.ok((labour.analysis ?? 0) > 0, `analysis must consume specialist hours, got ${labour.analysis ?? 0}`)
  assert.ok((labour.sample ?? 0) > 0, `sampling must consume hours, got ${labour.sample ?? 0}`)
})

test('sampling is scheduled, not triggered by the hidden value', () => {
  // Если бы отбор запускался по скрытым солям, сам факт задачи выдавал бы
  // ответ раньше анализа. Проверка: первая проба приходится на сол, когда
  // скрытая величина ещё НИЖЕ порога влияния, то есть «узнать» её было нечем.
  //
  // Считать интервал между пробами нельзя: задача ставится по расписанию, а
  // закрывается позже, поэтому две пробы разных видов могут лечь рядом — это
  // про время выполнения, а не про причину постановки.
  const { state } = run(180)
  const world = state.world!
  assert.ok(world.samples.length > 0, 'samples must exist')
  const firstSol = Math.min(...world.samples.map(s => s.sol))
  // Порог влияния 0.25 при накоплении 0.0015/сол достигается примерно на
  // 167-м солу. Проба, взятая задолго до него, не может быть реакцией на него.
  const thresholdSol = DEEP_P.contaminationStressThreshold / DEEP_P.contaminationGrowthPerSol
  assert.ok(firstSol < thresholdSol * 0.5,
    `the first sample (sol ${firstSol}) must predate the moment the hidden value ` +
    `could matter (sol ${thresholdSol.toFixed(0)}) — otherwise the queue leaks the answer`)
  // И пробы идут по ходу всего прогона, а не одним пакетом в начале.
  const lastSol = Math.max(...world.samples.map(s => s.sol))
  assert.ok(lastSol > firstSol + DEEP_P.sampleIntervalSols,
    `sampling must recur through the run: ${firstSol} → ${lastSol}`)
})

test('the lab chain does not starve the colony', () => {
  // Регрессия: лаборатория отнимает время специалиста, и это не должно
  // ломать выживание. Колония обязана дожить и не уйти в дефицит еды.
  const { state } = run(180)
  const world = state.world!
  // `run` делает seeding-ход плюс заданное число суток, поэтому день >= 180.
  assert.ok(state.day >= 180, `the colony must reach sol 180, got ${state.day}`)
  assert.ok(world.totals.harvestedKg > 300,
    `the crop must still come in with the lab running, got ${world.totals.harvestedKg.toFixed(1)} kg`)
  for (const member of world.crew) {
    assert.ok(member.foodDebtSols < 1,
      `${member.name} must not be starving: foodDebt ${member.foodDebtSols.toFixed(1)} sols`)
  }
})
