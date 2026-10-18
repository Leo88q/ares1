import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceDay, initialColony, type ColonyState } from '../../apps/web/src/colony/simulation'
import {
  basePosition, cellWorld, deepVisualState, nodePosition, type Vec2,
} from '../../apps/web/src/colony/deepVisual'
import { COLONY_DEPOSITS } from '../../apps/web/src/colony/deep/bridge'
import { DEEP_P } from '../../apps/web/src/colony/deep/params'
import type { ColonyWorld } from '../../apps/web/src/colony/deep/world'

/**
 * Визуальный слой глубокого мира. Сцена здесь не проверяется — WebGL в тестах
 * нет, — но всё, что она рисует, приходит из этой функции, и именно она
 * обязана выдавать честные данные: машина стоит там, где доехала, а не там,
 * где её нарисовали бы красивее.
 */

const SCENARIO = { sunHours: 18, waterRecovery: 0.94 } as const
const BASE: Vec2 = { x: 0, z: 0 }

const stepped = (sols: number): { state: ColonyState; world: ColonyWorld } => {
  let state = initialColony()
  for (let sol = 0; sol < sols; sol++) state = advanceDay(state, SCENARIO)
  return { state, world: state.world! }
}

test('a missing world produces an empty visual, never a crash', () => {
  const visual = deepVisualState(null, BASE)
  assert.deepEqual(visual.vehicles, [])
  assert.deepEqual(visual.faults, [])
  assert.deepEqual(visual.sections, [])
  assert.deepEqual(visual.beds, [])
})

test('deposits land on the same grid the modules use', () => {
  const { world } = stepped(2)
  for (const deposit of COLONY_DEPOSITS) {
    const at = nodePosition(world, deposit.id, BASE)
    const expected = cellWorld(deposit.x, deposit.z)
    assert.deepEqual(at, expected, `${deposit.id} sits off the colony grid`)
  }
  // База — отдельный узел, а не месторождение.
  assert.deepEqual(nodePosition(world, 'base', BASE), BASE)
  // Неизвестный узел не улетает в бесконечность, а возвращается на базу.
  assert.deepEqual(nodePosition(world, 'nowhere', BASE), BASE)
})

test('every vehicle is somewhere between the nodes it travels', () => {
  const { world } = stepped(30)
  const visual = deepVisualState(world, BASE)
  assert.ok(visual.vehicles.length > 0, 'the world must have vehicles to draw')

  for (const vehicle of visual.vehicles) {
    assert.ok(Number.isFinite(vehicle.position.x) && Number.isFinite(vehicle.position.z),
      `${vehicle.id} has a non-finite position`)
    assert.ok(Number.isFinite(vehicle.heading), `${vehicle.id} has a non-finite heading`)
    assert.ok(vehicle.fill >= 0 && vehicle.fill <= 1, `${vehicle.id} fill is ${vehicle.fill}`)
    assert.ok(vehicle.cargoKg >= 0, `${vehicle.id} carries ${vehicle.cargoKg} kg`)
  }
})

test('a driving vehicle sits on the leg it is actually covering', () => {
  const { world } = stepped(30)
  const visual = deepVisualState(world, BASE)
  const driving = visual.vehicles.filter(v => v.state === 'driving')
  if (driving.length === 0) return // в этот сол никто не ехал — нечего проверять

  for (const vehicle of driving) {
    const source = world.vehicles.find(v => v.id === vehicle.id)!
    const from = nodePosition(world, source.at, BASE)
    const to = nodePosition(world, source.destination!, BASE)
    const share = Math.max(0, Math.min(1, source.travelledKm / source.legKm))
    assert.ok(Math.abs(vehicle.position.x - (from.x + (to.x - from.x) * share)) < 1e-6,
      `${vehicle.id} is not where its travelled distance puts it`)
    assert.ok(Math.abs(vehicle.position.z - (from.z + (to.z - from.z) * share)) < 1e-6,
      `${vehicle.id} is not where its travelled distance puts it`)
    // Машина не телепортируется за пределы своего плеча.
    const min = { x: Math.min(from.x, to.x), z: Math.min(from.z, to.z) }
    const max = { x: Math.max(from.x, to.x), z: Math.max(from.z, to.z) }
    assert.ok(vehicle.position.x >= min.x - 1e-6 && vehicle.position.x <= max.x + 1e-6,
      `${vehicle.id} left its leg`)
    assert.ok(vehicle.position.z >= min.z - 1e-6 && vehicle.position.z <= max.z + 1e-6,
      `${vehicle.id} left its leg`)
  }
})

test('a faulty or worn device is marked, a healthy one is not', () => {
  const { world } = stepped(20)
  for (const device of world.devices) device.condition = 1
  for (const device of world.devices) device.fault = null
  assert.deepEqual(deepVisualState(world, BASE).faults, [], 'a healthy base has no markers')

  const victim = world.devices[0]
  victim.condition = 0.2
  const visual = deepVisualState(world, BASE)
  assert.equal(visual.faults.length, 1, 'the worn device must be marked')
  assert.equal(visual.faults[0].deviceId, victim.id)
  assert.equal(visual.faults[0].severity, 'critical')

  victim.condition = 0.5
  assert.equal(deepVisualState(world, BASE).faults[0].severity, 'warning',
    'a worn but working device is a warning, not a critical')
})

test('section state follows the gas masses, not a stored flag', () => {
  const { world } = stepped(5)
  const section = world.sections[0]
  section.o2Kg = 0.0001
  const starved = deepVisualState(world, BASE).sections.find(s => s.id === section.id)!
  assert.equal(starved.state, 'critical', 'a section without oxygen must read critical')
  assert.ok(starved.o2Kpa < DEEP_P.minO2PartialKpa)

  // Норма: полное давление около номинала и кислород выше минимума.
  section.o2Kg = 30
  section.co2Kg = 0.02
  section.n2Kg = 60
  const healthy = deepVisualState(world, BASE).sections.find(s => s.id === section.id)!
  assert.equal(healthy.state, 'ok', 'a properly filled section must read ok')
})

test('every bed of every greenhouse is reported with its stage and development', () => {
  const { world } = stepped(40)
  const visual = deepVisualState(world, BASE)
  assert.equal(visual.beds.length, world.batches.length, 'one visual entry per bed')

  for (const bed of visual.beds) {
    const batch = world.batches.find(b => b.greenhouseId === bed.moduleId && b.bedIndex === bed.bedIndex)!
    assert.ok(batch, `no batch for ${bed.moduleId}:${bed.bedIndex}`)
    assert.equal(bed.development, Math.max(0, Math.min(1, batch.development)))
    assert.ok(bed.development >= 0 && bed.development <= 1, 'development must be normalised')
    assert.ok(bed.health >= 0 && bed.health <= 1, 'health must be normalised')
    assert.ok(bed.penalty >= 0 && bed.penalty <= 1, 'penalty must be normalised')
  }
})

test('the base node is the centre of the built modules', () => {
  const empty = basePosition([])
  assert.deepEqual(empty, { x: 0, z: 0 }, 'an empty colony must not produce NaN')
  const centred = basePosition([{ x: -4, z: -4 }, { x: 4, z: 4 }])
  assert.deepEqual(centred, { x: 0, z: 0 })
  const offset = basePosition([{ x: 2, z: 6 }, { x: 4, z: 8 }])
  assert.deepEqual(offset, { x: 3, z: 7 })
})

test('the overlay releases everything it allocated', async () => {
  // three.js строит объекты без GL-контекста, поэтому освобождение проверяемо
  // и без браузера: после dispose группа должна быть пуста, а счётчики — в нуле.
  const { createDeepOverlay } = await import('../../apps/web/src/colony/deepScene')
  const overlay = createDeepOverlay()
  const { world } = stepped(20)

  overlay.update(deepVisualState(world, BASE), () => ({ x: 1, z: 1 }))
  assert.ok(overlay.root.children.length > 0, 'the overlay must contain its meshes')
  const drawn = overlay.counts()
  assert.ok(drawn.vehicles > 0 || drawn.faults > 0 || drawn.sections > 0,
    'nothing was written, so the dispose test proves nothing')

  overlay.dispose()
  assert.equal(overlay.root.children.length, 0, 'the group must be emptied')
  assert.deepEqual(overlay.counts(), { vehicles: 0, faults: 0, sections: 0 },
    'the counters must be reset, not left pointing at freed instances')
  // Повторный вызов не должен бросать: сцена освобождается один раз, но код
  // обязан переживать и второй.
  overlay.dispose()
})
