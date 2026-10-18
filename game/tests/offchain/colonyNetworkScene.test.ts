import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { initialColony } from '../../apps/web/src/colony/simulation'
import { createNetworkScene } from '../../apps/web/src/colony/networkScene'
import { planNetwork } from '../../apps/web/src/colony/networks'

test('network scene batches segments by utility type, not per pipe; unchanged input reuses GPU instances', () => {
  const state = initialColony(), view = createNetworkScene()
  view.update(state.modules, state.networks!, null)
  assert.equal(view.root.children.length, 4)
  const before = [...view.root.children] as THREE.InstancedMesh[]
  const geometries = new Set<THREE.BufferGeometry>()
  let count = 0
  for (const child of before) {
    assert.ok(child instanceof THREE.InstancedMesh)
    geometries.add(child.geometry); count += child.count
    assert.ok(Number.isFinite(child.boundingSphere!.radius))
  }
  assert.equal(geometries.size, 2)
  assert.ok(count > 50)
  view.update(state.modules, state.networks!, null)
  assert.deepEqual(view.root.children, before)
  let released = 0
  before.forEach(child => child.addEventListener('dispose', () => released++))
  const preview = planNetwork(state, 'power', 'greenhouse-5', 'solar-1')!
  view.update(state.modules, state.networks!, preview)
  assert.equal(released, before.length, 'old instance buffers freed on rebuild')
  assert.equal(view.root.children.length, 5, 'one extra preview layer')
  const instances = [...view.root.children] as THREE.InstancedMesh[]
  instances.forEach(child => child.addEventListener('dispose', () => released++))
  const parent = new THREE.Group(); parent.add(view.root)
  view.dispose()
  assert.equal(released, before.length + instances.length)
  assert.equal(parent.children.length, 0)
})

test('network scene adds endpoint stubs instead of leaving lines floating one cell outside modules', () => {
  const state = initialColony(), view = createNetworkScene()
  const route = planNetwork(state, 'water', 'recycler-6', 'greenhouse-5')!
  view.update(state.modules, [route], null)
  assert.equal(view.root.children.length, 1)
  const mesh = view.root.children[0] as THREE.InstancedMesh
  assert.equal(mesh.count, route.cells.length + 1, 'cell-to-cell segments plus two wall stubs')
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(0, matrix)
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion()
  matrix.decompose(position, rotation, scale)
  assert.ok(scale.y > 0)
  assert.ok(Math.abs(position.y - 0.24) < 1e-6)
  view.dispose()
})
