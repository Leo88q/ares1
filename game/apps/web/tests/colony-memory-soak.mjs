// Finite, opt-in memory/resource soak. Uses actual scene source, not a phone FPS test.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { performanceFixture } from './colony-performance-fixture.mjs'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw Error('Set CHROMIUM_EXECUTABLE_PATH; no browser download is performed.')
const seconds = Number(process.env.COLONY_SOAK_SECONDS ?? 300)
const cycles = Number(process.env.COLONY_SOAK_CYCLES ?? 4)
assert.ok(Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600)
assert.ok(Number.isInteger(cycles) && cycles >= 2 && cycles <= 50)
const base = (process.env.COLONY_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
assert.ok(csp, 'production CSP is required')
const output = process.env.COLONY_SOAK_DIR
if (output) mkdirSync(output, { recursive: true })
const fixture = await performanceFixture()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
const report = { note: 'Chromium software-renderer soak; post-forced-GC JS heap is not native/GPU/process memory or phone FPS.', seconds, cycles, checkpoints: [], iterations: 0, errors: [], external: [] }
const save = () => { if (output) writeFileSync(join(output, 'memory.json'), JSON.stringify(report, null, 2)) }
let teardownTextures
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })
  page.on('request', request => { if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) report.external.push(request.url()) })
  await page.route('**/*', async route => {
    const asset = fixture.assets.get(new URL(route.request().url()).pathname)
    if (asset) return route.fulfill({ contentType: asset.type, body: asset.bytes, headers: asset.type === 'text/html' ? { 'content-security-policy': csp } : {} })
    return route.continue()
  })
  await page.goto(`${base}/__colony-performance/main`, { waitUntil: 'networkidle' })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  async function checkpoint(phase, stats = null) {
    // Checkpoint deliberately happens after browser evaluate handles are released.
    await cdp.send('HeapProfiler.collectGarbage')
    const { metrics } = await cdp.send('Performance.getMetrics')
    const dom = await cdp.send('Memory.getDOMCounters')
    const heap = metrics.find(m => m.name === 'JSHeapUsedSize')?.value
    assert.ok(Number.isFinite(heap) && heap > 0)
    const row = { phase, heap, ...dom, stats }
    report.checkpoints.push(row); save()
    console.log(`MEMORY ${phase}: ${(heap / 1048576).toFixed(1)} MiB post-GC JS heap; ${dom.nodes} DOM nodes; ${dom.jsEventListeners} listeners`)
    return row
  }
  function bounded(current, baseline) {
    // Generous, explicit budget for JIT/driver wrappers; no noisy millisecond assertions.
    assert.ok(current.heap <= baseline.heap + Math.max(16 * 1048576, baseline.heap * 0.25), `${current.phase}: retained JS heap exceeded warm baseline budget`)
    assert.ok(current.nodes <= baseline.nodes + 128, `${current.phase}: detached DOM nodes growing`)
    assert.ok(current.jsEventListeners <= baseline.jsEventListeners + 32, `${current.phase}: listeners growing`)
  }
  async function dispose() {
    const result = await page.evaluate(() => window.__dispose())
    assert.equal(result.canvases, 0); assert.equal(result.stats.contextLost, true)
    assert.equal(result.stats.geometries, 0); assert.equal(result.stats.capacity, 0)
    teardownTextures ??= result.stats.textures
    assert.ok(result.stats.textures <= teardownTextures, 'teardown texture bookkeeping grows')
    return result.stats
  }
  async function warm() {
    await page.evaluate(() => window.__mount(256, true))
    // Warm all seven visible selected archetypes; keep selections bounded, so
    // normal one-time caption uploads are not mistaken for a resource leak.
    const samples = []
    for (let index = 136; index < 143; index++) samples.push(await page.evaluate(i => window.__choose(i), index))
    samples.push(await page.evaluate(() => window.__night()))
    samples.push(...await page.evaluate(() => window.__sample(2)))
    await page.evaluate(() => window.__zoom(0.3 / 1.15))
    await page.evaluate(() => window.__zoom(1.15 / 0.3))
    const stats = (await page.evaluate(() => window.__sample(1))).at(-1)
    samples.push(stats)
    return { stats, limits: Object.fromEntries(['capacity','geometries','textures'].map(key => [key,Math.max(...samples.map(s => s[key]))])) }
  }
  const {stats:initial, limits} = await warm()
  report.resourceLimits = limits
  const activeBaseline = await checkpoint('warm-active-256', initial)
  const began = Date.now()
  while (Date.now() - began < seconds * 1000) {
    const index = 136 + report.iterations % 7
    await page.evaluate(i => window.__choose(i), index)
    await page.evaluate(i => window.__recycle(i), index)
    await page.evaluate(() => window.__move())
    await page.evaluate(() => window.__zoom(0.3 / 1.15))
    await page.evaluate(() => window.__sample(2))
    await page.evaluate(() => window.__night())
    await page.evaluate(() => window.__zoom(1.15 / 0.3))
    const end = (await page.evaluate(() => window.__sample(2))).at(-1)
    assert.equal(end.modules, 256)
    assert.ok(end.capacity <= limits.capacity, 'instance capacity exceeds warmed archetype maximum')
    assert.ok(end.geometries <= limits.geometries + 2, 'loaded geometries accumulate during edit cycles')
    assert.ok(end.textures <= limits.textures + 2, 'loaded textures accumulate during edit cycles')
    report.iterations++
    if (report.iterations % 10 === 0) bounded(await checkpoint(`active-${report.iterations}`, end), activeBaseline)
    await page.waitForTimeout(100)
  }
  bounded(await checkpoint('active-final', (await page.evaluate(() => window.__sample(1))).at(-1)), activeBaseline)
  const disposed = await dispose()
  const closedBaseline = await checkpoint('warm-disposed', disposed)
  for (let cycle = 1; cycle <= cycles; cycle++) {
    await warm()
    await page.evaluate(() => window.__recycle(140))
    const stats = await dispose()
    bounded(await checkpoint(`remount-disposed-${cycle}`, stats), closedBaseline)
  }
  report.elapsedSeconds = (Date.now() - began) / 1000
  assert.deepEqual(report.errors, []); assert.deepEqual(report.external, [])
  console.log(`PASS ${seconds}s active soak (${report.iterations} edit cycles), ${cycles} full remounts, bounded post-GC heap/DOM/listeners, GPU teardown, production CSP`)
} finally { save(); await browser.close(); fixture.dispose() }
