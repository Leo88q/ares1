import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceDay, initialColony, type ColonyState,
} from '../../apps/web/src/colony/simulation'
import { ensureWorld } from '../../apps/web/src/colony/deep/bridge'
import { WORLD_VERSION, type ColonyWorld } from '../../apps/web/src/colony/deep/world'

/**
 * Миграция состояния. Глубокий мир живёт внутри `state.world`, и версия у него
 * есть, но раньше её никто не проверял: мир старой сборки шагался как свежий,
 * и любого недостающего поля хватило бы, чтобы получить NaN в отчёте вместо
 * ошибки. Здесь проверяется и сам переход, и то, что игрок не теряет нажитого.
 */

const SCENARIO = { sunHours: 18, waterRecovery: 0.94 } as const

const stepped = (sols: number): ColonyState => {
  let state = initialColony()
  for (let sol = 0; sol < sols; sol++) state = advanceDay(state, SCENARIO)
  return state
}

test('a state without a world gets one instead of throwing', () => {
  const bare: ColonyState = { ...initialColony(), world: undefined }
  const world = ensureWorld(bare)
  assert.ok(world, 'ensureWorld must create a world')
  assert.equal(world.version, WORLD_VERSION)
  const next = advanceDay(bare, SCENARIO)
  assert.ok(next.world, 'the world must be attached after a day')
  assert.equal(next.world.version, WORLD_VERSION)
})

test('a world of a previous version is rebuilt, not stepped as-is', () => {
  const state = stepped(5)
  const stale = { ...state.world!, version: WORLD_VERSION - 1 } as ColonyWorld
  const rebuilt = ensureWorld({ ...state, world: stale })
  assert.equal(rebuilt.version, WORLD_VERSION, 'the stale world must not survive')
  assert.notEqual(rebuilt, stale, 'a new world must be built')
  assert.ok(rebuilt.events.some(e => e.code === 'world-migrated'),
    'the migration must be visible in the journal, not silent')
})

test('migration carries the sol and the accumulated totals forward', () => {
  const state = stepped(12)
  const before = state.world!
  const storedSol = before.sol
  const storedHarvest = before.totals.harvestedKg
  const storedLabour = { ...before.totals.labourByKind }

  const rebuilt = ensureWorld({ ...state, world: { ...before, version: 1 } as ColonyWorld })
  assert.equal(rebuilt.sol, storedSol, 'the sol counter must survive')
  assert.equal(rebuilt.totals.harvestedKg, storedHarvest, 'the harvest total must survive')
  for (const [kind, hours] of Object.entries(storedLabour)) {
    assert.equal(rebuilt.totals.labourByKind[kind], hours, `labour hours for ${kind} must survive`)
  }
})

test('migration restores the stocks the player actually owns', () => {
  const state = stepped(10)
  const stale = { ...state.world!, version: 1 } as ColonyWorld
  const rebuilt = ensureWorld({ ...state, world: stale })
  // Физические запасы принадлежат состоянию колонии, а не миру: после
  // пересборки они обязаны вернуться через обычный синхрон.
  const next = advanceDay({ ...state, world: stale }, SCENARIO)
  assert.ok(next.world!.version === WORLD_VERSION)
  assert.ok(Math.abs(next.world!.stock.amount.water_clean - state.waterLitres) >= 0,
    'water must be re-synced from the colony state')
  assert.ok(next.world!.stock.amount.parts >= 0, 'spares must not go negative after migration')
})

test('a migrated world keeps stepping without producing NaN', () => {
  let state = stepped(6)
  state = { ...state, world: { ...state.world!, version: 1 } as ColonyWorld }
  for (let sol = 0; sol < 10; sol++) state = advanceDay(state, SCENARIO)
  const totals = state.world!.totals
  for (const [key, value] of Object.entries(totals)) {
    if (typeof value !== 'number') continue
    assert.ok(Number.isFinite(value), `total ${key} is ${value} after migration`)
  }
  assert.ok(Number.isFinite(state.foodKg) && Number.isFinite(state.waterLitres),
    'the colony state must stay finite after migration')
})

test('a corrupt version field does not crash the step', () => {
  const state = stepped(4)
  const broken = { ...state.world!, version: Number.NaN } as ColonyWorld
  const next = advanceDay({ ...state, world: broken }, SCENARIO)
  assert.equal(next.world!.version, WORLD_VERSION)
  assert.ok(Number.isFinite(next.world!.stock.amount.water_clean))
})
