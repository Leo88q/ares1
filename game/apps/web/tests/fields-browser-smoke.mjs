// Production-CSP UI test for the live 3D field view and real field actions.
// Installed browser only; no external wallet/RPC or transaction is used.
// CHROMIUM_EXECUTABLE_PATH=... [FIELDS_BASE_URL=...] yarn workspace web test:fields-browser
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
const noWebgl = process.env.NO_WEBGL === '1'
if (screenshots) mkdirSync(screenshots, { recursive: true })
const lab = await labFixture({ connected: true, fields: 3, slug: 'lab-live-fields' })
const main = await mainFixture()
const assets = new Map([...lab.assets, ...main.assets])
const htmlPaths = new Set(['/__lab-live-fields/main', '/__fields/main'])
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
    if (noWebgl && /WebGL/.test(message.text())) return
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
    if (mocked) return route.fulfill({ status: 200, contentType: mocked.type, body: mocked.bytes, headers: htmlPaths.has(url.pathname) ? { 'content-security-policy': csp } : {} })
    if (breakModel && url.pathname === '/models/fields/canopy.glb') return route.fulfill({ status: 503, body: 'Model unavailable' })
    if (!request.isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
  })
  if (fallback) await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/.test(type) ? null : getContext.call(this, type, ...args) }
  })
  await page.goto(`${base}${realMain ? '/__fields/main' : '/__lab-live-fields/main'}`, { waitUntil: 'networkidle' })
  if (!realMain) await page.getByTestId('field-lab').waitFor()
  await page.locator(fallback || breakModel ? '[data-testid="fields-fallback"]' : '[data-testid="fields-viewport"][data-ready="true"]').waitFor()
  await noOverflow(page)
  return { page, context }
}

try {
  if (!noWebgl) {
    const { page, context } = await open(1440)
    const keys = await page.evaluate(() => window.__fieldKeys)
    assert.equal(await page.locator('.mf-field-picker button').count(), 3)
    assert.equal(await page.locator('.mf-canvas-host canvas').count(), 1)
    const cameraCanvas = page.locator('.mf-canvas-host canvas')
    await page.getByRole('button', { name: 'Камера вправо на 90°', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.mf-canvas-host canvas')?.dataset.yaw === '1')
    await page.getByRole('button', { name: 'Вернуть камеру', exact: true }).click()
    assert.equal(await cameraCanvas.getAttribute('data-yaw'), '0')

    await page.locator('.mf-field-picker button').nth(2).click()
    assert.equal(await page.getByTestId('fields-viewport').getAttribute('data-selected-id'), keys[2])
    await page.getByRole('button', { name: 'Остекление', exact: true }).click()
    await shot(page, 'desktop-field-03.png')
    await page.getByRole('button', { name: 'Обзор сектора', exact: true }).click()
    await shot(page, 'desktop-sector.png')
    const rect = await page.locator('.mf-canvas-host canvas').boundingBox()
    const camera = new THREE.OrthographicCamera(-25 * rect.width / rect.height, 25 * rect.width / rect.height, 25, -25, 0.1, 180)
    camera.position.set(30, 30, 34); camera.lookAt(0, 0.6, 0); camera.updateMatrixWorld()
    const point = new THREE.Vector3(-13, 0.3, 0).project(camera)
    await page.locator('.mf-canvas-host canvas').click({ position: { x: (point.x + 1) / 2 * rect.width, y: (1 - point.y) / 2 * rect.height } })
    await page.waitForFunction(keys => keys.includes(document.querySelector('[data-testid="fields-viewport"]')?.getAttribute('data-selected-id')), keys)
    assert.equal(await page.getByTestId('lab-bench').count(), 0)
    assert.equal(await page.getByRole('button', { name: /SIM|пауза|pause/i }).count(), 0)
    await page.evaluate(() => window.__setLang('en'))
    assert.match(await page.locator('.mf-field-picker').innerText(), /Field/)
    await page.evaluate(() => window.__setLang('ru'))
    await page.locator('.mf-canvas-host canvas').evaluate(canvas => canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext())
    await page.getByTestId('fields-fallback').waitFor()
    await page.locator('.mf-field-picker button').nth(1).press('Enter')
    assert.equal(await page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[1])
    await noOverflow(page); await context.close()
    console.log('PASS live field 3D: camera, account selection, geometry hit testing, local GLB art, language and context-loss fallback')
  }

  for (const width of [390, 320]) {
    const { page, context } = await open(width, { fallback: noWebgl })
    await page.locator('.mf-field-picker button').nth(2).click()
    await page.getByRole('button', { name: 'Остекление', exact: true }).click()
    await shot(page, `mobile-${width}.png`)
    await page.getByRole('button', { name: 'Обзор сектора', exact: true }).click()
    await noOverflow(page); await context.close()
    console.log(`PASS ${width}px: field selection, roof and overview controls, no overflow`)
  }

  for (const flags of [{ fallback: true }, { breakModel: true }]) {
    const { page, context } = await open(390, flags)
    await page.locator('.mf-field-picker button').last().press('Enter')
    assert.equal(await page.getByTestId('lab-bench').count(), 0)
    assert.equal(await page.getByRole('button', { name: /SIM|пауза|pause/i }).count(), 0)
    await noOverflow(page); await context.close()
  }
  console.log('PASS no WebGL / failed model: real field selectors remain usable with no demo controls')

  // MainScreen callback test uses mock providers only: no signature or RPC.
  if (!noWebgl) {
    const real = await open(390, { realMain: true })
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
    await real.page.getByRole('button', { name: '3D-вид', exact: true }).click()
    await real.page.locator('[data-testid="fields-viewport"][data-ready="true"]').waitFor()
    assert.equal(await real.page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[1])
    await real.page.evaluate(() => window.__removeSelected())
    assert.equal(await real.page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[0])
    await shot(real.page, 'main-390.png')
    await noOverflow(real.page); await real.context.close()
    console.log('PASS live Agro: stable public-key selection and existing field action callbacks (mock providers)')
  }

  if (!noWebgl) {
    assert.equal(successfulModels.size, 18)
    assert.ok([...successfulModels.values()].every(status => status === 200))
  }
  assert.deepEqual(external, [], 'no external RPC/wallet/font/model requests')
  assert.deepEqual(errors, [], 'no unexpected runtime, console or CSP errors')
  console.log('PASS production CSP, local field models, no external requests or unexpected errors')
} finally {
  await browser.close()
  lab.dispose()
  main.dispose()
}
