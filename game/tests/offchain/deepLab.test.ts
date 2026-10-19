import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, initialColony, type ColonyState } from '../../apps/web/src/colony/simulation'
import {
  applyRecipe, deliverSamples, requestAnalysis, saveRecipe, startExperiment, takeSample,
} from '../../apps/web/src/colony/deep/world'
import { DEFAULT_REGIME, finishExperiment, type Regime } from '../../apps/web/src/colony/deep/lab'
import type { ColonyWorld } from '../../apps/web/src/colony/deep/world'

/**
 * Лаборатория: пробы, анализы, A/B-опыты, режимы. Главное требование здесь —
 * изменение режима не должно пересчитывать уже выращенный урожай. Остальное
 * проверяет, что опыт стоит настоящих ресурсов, а не объявляет результат.
 */

const SCENARIO = { sunHours: 18, waterRecovery: 0.94 } as const


/**
 * Мир клонируется на каждом шаге: `state.world` после `advanceDay` — это новый
 * объект. Поэтому эксперимент нельзя держать ссылкой, его нужно искать по id
 * в актуальном мире, иначе проверяется замороженная копия.
 */
function runExperiment(
  name: string, sols: number, a: Regime, b: Regime, warmup = 3, limit = 60,
): { state: ColonyState; experiment: ReturnType<typeof startExperiment> } {
  let state = initialColony()
  for (let sol = 0; sol < warmup; sol++) state = advanceDay(state, SCENARIO)
  const id = startExperiment(state.world!, name, sols, a, b).id
  const find = () => state.world!.experiments.find(e => e.id === id)!
  for (let sol = 0; sol < limit && find().status !== 'done'; sol++) state = advanceDay(state, SCENARIO)
  return { state, experiment: find() }
}

const stepped = (sols: number): { state: ColonyState; world: ColonyWorld } => {
  let state = initialColony()
  for (let sol = 0; sol < sols; sol++) state = advanceDay(state, SCENARIO)
  return { state, world: state.world! }
}

test('a sample costs water and an analysis costs reagents', () => {
  const { world } = stepped(3)
  const greenhouse = world.batches[0].greenhouseId
  const waterBefore = world.stock.amount.water_clean
  const reagentsBefore = world.stock.amount.reagents

  const sample = takeSample(world, 'substrate', greenhouse)
  assert.ok(sample, 'the sample must be taken')
  assert.ok(world.stock.amount.water_clean < waterBefore, 'sampling must cost water')

  // Проба берётся там, где среда, а измеряется в лаборатории: доставленная
  // проба — отдельный шаг цепочки, а не то же самое, что отбор.
  assert.equal(requestAnalysis(world, 'contamination', greenhouse), null,
    'a sample that is still in the field cannot be analysed')
  deliverSamples({ ...world, sol: world.sol + 1 })

  // Без пробы анализ невозможен: сначала физический образец, потом измерение.
  const analysis = requestAnalysis(world, 'contamination', greenhouse)
  assert.ok(analysis, 'the analysis must be accepted once the sample is on the bench')
  assert.ok(world.stock.amount.reagents < reagentsBefore, 'the analysis must consume reagents')
})

test('an analysis cannot be requested without a sample of that target', () => {
  const { world } = stepped(3)
  const before = world.stock.amount.reagents
  const denied = requestAnalysis(world, 'salt_index', 'greenhouse-that-does-not-exist')
  assert.equal(denied, null, 'an unsampled target must be refused')
  assert.equal(world.stock.amount.reagents, before, 'a refused analysis must not charge reagents')
})

test('an A/B experiment reports yield, quality, water, energy and labour for both arms', () => {
  const warm: Regime = { ...DEFAULT_REGIME, targetC: 23 }
  const { experiment } = runExperiment('baseline vs warm', 5, DEFAULT_REGIME, warm)
  assert.equal(experiment.status, 'done', 'the experiment must finish inside the limit')

  const result = finishExperiment(experiment)
  assert.ok(['a', 'b', 'tie'].includes(result.winner), `unexpected winner ${result.winner}`)
  for (const arm of [result.a, result.b]) {
    assert.ok(Number.isFinite(arm.yieldKg) && arm.yieldKg >= 0, `yield is ${arm.yieldKg}`)
    assert.ok(Number.isFinite(arm.waterL) && arm.waterL >= 0, `water is ${arm.waterL}`)
    assert.ok(Number.isFinite(arm.energyKwh) && arm.energyKwh >= 0, `energy is ${arm.energyKwh}`)
    assert.ok(Number.isFinite(arm.labourHours) && arm.labourHours >= 0, `labour is ${arm.labourHours}`)
    assert.ok(arm.quality >= 0 && arm.quality <= 1, `quality is ${arm.quality}`)
  }
})

test('a finished experiment saves a recipe with its evidence attached', () => {
  const { state, experiment } = runExperiment('feed trial', 5, DEFAULT_REGIME,
    { ...DEFAULT_REGIME, feedRate: 1.35 })
  assert.equal(experiment.status, 'done')

  const recipe = saveRecipe(state.world!, experiment.id)
  assert.ok(recipe, 'a finished experiment must produce a recipe')
  assert.equal(recipe.sourceExperimentId, experiment.id)
  assert.ok(recipe.evidence, 'the recipe must carry the measured evidence')
  assert.ok(recipe.evidence!.yieldKg >= 0, 'the evidence yield must be a real number')
  assert.equal(
    state.world!.experiments.find(e => e.id === experiment.id)!.savedRecipeId, recipe.id,
    'the experiment must remember its recipe')
})

test('an unfinished experiment cannot be saved as a recipe', () => {
  const { world } = stepped(3)
  const running = startExperiment(world, 'too early', 30, DEFAULT_REGIME, { ...DEFAULT_REGIME, targetC: 24 })
  assert.equal(running.status, 'running')
  assert.equal(saveRecipe(world, running.id), null, 'a running experiment has no winner yet')
})

test('applying a recipe changes the regime but never the grown yield', () => {
  const { state: done, experiment } = runExperiment('regime check', 5, DEFAULT_REGIME,
    { ...DEFAULT_REGIME, targetC: 26 }, 40)
  const world = done.world!
  const greenhouse = world.batches[0].greenhouseId
  const beds = world.batches.filter(b => b.greenhouseId === greenhouse)
  assert.ok(beds.length > 0, 'the greenhouse must have beds')

  // Снимок делается в том же мире и непосредственно перед применением:
  // `applyRecipe` сам мир не шагает, поэтому сравнение корректно.
  const before = beds.map(b => ({ development: b.development, penalty: b.yieldPenalty, expected: b.expectedKg }))
  const recipe = saveRecipe(world, experiment.id)!
  const applied = applyRecipe(world, recipe.id, greenhouse)

  assert.equal(applied, beds.length, 'the recipe must reach every bed of that greenhouse')
  const after = world.batches.filter(b => b.greenhouseId === greenhouse)
  assert.ok(after.every(b => b.recipeId === recipe.id), 'the beds must record the applied regime')

  // Главное: режим меняет будущее, а не прошлое.
  after.forEach((batch, index) => {
    assert.equal(batch.yieldPenalty, before[index].penalty,
      `${batch.id}: applying a recipe rewrote the irreversible yield loss`)
    assert.equal(batch.expectedKg, before[index].expected,
      `${batch.id}: applying a recipe rewrote the expected yield`)
    assert.ok(batch.development >= before[index].development - 1e-9,
      `${batch.id}: applying a recipe turned back the development`)
  })
})

test('a recipe only reaches the greenhouse it was applied to', () => {
  let state = { ...initialColony(), credits: 100_000, sparesKg: 100 }
  for (let sol = 0; sol < 30; sol++) state = advanceDay(state, SCENARIO)
  const houses = [...new Set(state.world!.batches.map(b => b.greenhouseId))]
  if (houses.length < 2) return // стартовая колония может иметь одну теплицу

  const { state: done, experiment } = runExperiment('selective', 5, DEFAULT_REGIME,
    { ...DEFAULT_REGIME, targetC: 25 }, 30)
  const world = done.world!
  const recipe = saveRecipe(world, experiment.id)!
  applyRecipe(world, recipe.id, houses[0])

  for (const batch of world.batches) {
    if (batch.greenhouseId === houses[0]) assert.equal(batch.recipeId, recipe.id)
    else assert.notEqual(batch.recipeId, recipe.id, `the recipe leaked into ${batch.greenhouseId}`)
  }
})
