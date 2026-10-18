import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNetworkServiceReader, networkServices } from '../../apps/web/src/colony/networks'
import { initialColony } from '../../apps/web/src/colony/simulation'

test('service reader reuses graph across new crop/wear/day snapshots, not just identical state references', () => {
  const reader = createNetworkServiceReader(), state = initialColony(), original = reader.read(state)
  const next = { ...state, day: state.day + 1, modules: state.modules.map(m => ({ ...m, growthDays: m.growthDays + 1, condition: m.condition - 1 })) }
  assert.equal(reader.read(next), original)
  assert.equal(reader.rebuilds(), 1)
  assert.deepEqual(original, networkServices(next))
})

test('route removal, in-place cell edits and placement/order changes invalidate connectivity', () => {
  const reader = createNetworkServiceReader(), state = structuredClone(initialColony())
  let previous = reader.read(state)
  for (const mutate of [
    () => { state.networks!.pop() },
    () => { state.networks![0].cells[0].x += 1 },
    () => { state.modules[0].placement!.rotation = 1 },
    () => { state.modules.reverse() },
  ]) {
    mutate(); const next = reader.read(state)
    assert.notEqual(next, previous); assert.deepEqual(next, networkServices(state)); previous = next
  }
  assert.equal(reader.rebuilds(), 5)
  reader.clear(); assert.notEqual(reader.read(state), previous)
})

test('legacy snapshots without networks and independent readers do not share cached results', () => {
  const state = { ...initialColony(), networks: undefined }, a = createNetworkServiceReader(), b = createNetworkServiceReader()
  assert.deepEqual(a.read(state), networkServices(state))
  assert.notEqual(a.read(state), b.read(state))
  const changed = { ...state, modules: state.modules.slice(1) }
  assert.deepEqual(a.read(changed), networkServices(changed))
})
