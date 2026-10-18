import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModuleBatcher } from '../../apps/web/src/colony/moduleBatcher'

test('256 repeated source meshes produce one batch; poses and shared resources are preserved', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
  const sources = Array.from({ length: 256 }, (_, i) => {
    const root = new THREE.Group(); root.position.set(i % 16 * 3, 0, Math.floor(i / 16) * 3)
    const mesh = new THREE.Mesh(geometry, material); mesh.position.y = 2; root.add(mesh); return root
  })
  const view = createModuleBatcher()
  view.update(sources)
  assert.deepEqual(view.stats(), { updates: 1, patches: 0, writtenInstances: 256, batches: 1, instances: 256, capacity: 256 })
  const batch = view.root.children[0] as THREE.InstancedMesh
  assert.equal(batch.geometry, geometry); assert.equal(batch.material, material)
  const matrix = new THREE.Matrix4(); batch.getMatrixAt(255, matrix)
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(matrix).toArray(), [45, 2, 45])
  sources[255].position.x = 12; view.update(sources)
  assert.equal(view.root.children[0], batch, 'instance buffer reused on pose updates')
  batch.getMatrixAt(255, matrix)
  assert.equal(new THREE.Vector3().setFromMatrixPosition(matrix).x, 12)
  let disposed = 0
  geometry.addEventListener('dispose', () => disposed++); material.addEventListener('dispose', () => disposed++)
  view.dispose()
  assert.equal(disposed, 0, 'borrowed source geometry/material are not destroyed')
  geometry.dispose(); material.dispose()
})

test('capacity grows geometrically; shrinking updates count/bounds without reallocating, removal frees buffers', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
  const sources = Array.from({ length: 9 }, (_, i) => { const m = new THREE.Mesh(geometry, material); m.position.x = i * 10; return m })
  const view = createModuleBatcher()
  view.update(sources.slice(0, 4))
  const old = view.root.children[0] as THREE.InstancedMesh
  let released = 0; old.addEventListener('dispose', () => released++)
  view.update(sources)
  assert.equal(released, 1); assert.equal(view.stats().capacity, 16)
  const current = view.root.children[0] as THREE.InstancedMesh
  current.addEventListener('dispose', () => released++)
  view.update(sources.slice(0, 1))
  assert.equal(view.root.children[0], current)
  assert.equal(current.count, 1)
  assert.ok(current.boundingBox!.max.x < 1, 'unused capacity must not inflate culling bounds')
  view.update([])
  assert.equal(released, 2); assert.equal(view.stats().capacity, 0)
  view.dispose(); geometry.dispose(); material.dispose()
})

test('invisible descendants stay hidden; source trees under a non-rendered parent retain world transforms', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
  const hiddenParent = new THREE.Group(); hiddenParent.visible = false; hiddenParent.position.x = 7
  const source = new THREE.Group(); source.position.z = 4; hiddenParent.add(source)
  const visible = new THREE.Mesh(geometry, material), hidden = new THREE.Mesh(geometry, material)
  hidden.visible = false; source.add(visible, hidden)
  const view = createModuleBatcher(); view.update([source])
  assert.equal(view.stats().instances, 1)
  const matrix = new THREE.Matrix4(); (view.root.children[0] as THREE.InstancedMesh).getMatrixAt(0, matrix)
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(matrix).toArray(), [7, 0, 4])
  assert.equal(source.parent, hiddenParent, 'batching cannot detach source used for exact picking')
  view.dispose(); geometry.dispose(); material.dispose()
})

test('material identities/arrays and shadow modes never collapse into incompatible batches', () => {
  const geometry = new THREE.BoxGeometry(), a = new THREE.MeshStandardMaterial(), b = a.clone()
  const one = new THREE.Mesh(geometry, a), two = new THREE.Mesh(geometry, b), multi = new THREE.Mesh(geometry, [a, b]), shadow = new THREE.Mesh(geometry, a)
  shadow.castShadow = true
  const view = createModuleBatcher(); view.update([one, two, multi, shadow])
  assert.equal(view.stats().batches, 4)
  assert.equal(view.stats().instances, 4)
  view.dispose(); geometry.dispose(); a.dispose(); b.dispose()
})


test('hidden overview detail trees do not perform matrix work; reappearing detail gets fresh poses', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
  const scene = new THREE.Group(), root = new THREE.Group(), detail = new THREE.Group()
  scene.position.x = 7; root.position.z = 4; scene.add(root); root.add(detail)
  const mesh = new THREE.Mesh(geometry, material); detail.add(mesh); detail.visible = false
  let work = 0
  const update = mesh.updateWorldMatrix.bind(mesh)
  mesh.updateWorldMatrix = (parents, children) => { work++; update(parents, children) }
  const view = createModuleBatcher(); view.update([root])
  assert.equal(work, 0, 'hidden subtree is not visited')
  assert.equal(view.stats().instances, 0)
  mesh.position.x = 3; root.position.z = 9; detail.visible = true
  view.update([root])
  assert.equal(work, 1)
  const matrix = new THREE.Matrix4(); (view.root.children[0] as THREE.InstancedMesh).getMatrixAt(0, matrix)
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(matrix).toArray(), [10, 0, 9])
  view.dispose(); geometry.dispose(); material.dispose()
})


test('pose patches update only changed slots without rebuilding membership or allocating buffers', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
  const sources = Array.from({ length: 256 }, (_, i) => {
    const root = new THREE.Group(); root.position.x = i * 3
    const crop = new THREE.Group(); crop.name = 'crops'; root.add(crop)
    crop.add(new THREE.Mesh(geometry, material)); return root
  })
  const view = createModuleBatcher(); view.update(sources)
  const batch = view.root.children[0] as THREE.InstancedMesh, buffer = batch.instanceMatrix
  buffer.onUploadCallback() // simulate the initial renderer upload
  const oldVersion = buffer.version, before = view.stats()
  sources[100].children[0].scale.y = 2
  view.refresh([sources[100].children[0], sources[100].children[0]])
  assert.equal(view.root.children[0], batch); assert.equal(batch.instanceMatrix, buffer)
  assert.equal(view.stats().updates, before.updates)
  assert.equal(view.stats().writtenInstances - before.writtenInstances, 1)
  assert.equal(view.stats().patches, 1); assert.equal(buffer.version, oldVersion + 1)
  assert.deepEqual(buffer.updateRanges, [{start:100*16,count:16}])
  const matrix = new THREE.Matrix4(); batch.getMatrixAt(100, matrix)
  assert.equal(matrix.elements[13], 0); assert.equal(matrix.elements[5], 2)
  assert.equal(matrix.elements[12], 300)
  assert.equal(batch.boundingBox!.max.y, 1, 'bounds expand for new crop pose')
  sources[100].children[0].scale.y = 0.5; view.refresh([sources[100].children[0]])
  assert.equal(batch.boundingBox!.max.y, 0.5, 'bounds shrink after patch')
  batch.getMatrixAt(101, matrix); assert.equal(matrix.elements[5], 1)
  view.dispose(); geometry.dispose(); material.dispose()
})

test('patches tolerate culled/selected branches; structural rebuild drops stale slot references', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
  const a = new THREE.Mesh(geometry, material), b = a.clone(), view = createModuleBatcher()
  view.update([a]); view.refresh([b]); assert.equal(view.stats().patches, 0)
  view.update([b]); const writes = view.stats().writtenInstances
  view.refresh([a]); assert.equal(view.stats().writtenInstances, writes)
  b.position.z = 3; view.refresh([b])
  const matrix = new THREE.Matrix4(); (view.root.children[0] as THREE.InstancedMesh).getMatrixAt(0,matrix)
  assert.equal(matrix.elements[14], 3)
  view.dispose(); geometry.dispose(); material.dispose()
})


test('pose patches before rendering cannot narrow a pending full GPU upload', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
  const a = new THREE.Mesh(geometry, material), b = a.clone(), view = createModuleBatcher()
  view.update([a,b]); const batch = view.root.children[0] as THREE.InstancedMesh
  batch.instanceMatrix.onUploadCallback()
  a.position.y = 2; view.refresh([a])
  assert.equal(batch.instanceMatrix.updateRanges.length, 1)
  b.position.y = 4; view.update([b,a]) // reorder existing slots; full transfer pending
  a.position.y = 3; view.refresh([a]) // before renderer.render
  assert.deepEqual(batch.instanceMatrix.updateRanges, [], 'full transfer must remain full')
  const matrix = new THREE.Matrix4(); batch.getMatrixAt(0,matrix); assert.equal(matrix.elements[13],4)
  batch.getMatrixAt(1,matrix); assert.equal(matrix.elements[13],3)
  batch.instanceMatrix.onUploadCallback()
  a.position.y = 5; view.refresh([a])
  assert.deepEqual(batch.instanceMatrix.updateRanges,[{start:16,count:16}])
  view.dispose(); geometry.dispose(); material.dispose()
})

test('incremental branch matrices and bounds match an independent full rebuild', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()
  const source = new THREE.Group(), crop = new THREE.Group(), staticMesh = new THREE.Mesh(geometry,material)
  source.position.set(5,0,-2); source.rotation.y = 0.8; source.add(crop,staticMesh)
  const leaf = staticMesh.clone(); leaf.position.set(0.2,1,0); crop.add(leaf)
  const incremental = createModuleBatcher(), reference = createModuleBatcher()
  incremental.update([source]); reference.update([source])
  for (const value of [0.5,1.8,0.2]) {
    crop.scale.set(1,value,1); crop.rotation.z = value * 0.1
    incremental.refresh([crop]); reference.update([source])
    const a = incremental.root.children[0] as THREE.InstancedMesh, b = reference.root.children[0] as THREE.InstancedMesh
    assert.deepEqual(a.instanceMatrix.array,b.instanceMatrix.array)
    assert.ok(a.boundingBox!.equals(b.boundingBox!)); assert.ok(a.boundingSphere!.equals(b.boundingSphere!))
  }
  incremental.dispose(); reference.dispose(); geometry.dispose(); material.dispose()
})
