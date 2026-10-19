import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATALOG, MODULE_KINDS, type ModuleKind } from '../../apps/web/src/colony/simulation'
import { FOOTPRINTS } from '../../apps/web/src/colony/layout'
import { moduleCopy } from '../../apps/web/src/colony/copy'
import { DEVICE_FOR_MODULE } from '../../apps/web/src/colony/deep/bridge'
import { colonyWorldConfig, createWorldForColony } from '../../apps/web/src/colony/deep/bridge'
import { buildStartColony } from '../../scripts/deepScenario'
import type { ColonyState } from '../../apps/web/src/colony/simulation'

/**
 * Размещаемые модули добычи, склада, очистки и лаборатории.
 *
 * Раньше эти четыре узла подразумевались сами собой: игрок не мог их
 * поставить, нарастить или потерять, и «вторая добыча» была невозможна в
 * принципе. Проверка не в том, что вид появился в каталоге, а в том, что
 * поставленный модуль реально меняет мощность глубокого мира.
 */

const NEW_KINDS: ModuleKind[] = ['extractor', 'depot', 'purifier', 'lab']

const countOf = (state: ColonyState, kind: ModuleKind): number =>
  state.modules.filter(m => m.kind === kind).length

test('the four former "implied" nodes are real placeable kinds', () => {
  for (const kind of NEW_KINDS) {
    assert.ok(MODULE_KINDS.includes(kind), `${kind} must be placeable`)
    assert.ok(CATALOG[kind].credits > 0, `${kind} must cost credits`)
    const [w, d] = FOOTPRINTS[kind]
    assert.ok(w > 0 && d > 0, `${kind} must have a footprint`)
    // Значок в палитре и описание на двух языках — иначе модуль есть, но
    // игрок не узнает, что именно он ставит.
    const en = moduleCopy('en')[kind]
    const ru = moduleCopy('ru')[kind]
    assert.ok(en.name && en.description, `${kind} has no English copy`)
    assert.ok(ru.name && ru.description, `${kind} has no Russian copy`)
  }
})

test('each new module maps to the device it is supposed to provide', () => {
  const expected: Record<string, string> = {
    extractor: 'extractor', depot: 'depot', purifier: 'purifier', lab: 'lab',
  }
  for (const [kind, device] of Object.entries(expected)) {
    assert.deepEqual(DEVICE_FOR_MODULE[kind as ModuleKind], [device],
      `${kind} must create a ${device}`)
  }
})

test('placing an extractor really adds extraction capacity', () => {
  // Суть проверки: не «модуль поставился», а «добывать стало больше».
  const base = buildStartColony()
  const before = colonyWorldConfig(base)
  assert.equal(before.extractors, 1, 'an unmodified colony keeps its one base extractor')

  const withOne: ColonyState = {
    ...base,
    modules: [...base.modules, { id: 'x-1', kind: 'extractor', x: 0, z: 0, rotation: 0, condition: 100 } as never],
  }
  const after = colonyWorldConfig(withOne)
  assert.equal(after.extractors, 2, 'a placed extractor must add one, not just an icon')

  const withTwo: ColonyState = {
    ...withOne,
    modules: [...withOne.modules, { id: 'x-2', kind: 'extractor', x: 4, z: 0, rotation: 0, condition: 100 } as never],
  }
  assert.equal(colonyWorldConfig(withTwo).extractors, 3, 'a second one must add another')
})

test('the world really builds the extra devices, not just counts them', () => {
  const base = buildStartColony()
  const before = createWorldForColony(base).devices.filter(d => d.kind === 'extractor').length

  const withOne: ColonyState = {
    ...base,
    modules: [...base.modules, { id: 'x-1', kind: 'extractor', x: 0, z: 0, rotation: 0, condition: 100 } as never],
  }
  const after = createWorldForColony(withOne).devices.filter(d => d.kind === 'extractor').length
  assert.equal(after, before + 1,
    `placing an extractor must build another one: ${before} → ${after}`)
})

test('a depot adds storage capacity, and storage alone produces nothing', () => {
  const base = buildStartColony()
  const before = createWorldForColony(base)
  const withDepot: ColonyState = {
    ...base,
    modules: [...base.modules, { id: 'd-1', kind: 'depot', x: 8, z: 0, rotation: 0, condition: 100 } as never],
  }
  const after = createWorldForColony(withDepot)
  // Ёмкость выросла...
  assert.ok(after.stock.cap.water_clean > before.stock.cap.water_clean,
    'a depot must enlarge the tanks, not just occupy a slot')
  // ...а содержимое — нет: хранение ничего не производит.
  for (const id of ['water_clean', 'nutrient_n', 'nutrient_p', 'nutrient_k'] as const) {
    assert.ok(Math.abs(after.stock.amount[id] - before.stock.amount[id]) < 1e-9,
      `a depot must not conjure ${id}`)
  }
})

test('a placed lab adds lab capacity, and a placed purifier adds purification', () => {
  const base = buildStartColony()
  const before = createWorldForColony(base)
  const built: ColonyState = {
    ...base,
    modules: [
      ...base.modules,
      { id: 'l-1', kind: 'lab', x: 0, z: 8, rotation: 0, condition: 100 } as never,
      { id: 'p-1', kind: 'purifier', x: 8, z: 8, rotation: 0, condition: 100 } as never,
    ],
  }
  const after = createWorldForColony(built)
  const count = (w: ReturnType<typeof createWorldForColony>, kind: string) =>
    w.devices.filter(d => d.kind === kind).length
  assert.ok(count(after, 'lab') > count(before, 'lab'), 'a placed lab must build one')
  assert.ok(count(after, 'purifier') > count(before, 'purifier'), 'a placed purifier must build one')
})

test('an existing colony is unchanged: the base node is still there', () => {
  // Новая возможность не должна ломать старые колонии: базовый узел каждого
  // вида остаётся, поэтому без поставленных модулей всё считается как раньше.
  const base = buildStartColony()
  assert.equal(countOf(base, 'extractor'), 0, 'the starter kit places no extractor yet')
  const config = colonyWorldConfig(base)
  for (const [key, value] of [['labs', config.labs], ['purifiers', config.purifiers],
    ['extractors', config.extractors], ['depots', config.depots]] as const) {
    assert.equal(value, 1, `${key} must still be the single base node`)
  }
})
