import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const THREE = require('three')
const ts = require('typescript')
const source = readFileSync(new URL('../src/three/cameraRig.ts', import.meta.url), 'utf8')

function fixture() {
  const frames = new Map()
  let id = 0
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require, performance: { now: () => 0 },
    requestAnimationFrame: cb => { frames.set(++id, cb); return id },
    cancelAnimationFrame: key => frames.delete(key),
  })
  const listeners = new Map()
  const captured = new Set()
  const dom = {
    style: {}, dataset: {},
    getBoundingClientRect: () => ({ width: 400, height: 400 }),
    addEventListener: (name, cb) => listeners.set(name, cb),
    removeEventListener: name => listeners.delete(name),
    setPointerCapture: key => captured.add(key),
    hasPointerCapture: key => captured.has(key),
    releasePointerCapture: key => captured.delete(key),
  }
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200)
  const rig = exports.createCameraRig({ camera, dom, offset: [14, 16, 18], bounds: { x: 10, z: 10 }, minZoom: 0.75, maxZoom: 3, onRender() {} })
  const event = (name, x, y, pointerId = 1) => listeners.get(name)?.({ clientX: x, clientY: y, pointerId })
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(300)) }
  return { rig, camera, dom, event, flush, listeners, captured, frames }
}

test('drag translates camera without changing its orientation; pan stays bounded', () => {
  const f = fixture()
  const direction = f.camera.getWorldDirection(new THREE.Vector3())
  const start = f.camera.position.clone()
  f.event('pointerdown', 100, 100)
  f.event('pointermove', 200, 150)
  assert.ok(start.distanceTo(f.camera.position) > 1)
  assert.ok(direction.distanceTo(f.camera.getWorldDirection(new THREE.Vector3())) < 1e-10)
  f.event('pointermove', 100000, 100000)
  assert.ok(Math.abs(f.camera.position.x - 14) <= 10)
  assert.ok(Math.abs(f.camera.position.z - 18) <= 10)
  f.event('pointerup', 100000, 100000)
  assert.equal(f.captured.size, 0)
})

test('four quarter turns return to original view, including rapid repeated clicks', () => {
  const f = fixture()
  const start = f.camera.position.clone()
  for (let i = 0; i < 4; i++) f.rig.rotateStep(1)
  f.flush()
  assert.ok(start.distanceTo(f.camera.position) < 1e-10)
  assert.equal(f.dom.dataset.yaw, '0')
  f.rig.rotateStep(-1); f.flush()
  assert.equal(f.dom.dataset.yaw, '3')
  assert.ok(Math.abs(f.camera.position.y - 16) < 1e-10)
})

test('pinch zooms; reset restores camera; dispose removes listeners and pending rotation', () => {
  const f = fixture()
  f.event('pointerdown', 0, 0, 1)
  f.event('pointerdown', 100, 0, 2)
  f.event('pointermove', 200, 0, 2)
  assert.equal(f.camera.zoom, 2)
  f.rig.zoomBy(100); assert.equal(f.camera.zoom, 3)
  f.rig.zoomBy(0.001); assert.equal(f.camera.zoom, 0.75)
  f.rig.reset(); assert.equal(f.camera.zoom, 1)
  assert.ok(f.camera.position.distanceTo(new THREE.Vector3(14, 16, 18)) < 1e-10)
  f.rig.rotateStep(1)
  f.rig.dispose()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.frames.size, 0)
})
