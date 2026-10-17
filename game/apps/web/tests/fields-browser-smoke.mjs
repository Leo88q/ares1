// Production-CSP UI test. Installed browser only; never downloads Chromium.
// CHROMIUM_EXECUTABLE_PATH=... [FIELDS_BASE_URL=...] yarn workspace web test:fields-browser
// Песочница /demo удалена: учебные стенды теперь живут в продуктовой лаборатории
// /lab, поэтому 3D-слой полей проверяется на её фикстуре (без кошелька).
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import * as THREE from 'three'
import { mainFixture } from './fields-main-fixture.mjs'
import { labFixture } from './lab-fixture.mjs'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH to an installed browser')
const base = (process.env.FIELDS_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
assert.ok(csp)
const screenshots = process.env.FIELDS_SCREENSHOT_DIR
// NO_WEBGL=1: skip the 3D demo and the 3D view switch; fallback views are still tested. CI runs the full 3D suite.
const noWebgl = process.env.NO_WEBGL === '1'
if (screenshots) mkdirSync(screenshots, { recursive: true })
const fixture = await labFixture({ slug: 'lab-bench' })
const mainFixtureAssets = await mainFixture()
const assets = new Map([...fixture.assets, ...mainFixtureAssets.assets])
const htmlPaths = new Set(['/__lab-bench/main', '/__fields/main'])
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
const errors = [], external = [], successfulModels = new Map()
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow')
const settled = async page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const shot = async (page, name) => { if (screenshots) { await settled(page); await page.screenshot({ path: join(screenshots, name), fullPage: true }) } }

async function open(width, { fallback = false, breakModel = false, realMain = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ru-RU', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (noWebgl && /WebGL/.test(message.text())) return // NO_WEBGL: the missing GPU context is the expected condition
    if (fallback && /WebGL context could not be created|Error creating WebGL context/.test(message.text())) return
    if (breakModel && /\/models\/fields\//.test(message.location().url)) return
    errors.push(message.text())
  })
  page.on('response', response => {
    if (!breakModel && /\/models\/fields\/.+\.glb$/.test(response.url())) successfulModels.set(response.url(), response.status())
  })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin && !/^(data|blob):/.test(request.url())) { external.push(request.url()); return route.abort() }
    const mocked = assets.get(url.pathname)
    if (mocked) return route.fulfill({ status: 200, contentType: mocked.type, body: mocked.bytes,
      headers: htmlPaths.has(url.pathname) ? { 'content-security-policy': csp } : {} })
    if (breakModel && url.pathname === '/models/fields/canopy.glb') return route.fulfill({ status: 503, body: 'Model unavailable' })
    if (!request.isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
  })
  if (fallback) await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/.test(type) ? null : getContext.call(this, type, ...args) }
  })
  await page.goto(`${base}${realMain ? '/__fields/main' : '/__lab-bench/main'}`, { waitUntil: 'networkidle' })
  await page.locator(fallback || breakModel ? '[data-testid="fields-fallback"]' : '[data-testid="fields-viewport"][data-ready="true"]').waitFor()
  // Лаборатория открывается на настоящем слое поля (initialLayer="chain"): 3D-вид,
  // статус-полоса и инспектор доступны сразу, переключать слой не нужно.
  await noOverflow(page)
  return { page, context }
}

try {
  if (!noWebgl) {
    const { page, context } = await open(1440)
    assert.equal(await page.locator('.mf-field-picker button').count(), 3)
    assert.equal(await page.locator('.mf-canvas-host canvas').count(), 1)
    await page.getByRole('button', { name: /Поле 03 EPIC/ }).click()
    assert.equal(await page.getByTestId('fields-viewport').getAttribute('data-selected-id'), 'lab-bench-2')
    await page.getByRole('button', { name: 'Остекление', exact: true }).click()
    await shot(page, 'desktop-epic.png')
    await page.getByRole('button', { name: 'Обзор сектора', exact: true }).click()
    await shot(page, 'desktop-sector.png')
    // Clicking actual rendered geometry selects a field; it never performs harvest.
    const rect = await page.locator('.mf-canvas-host canvas').boundingBox()
    const camera = new THREE.OrthographicCamera(-25 * rect.width / rect.height, 25 * rect.width / rect.height, 25, -25, 0.1, 180)
    camera.position.set(30, 30, 34); camera.lookAt(0, 0.6, 0); camera.updateMatrixWorld()
    const point = new THREE.Vector3(-13, 0.3, 0).project(camera)
    await page.locator('.mf-canvas-host canvas').click({ position: { x: (point.x + 1) / 2 * rect.width, y: (1 - point.y) / 2 * rect.height } })
    await page.waitForFunction(() => document.querySelector('[data-testid="fields-viewport"]')?.getAttribute('data-selected-id') === 'lab-bench-0')
    await page.getByRole('button', { name: 'Выбранное поле', exact: true }).click()
    await page.getByRole('button', { name: 'Приблизить', exact: true }).click()
    await page.getByRole('button', { name: 'Вернуть камеру', exact: true }).click()
    // Стенд тира помечен как учебный: без кошелька, без POTATO, без блокчейна.
    assert.equal(await page.getByTestId('lab-bench').getAttribute('data-tier'), '2')
    assert.match(await page.getByTestId('lab-bench').innerText(), /УЧЕБНЫЙ СТЕНД · НЕ АККАУНТ КОШЕЛЬКА/)
    assert.match(await page.getByTestId('fields-status').innerText(), /Рост/)
    assert.match(await page.getByTestId('fields-status').innerText(), /82%|100%/)
    await page.evaluate(() => window.__setLang('en'))
    assert.match(await page.getByTestId('lab-bench').innerText(), /TRAINING BENCH · NOT A WALLET ACCOUNT/)
    assert.match(await page.getByTestId('fields-status').innerText(), /Growing/)
    await page.evaluate(() => window.__setLang('ru'))
    assert.match(await page.getByTestId('lab-bench').innerText(), /УЧЕБНЫЙ СТЕНД/)
    await page.locator('.mf-canvas-host canvas').evaluate(canvas => canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext())
    await page.getByTestId('fields-fallback').waitFor()
    await page.locator('.mf-field-picker button').nth(1).press('Enter')
    assert.equal(await page.locator('.mf-inspector').getAttribute('data-selected-id'), 'lab-bench-1')
    await noOverflow(page); await context.close()
    console.log('PASS field lab benches: real GLBs, tier/geometry selection, camera, glazing, training-bench inspector, language, context loss')
  }

  for (const width of [390, 320]) {
    const { page, context } = await open(width, { fallback: noWebgl })
    await page.getByRole('button', { name: /Поле 03 EPIC/ }).click()
    await page.getByRole('button', { name: 'Остекление', exact: true }).click()
    await shot(page, `mobile-${width}.png`)
    await page.getByRole('button', { name: 'Обзор сектора', exact: true }).click(); await noOverflow(page)
    await context.close(); console.log(`PASS ${width}px: tier selection, glazing, overview, no overflow`)
  }
  for (const flags of [{ fallback: true }, { breakModel: true }]) {
    const { page, context } = await open(390, flags)
    await page.locator('.mf-field-picker button').last().press('Enter')
    assert.equal(await page.locator('.mf-inspector').getAttribute('data-selected-id'), 'lab-bench-2')
    assert.equal(await page.getByTestId('lab-bench').getAttribute('data-tier'), '2')
    await page.getByRole('button', { name: 'Инженерный режим · SIM', exact: true }).click()
    await page.getByTestId('engineering-console').waitFor()
    await noOverflow(page); await context.close()
  }
  console.log('PASS no WebGL / failed model: keyboard selection and controls remain usable')

  // NO_WEBGL: the MainScreen callback check needs the 3D inspector; engineering-browser-smoke covers the same callbacks in fallback.
  if (!noWebgl) {
    // The actual MainScreen + FieldCardVice, with fake providers only. There is
    // no RPC or signing. Confirm every unchanged callback receives the selected
    // account public key, even after a polling-order change.
    const real = await open(390, { realMain: true, fallback: noWebgl })
    const keys = await real.page.evaluate(() => window.__fieldKeys)
    await real.page.locator('.mf-field-picker button').nth(1).click()
    assert.equal(await real.page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[1])
    assert.equal(await real.page.evaluate(() => window.__fieldCalls.length), 0)
    await real.page.evaluate(() => window.__reorderFields())
    for (const [label, action] of [['Апгрейд модуля', 'upgrade'], ['Собрать', 'harvest'], ['Полив', 'repair'], ['Пошлина', 'tax'], ['Питание +50% · 24ч', 'fertilizer']]) {
      const count = await real.page.evaluate(() => window.__fieldCalls.length)
      await real.page.locator('.mf-inspector').getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click()
      await real.page.waitForFunction(n => window.__fieldCalls.length === n + 1, count)
      assert.deepEqual(await real.page.evaluate(() => window.__fieldCalls.at(-1)), [action, keys[1]])
    }
    await real.page.getByRole('button', { name: 'Карточки', exact: true }).click()
    assert.equal(await real.page.locator('.mf-card-grid .plant-module-panel').count(), 2)
    if (!noWebgl) {
    await real.page.getByRole('button', { name: '3D-вид', exact: true }).click()
    await real.page.locator('[data-testid="fields-viewport"][data-ready="true"]').waitFor()
    assert.equal(await real.page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[1])
    }
    await real.page.evaluate(() => window.__removeSelected())
    assert.equal(await real.page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[0])
    await shot(real.page, 'main-390.png')
    await noOverflow(real.page); await real.context.close()
    console.log('PASS actual MainScreen: stable public-key selection, all 5 original action callbacks, cards, account removal (mock providers, no transactions)')
  }

  if (!noWebgl) { // 18 models load only when WebGL runs the 3D view
  assert.equal(successfulModels.size, 18)
  assert.ok([...successfulModels.values()].every(status => status === 200))
  }
  assert.deepEqual(external, [], 'no external RPC/wallet/font/model requests in the lab/fixture')
  assert.deepEqual(errors, [], 'no unexpected runtime, console or CSP errors')
  console.log('PASS production CSP, all 18 local models, no external requests or unexpected errors')
} finally {
  await browser.close(); fixture.dispose(); mainFixtureAssets.dispose()
}
