import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceDay, buySupplies, DEFAULT_SCENARIO, initialColony,
} from '../../apps/web/src/colony/simulation'
import { syncWorldFromState } from '../../apps/web/src/colony/deep/bridge'
import { splitNutrients } from '../../apps/web/src/colony/deep/world'
import type { ColonyWorld } from '../../apps/web/src/colony/deep/world'

/**
 * Удобрения — единственный склад, который колония пополняет покупкой, а не
 * производством (компост возвращает лишь малую часть). Поэтому закупка обязана
 * доходить до глубокого мира. Исторически она этого не делала: запас задавался
 * только при создании мира, и любой `buySupplies` после появления мира жил лишь
 * в `state`, а первый же `syncStateFromWorld` записывал обратно свой меньший
 * запас — купленные килограммы исчезали без следа.
 */

const nutrientTotal = (world: ColonyWorld): number =>
  world.stock.amount.nutrient_n + world.stock.amount.nutrient_p + world.stock.amount.nutrient_k

/** Глубокая симуляция поднимается на первом же ходу `advanceDay`. */
const worldAfterOneDay = (): { state: ReturnType<typeof advanceDay>, world: ColonyWorld } => {
  const state = advanceDay(initialColony(), DEFAULT_SCENARIO)
  const world = state.world
  assert.ok(world, 'deep world must be created by advanceDay')
  return { state, world }
}

test('the world carries the colony\'s fertiliser at creation', () => {
  const { state, world } = worldAfterOneDay()
  assert.ok(Math.abs(nutrientTotal(world) - state.nutrientsKg) < 1e-6,
    `world holds ${nutrientTotal(world)} kg, state says ${state.nutrientsKg} kg`)
})

test('a purchase made after the world exists survives the next day', () => {
  const { state } = worldAfterOneDay()
  const before = state.nutrientsKg
  const bought = buySupplies(state)
  const added = bought.nutrientsKg - before
  assert.ok(added > 0, 'buySupplies must add fertiliser')

  const next = advanceDay(bought, DEFAULT_SCENARIO)
  // One sol of bed draw (~0.02 kg) cannot swallow a 1 kg purchase. If the sync
  // drops the purchase, the stock lands back below where it started.
  assert.ok(next.nutrientsKg > before,
    `bought ${added} kg but after one sol the stock is ${next.nutrientsKg} kg, down from ${before} kg`)
})

test('syncWorldFromState pushes a purchase into the world', () => {
  const { state, world } = worldAfterOneDay()
  const bought = buySupplies(state)
  assert.ok(bought.nutrientsKg > state.nutrientsKg)

  syncWorldFromState(world, bought)
  assert.ok(Math.abs(nutrientTotal(world) - bought.nutrientsKg) < 1e-9,
    `world holds ${nutrientTotal(world)} kg, state says ${bought.nutrientsKg} kg`)
})

test('the N/P/K mix keeps its declared proportions through the sync', () => {
  const { state, world } = worldAfterOneDay()
  const bought = buySupplies(state)
  syncWorldFromState(world, bought)

  for (const [id, kg] of splitNutrients(bought.nutrientsKg)) {
    assert.ok(Math.abs(world.stock.amount[id] - kg) < 1e-9,
      `${id}: world has ${world.stock.amount[id]} kg, the mix says ${kg} kg`)
  }
  const total = splitNutrients(1).reduce((sum, [, kg]) => sum + kg, 0)
  assert.ok(Math.abs(total - 1) < 1e-12, `the mix must sum to 1, got ${total}`)
})

test('no nutrient stock is ever negative', () => {
  let state = initialColony()
  for (let sol = 0; sol < 40; sol++) {
    state = buySupplies(advanceDay(state, DEFAULT_SCENARIO))
    const world = state.world!
    for (const id of ['nutrient_n', 'nutrient_p', 'nutrient_k'] as const) {
      assert.ok(world.stock.amount[id] >= 0, `${id} went negative: ${world.stock.amount[id]}`)
    }
    assert.ok(state.nutrientsKg >= 0, `state nutrients went negative: ${state.nutrientsKg}`)
  }
})
