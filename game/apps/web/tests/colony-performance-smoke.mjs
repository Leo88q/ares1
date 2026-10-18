// Structural performance regression, NOT a real-device FPS benchmark.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import * as THREE from 'three'
import { performanceFixture } from './colony-performance-fixture.mjs'
if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw Error('Set CHROMIUM_EXECUTABLE_PATH; this test never downloads a browser.')
const base = (process.env.COLONY_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
const fixture = await performanceFixture()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
const errors = [], external = [], results = []
let teardownTextureBaseline
const output = process.env.COLONY_PERF_DIR
if (output) mkdirSync(output, { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('request', request => { if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) external.push(request.url()) })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    const asset = fixture.assets.get(url.pathname)
    if (asset) return route.fulfill({ contentType: asset.type, body: asset.bytes, headers: asset.type === 'text/html' ? { 'content-security-policy': csp } : {} })
    return route.continue()
  })
  await page.goto(`${base}/__colony-performance/main`, { waitUntil: 'networkidle' })
  for (const count of [8, 256]) {
    const modes = []
    for (const batching of [false, true]) {
      const start = await page.evaluate(([n, on]) => window.__mount(n, on), [count, batching])
      assert.equal(start.modules, count)
      const nearSamples = await page.evaluate(() => window.__sample())
      const near = nearSamples.at(-1)
      if (batching && count === 256) {
        assert.equal(near.updates, start.updates, 'crop updates do not regroup detailed static geometry')
        assert.ok(near.patches > start.patches, 'visible crop poses are patched')
        assert.ok(near.writtenInstances - start.writtenInstances < near.instances * nearSamples.length / 2,
          'crop updates write fewer than half the full-scene matrices')
      }
      const overviewStart = await page.evaluate(() => window.__zoom(0.3 / 1.15))
      const farSamples = await page.evaluate(() => window.__sample())
      const far = farSamples.at(-1)
      if (batching) {
        assert.equal(far.updates, overviewStart.updates, 'crop/condition snapshots do not rebuild static overview matrices')
        const sustained = (await page.evaluate(() => window.__sample(20))).at(-1)
        assert.equal(sustained.serviceRebuilds, far.serviceRebuilds, 'crop/condition snapshots reuse topology services')
        assert.equal(sustained.updates, far.updates, 'sustained state changes keep overview buffers')
        assert.equal(sustained.geometries, far.geometries, 'no growing geometry uploads over updates')
        assert.equal(sustained.textures, far.textures, 'no growing texture uploads over updates')
        assert.equal(sustained.capacity, far.capacity, 'stable instance capacity')
        const recycled = await page.evaluate(() => window.__recycle())
        assert.equal(recycled.modules, count)
        assert.equal(recycled.geometries, far.geometries, 'remove/recreate preserves shared geometry uploads')
        assert.equal(recycled.textures, far.textures, 'remove/recreate does not upload extra textures')
        const selection = await page.evaluate(() => window.__choose())
        assert.ok(selection.updates > far.updates, 'selection changes rebuild overview exclusions')
        const moved = await page.evaluate(() => window.__move())
        assert.ok(moved.serviceRebuilds > selection.serviceRebuilds, 'placement invalidates connectivity cache')
        assert.ok(moved.updates > selection.updates, 'module rotation invalidates static poses')
      }
      assert.ok(far.drawCalls > 0)
      if (batching) {
        assert.equal(far.lowDetail, true)
        if (count === 256) assert.ok(near.culledModules > 0, 'close view culls offscreen modules')
      }
      const record = { count, batching, near, nearSamples, far, farSamples }
      modes.push(record); results.push(record)
      const medianUpdateMs = farSamples.map(s => s.updateMs).sort((a,b) => a-b)[Math.floor(farSamples.length/2)]
      record.medianUpdateMs = medianUpdateMs
      console.log(`MEASURE ${count} ${batching ? 'batched' : 'reference'}: ${far.drawCalls} primary draws, ${far.triangles} triangles, median update ${medianUpdateMs.toFixed(1)}ms, render submission ${far.renderCpuMs.toFixed(1)}ms`)
      if (output && batching && process.env.COLONY_PERF_SCREENSHOTS === '1') await page.locator('#host').screenshot({ path: join(output, `${count}-batched.png`), timeout: 90000 })
      // Verify exact geometry picking with the batch layer active, not just DOM selection.
      if (count === 256) {
        await page.evaluate(() => window.__zoom(1.15 / 0.3))
        const target = await page.evaluate(() => window.__pickTarget())
        const rect = await page.locator('#host canvas').boundingBox(), aspect = rect.width / rect.height
        const width = Math.max(28, 18.5 * aspect)
        const camera = new THREE.OrthographicCamera(-width, width, width / aspect, -width / aspect, 0.1, 250)
        camera.position.set(29, 32, 37); camera.lookAt(0, 0, 0); camera.zoom = 1.15
        camera.updateProjectionMatrix(); camera.updateMatrixWorld()
        const p = new THREE.Vector3(target.x, 0.08, target.z).project(camera)
        await page.locator('#host canvas').click({ position: { x: (p.x + 1) / 2 * rect.width, y: (1 - p.y) / 2 * rect.height } })
        record.picked = await page.evaluate(() => window.__picked)
        assert.match(record.picked, /^stress-/)
        const turned = await page.evaluate(() => window.__turn())
        assert.ok(turned.drawCalls > 0)
      }
      const disposed = await page.evaluate(() => window.__dispose())
      assert.equal(disposed.canvases, 0)
      assert.equal(disposed.stats.geometries, 0, 'GPU geometries released on unmount')
      teardownTextureBaseline ??= disposed.stats.textures
      assert.ok(disposed.stats.textures <= teardownTextureBaseline, 'no texture bookkeeping growth beyond the engine teardown baseline')
      assert.equal(disposed.stats.contextLost, true, 'native GPU context is released, including renderer-private resources')
      record.teardown = disposed.stats
      assert.equal(disposed.stats.capacity, 0, 'instance buffers released on unmount')
      // Three keeps counters for renderer-private shadow shaders after dispose.
      // Context loss above, not zeroing counters by hand, guarantees their release.
    }
    const [reference, batched] = modes
    if (count === 256) {
      assert.ok(batched.far.drawCalls < reference.far.drawCalls * 0.5, 'at least halve whole-colony primary draw calls')
      assert.ok(batched.far.triangles < reference.far.triangles * 0.5, 'overview LOD at least halves triangle count')
      assert.ok(batched.far.textures < reference.far.textures, 'unselected labels do not upload hundreds of textures')
      assert.equal(batched.picked, reference.picked, 'exact picking preserves stable module identity')
    }
    console.log(`PASS ${count} modules: reference ${reference.far.drawCalls} → batched ${batched.far.drawCalls} primary draws; textures ${reference.far.textures} → ${batched.far.textures}; GPU cleanup`)
  }
  // Same batched near scene, old full-rebuild algorithm vs pose-only patches.
  const nearComparison = []
  for (const incremental of [false, true]) {
    const start = await page.evaluate(on => window.__mount(256, true, on), incremental)
    const samples = await page.evaluate(() => window.__sample())
    const end = samples.at(-1)
    const medianUpdateMs = samples.map(s => s.updateMs).sort((a,b) => a-b)[2]
    const writes = end.writtenInstances - start.writtenInstances
    if (incremental) {
      assert.equal(end.updates, start.updates)
      assert.ok(end.patches > start.patches)
      const night = await page.evaluate(() => window.__night())
      assert.ok(night.updates > end.updates, 'lamp visibility/material changes safely regroup batches')
      const solarFirst = await page.evaluate(() => window.__solar(0.25))
      const solarNext = await page.evaluate(() => window.__solar(0.5))
      assert.equal(solarNext.updates, solarFirst.updates, 'solar tilt patches without regrouping')
      assert.ok(solarNext.patches > solarFirst.patches, 'solar world matrices actually change')
    }
    nearComparison.push({ incremental, medianUpdateMs, writes, start, samples })
    const teardown = await page.evaluate(() => window.__dispose())
    assert.equal(teardown.stats.contextLost, true); assert.equal(teardown.stats.geometries, 0)
    assert.equal(teardown.stats.capacity, 0); assert.equal(teardown.canvases, 0)
  }
  for (const key of ['drawCalls', 'triangles', 'batches', 'instances']) {
    assert.equal(nearComparison[1].samples.at(-1)[key], nearComparison[0].samples.at(-1)[key], `near render parity: ${key}`)
  }
  assert.ok(nearComparison[1].writes < nearComparison[0].writes / 2, 'patches at least halve matrix writes')
  console.log(`PASS near 256: full rebuild → incremental, median update ${nearComparison[0].medianUpdateMs.toFixed(1)} → ${nearComparison[1].medianUpdateMs.toFixed(1)}ms; matrix writes ${nearComparison[0].writes} → ${nearComparison[1].writes}`)
  results.push({ nearComparison })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (output) writeFileSync(join(output, 'metrics.json'), JSON.stringify({ note: 'Headless software-renderer observations, not real-device FPS. Draws are renderer.info primary-pass counters.', results }, null, 2))
  console.log('PASS production CSP, culling/LOD, geometry selection, no external requests or runtime errors')
} finally { await browser.close(); fixture.dispose() }
