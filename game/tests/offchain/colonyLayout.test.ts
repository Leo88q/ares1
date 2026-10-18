import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialColony, buildModuleAt, moveModule } from '../../apps/web/src/colony/simulation'
import { COLONY_GRID_SIZE, footprint, modulePlacement, placementError, placementWorld, worldCell, findPlacement } from '../../apps/web/src/colony/layout'

test('starter colony has explicit, non-overlapping plots with service gaps', () => {
  const state = initialColony()
  for (const m of state.modules) {
    assert.ok(m.placement)
    assert.equal(placementError(state.modules, m.kind, modulePlacement(m), m.id), null)
  }
  assert.equal(COLONY_GRID_SIZE, 48)
})

test('placement validates rotations, bounds, edge touching and rectangular intersections', () => {
  const s = initialColony(), at = modulePlacement(s.modules[0])
  assert.equal(placementError(s.modules, 'habitat', at), 'occupied')
  assert.equal(placementError([], 'greenhouse', { x: 46, z: 45, rotation: 0 }), null)
  assert.equal(placementError([], 'greenhouse', { x: 46, z: 45, rotation: 1 }), 'bounds')
  assert.equal(placementError([], 'greenhouse', { x: 45, z: 46, rotation: 1 }), null)
  for (const bad of [NaN, Infinity, 0.5, -1, 48]) {
    assert.notEqual(placementError([], 'solar', { x: bad, z: 0, rotation: 0 }), null)
  }
  assert.equal(placementError([], 'solar', { x: 0, z: 0, rotation: 4 as 0 }), 'coordinates')
  assert.deepEqual(footprint('greenhouse', 1), [3, 2])
  assert.equal(placementError(s.modules, 'solar', { x: at.x + 2, z: at.z, rotation: 0 }), null)
})

test('explicit construction is atomic, debits once, and cannot mutate a caller-owned draft', () => {
  const s = initialColony(), at = { x: 40, z: 40, rotation: 1 as const }
  const next = buildModuleAt(s, 'greenhouse', at)
  assert.notEqual(next, s)
  assert.equal(next.credits, s.credits - 250)
  assert.equal(next.sparesKg, s.sparesKg - 1)
  assert.equal(next.modules.length, s.modules.length + 1)
  assert.equal(next.modules.at(-1)!.growthDays, 0)
  assert.equal(next.ledger.plots.length, s.ledger.plots.length + 1)
  assert.equal(buildModuleAt(next, 'greenhouse', at), next, 'same site cannot be purchased twice')
  at.x = 20
  assert.equal(next.modules.at(-1)!.placement!.x, 40)
  for (const blocked of [{ ...s, credits: 0 }, { ...s, sparesKg: 0 }]) {
    assert.equal(buildModuleAt(blocked, 'solar', { x: 0, z: 0, rotation: 0 }), blocked)
  }
  assert.equal(buildModuleAt(s, 'solar', modulePlacement(s.modules[0])), s)
})

test('relocation preserves ledger, balances, wear, crop beds, and other module identities', () => {
  const s = initialColony(), m = s.modules.find(m => m.kind === 'greenhouse')!
  const next = moveModule(s, m.id, { x: 40, z: 40, rotation: 3 })
  assert.notEqual(next, s)
  assert.equal(next.ledger, s.ledger)
  for (const key of ['credits', 'spentCredits', 'sparesKg', 'foodKg', 'waterLitres', 'nutrientsKg', 'day'] as const) assert.equal(next[key], s[key])
  assert.equal(next.modules.find(x => x.id === m.id)!.beds, m.beds)
  assert.equal(next.modules[0], s.modules[0])
  assert.equal(moveModule(s, m.id, modulePlacement(s.modules[0])), s)
  assert.equal(moveModule(s, 'missing', { x: 0, z: 0, rotation: 0 }), s)
})

test('legacy slots migrate on read and world coordinates refer to centres of footprints', () => {
  const s = initialColony(), legacy = { ...s.modules[0], placement: undefined }
  assert.deepEqual(modulePlacement(legacy), { x: 12, z: 14, rotation: 0 })
  const p = placementWorld('greenhouse', { x: 24, z: 24, rotation: 0 })
  assert.equal(p.width, 4.8); assert.ok(Math.abs(p.depth - 7.2) < 1e-10)
  assert.deepEqual(worldCell(-57.5, -57.5), { x: 0, z: 0 })
  assert.deepEqual(worldCell(57.5, 57.5), { x: 47, z: 47 })
  const next = findPlacement(s.modules, 'solar')!
  assert.ok(next); assert.equal(placementError(s.modules, 'solar', next), null)
})
