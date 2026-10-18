import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const THREE = require('three')
function load(name) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/fields/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require })
  return exports
}
const { createGreenhouseInterior } = load('greenhouse')
const { createPotatoGeometry } = load('cropGeometry')

test('greenhouse cutaway follows camera quadrant, including translated rooms; roof is independent', () => {
  const room = createGreenhouseInterior(6, 12)
  room.root.position.set(20, 0, 30)
  room.root.updateMatrixWorld(true)
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(40, 16, 50)
  room.cutaway(camera)
  assert.equal(room.root.getObjectByName('wall-x-1').visible, false)
  assert.equal(room.root.getObjectByName('wall-x--1').visible, true)
  assert.equal(room.root.getObjectByName('wall-z-1').visible, false)
  camera.position.set(0, 16, 10)
  room.cutaway(camera)
  assert.equal(room.root.getObjectByName('wall-x-1').visible, true)
  assert.equal(room.root.getObjectByName('wall-z-1').visible, true)
  room.glazing.visible = false
  room.cutaway(camera)
  assert.equal(room.glazing.visible, false)
  room.dispose()
})

test('interior batches repeated geometry, reacts to telemetry and releases GPU allocations', () => {
  const room = createGreenhouseInterior(6, 12)
  const geometries = new Set(), materials = new Set(), instances = []
  room.root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    geometries.add(object.geometry); materials.add(object.material)
    if (object instanceof THREE.InstancedMesh) instances.push(object)
    assert.ok(object.geometry.boundingSphere === null || Number.isFinite(object.geometry.boundingSphere.radius))
  })
  assert.equal(geometries.size, 2, 'shared unit box and cylinder')
  assert.ok(instances.length < 45, `bounded architecture batches: ${instances.length}`)
  assert.ok(instances.reduce((sum, mesh) => sum + mesh.count, 0) > 250, 'detail is instanced, not removed')
  const lamp = [...materials].find(m => m.emissive.getHexString() === 'ffedb5')
  const indicator = [...materials].find(m => m.color.getHexString() === '77bba3')
  room.setState(0, 0, true)
  assert.equal(lamp.emissiveIntensity, 0.15)
  assert.equal(indicator.color.getHexString(), 'cc7050')
  room.setState(1, 1, false)
  assert.ok(lamp.emissiveIntensity > 1.5)
  assert.equal(indicator.color.getHexString(), '77bba3')
  let released = 0
  for (const item of [...geometries, ...materials, ...instances]) item.addEventListener('dispose', () => released++)
  const parent = new THREE.Group(); parent.add(room.root)
  room.dispose()
  assert.equal(parent.children.length, 0)
  assert.equal(released, geometries.size + materials.size + instances.length)
})

test('potato foliage has finite normals and bounds; geometry is reusable for instancing', () => {
  const geometry = createPotatoGeometry()
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
  assert.ok(positions.count > 1000)
  assert.equal(positions.count, normals.count)
  for (const v of positions.array) assert.ok(Number.isFinite(v))
  for (const v of normals.array) assert.ok(Number.isFinite(v))
  assert.ok(geometry.boundingBox.min.y >= -1e-6)
  assert.ok(geometry.boundingBox.max.y <= 1.1)
  assert.ok(geometry.boundingSphere.radius < 1)
  geometry.dispose()
})
