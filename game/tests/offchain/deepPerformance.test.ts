import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceDay, buildModule, initialColony, type ColonyState, type ModuleKind,
} from '../../apps/web/src/colony/simulation'
import { COLONY_MODULE_LIMIT } from '../../apps/web/src/colony/layout'

/**
 * Перф-ограничение на большую колонию. Абсолютные миллисекунды зависят от
 * машины, поэтому основной критерий — **отношение**: стоимость сола не должна
 * взрываться относительно маленькой базы. Абсолютные потолки стоят щедрыми и
 * ловят только настоящую деградацию (перебор по всем парам, пересчёт всего
 * на каждом шаге), а не шум таймера.
 *
 * `COLONY_MODULE_LIMIT` — это предел сетки (256), а не «большая база»
 * (реалистично 16–32 модуля). Две величины проверяются порознь.
 */

const SCENARIO = { sunHours: 18, waterRecovery: 0.94 } as const

/** Набирает колонию до `target` модулей, подсыпая кредиты и запчасти. */
function grow(target: number): ColonyState {
  let state = initialColony()
  const kinds: ModuleKind[] = ['greenhouse', 'solar', 'battery', 'recycler', 'workshop', 'rover', 'habitat']
  let index = 0
  while (state.modules.length < target) {
    state = { ...state, credits: 100_000, sparesKg: 500 }
    const built = buildModule(state, kinds[index % kinds.length])
    index++
    if (built === state) break
    state = built
  }
  return state
}

function timePerSol(state: ColonyState, sols: number): { ms: number; state: ColonyState } {
  const started = performance.now()
  let current = state
  for (let sol = 0; sol < sols; sol++) current = advanceDay(current, SCENARIO)
  const ms = (performance.now() - started) / sols
  assert.ok(current.world, 'the deep world must exist')
  return { ms, state: current }
}

test('a realistically large base costs only a few times a small one', () => {
  const small = timePerSol(grow(8), 30).ms
  const large = timePerSol(grow(24), 30).ms

  assert.ok(small > 0 && large > 0, 'timing produced zero, the measurement is broken')
  // 24 модуля против 8 — рост втрое по размеру. Втрое дороже — нормально;
  // восьмикратно — уже признак перебора.
  const ratio = large / small
  assert.ok(ratio < 8,
    `24 modules cost ${ratio.toFixed(1)}× an 8-module sol (${large.toFixed(1)} vs ${small.toFixed(1)} ms/sol)`)
  assert.ok(large < 200, `${large.toFixed(1)} ms per sol on a 24-module base is too slow`)
})

test('the absolute grid limit still steps in bounded time', () => {
  // Предел сетки — 256 модулей и более двухсот грядок. Это не «рабочая база»,
  // а потолок: сол обязан считаться, пусть и не быстро.
  const capped = timePerSol(grow(COLONY_MODULE_LIMIT), 10)
  assert.equal(capped.state.modules.length, COLONY_MODULE_LIMIT,
    'the fixture did not reach the grid limit, so the ceiling proves nothing')
  assert.ok(capped.ms < 1500,
    `${capped.ms.toFixed(1)} ms per sol at the ${COLONY_MODULE_LIMIT}-module limit is a blow-up`)
})

test('the module limit is what the layout says it is', () => {
  const state = grow(COLONY_MODULE_LIMIT + 6)
  assert.ok(state.modules.length <= COLONY_MODULE_LIMIT,
    `built ${state.modules.length} modules past the ${COLONY_MODULE_LIMIT} limit`)
})
