// Run against a PRODUCTION build/preview so the shipped CSP is enforced.
// CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:colony-browser
// Optional COLONY_BASE_URL, CHROMIUM_ARGS_JSON, COLONY_SCREENSHOT_DIR.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import * as THREE from 'three'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH to an installed Chromium binary; this test never downloads a browser.')
const base = (process.env.COLONY_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
assert.ok(csp)
const screenshots = process.env.COLONY_SCREENSHOT_DIR
// NO_WEBGL=1: run only the 2D fallback path (no 3D canvas, no GLB responses). For sandboxes without WebGL; CI runs the full suite.
const noWebgl = process.env.NO_WEBGL === '1'
if (screenshots) mkdirSync(screenshots, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
const errors = [], external = [], modelResponses = []

async function createPage(width, locale = 'en-US', fallback = false) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && !((fallback || noWebgl) && /Error creating WebGL context/.test(message.text()))) errors.push(message.text())
  })
  page.on('request', request => { if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) external.push(request.url()) })
  page.on('response', response => { if (/\/models\/colony\/.+\.glb$/.test(response.url())) modelResponses.push([response.url(), response.status()]) })
  // Vite preview does not apply Cloudflare's _headers; emulate them faithfully
  // on the shell, without weakening script-src, connect-src, or image policy.
  await page.route('**/*', async route => {
    if (!route.request().isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
  })
  if (fallback || noWebgl) await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /webgl/.test(type) ? null : getContext.call(this, type, ...args)
    }
  })
  await page.goto(`${base}/colony`, { waitUntil: 'networkidle' })
  if (!fallback && !noWebgl) await page.locator('[data-testid="colony-viewport"][data-ready="true"]').waitFor()
  return { page, context }
}
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow')
const day = async (page, expected) => assert.equal((await page.getByTestId('colony-day').innerText()).trim(), String(expected).padStart(3, '0'))
const balance = async (page, expected) => assert.equal((await page.locator('.colony-resource-value').nth(4).innerText()).replace(/\s/g, ''), `${expected}CR`)
const screenshot = async (page, file) => { if (screenshots) { await page.screenshot({ path: join(screenshots, file), fullPage: true }); await page.getByTestId('colony-viewport').screenshot({ path: join(screenshots, `scene-${file}`) }) } }

try {
  if (!noWebgl) {
    const { page, context } = await createPage(1440)
    await noOverflow(page); await day(page, 0); await balance(page, 1400)
    assert.equal(await page.locator('.colony-model-error').count(), 0, 'all embedded textures must load under production CSP')
    assert.equal(await page.locator('.colony-canvas-host canvas').count(), 1)
    await page.getByRole('button', { name: 'Rotate camera right 90°', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.colony-canvas-host canvas')?.dataset.yaw === '1')
    await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
    assert.equal(await page.locator('.colony-canvas-host canvas').getAttribute('data-yaw'), '0')

    await screenshot(page, 'desktop.png')
    await page.getByRole('button', { name: 'RU', exact: true }).click()
    await page.getByRole('button', { name: '+1 день', exact: true }).waitFor()
    await page.getByRole('button', { name: 'EN', exact: true }).click()
    await day(page, 0); await balance(page, 1400) // language switches do not reset/mutate resources
    await page.getByRole('button', { name: 'Add: Solar bank · 120 CR', exact: true }).click()
    await balance(page, 1400) // preview cannot spend
    // A tap in 3D chooses a ground cell, not a module, while building.
    const canvas = page.locator('.colony-canvas-host canvas'), rect = await canvas.boundingBox()
    const aspect = rect.width / rect.height, halfWidth = Math.max(28, 18.5 * aspect)
    const projection = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfWidth / aspect, -halfWidth / aspect, 0.1, 250)
    projection.position.set(29, 32, 37); projection.lookAt(0, 0, 0); projection.zoom = 1.15
    projection.updateProjectionMatrix(); projection.updateMatrixWorld()
    const hit = new THREE.Vector3((16.5 - 24) * 2.4, 0, (19.5 - 24) * 2.4).project(projection)
    await canvas.click({ position: { x: (hit.x + 1) / 2 * rect.width, y: (1 - hit.y) / 2 * rect.height } })
    assert.equal(await page.getByRole('spinbutton', { name: 'Cell X', exact: true }).inputValue(), '16')
    assert.equal(await page.getByRole('spinbutton', { name: 'Cell Z', exact: true }).inputValue(), '19')
    await page.getByRole('spinbutton', { name: 'Cell X', exact: true }).fill('15')
    await page.getByRole('spinbutton', { name: 'Cell Z', exact: true }).fill('18')
    assert.equal(await page.getByRole('button', { name: 'Confirm placement', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Cancel placement', exact: true }).click()
    await balance(page, 1400)
    assert.equal(await page.locator('.colony-module-selector button').count(), 8)
    await page.getByRole('button', { name: 'Add: Solar bank · 120 CR', exact: true }).click()
    await page.getByRole('spinbutton', { name: 'Cell X', exact: true }).fill('40')
    await page.getByRole('spinbutton', { name: 'Cell Z', exact: true }).fill('40')
    await page.getByRole('button', { name: 'Rotate · 0°', exact: true }).click()
    await screenshot(page, 'placement-preview.png')
    await noOverflow(page)
    await page.getByRole('button', { name: 'Confirm placement', exact: true }).click()
    await balance(page, 1280)
    assert.equal(await page.locator('.colony-module-selector button').count(), 9)
    assert.match(await page.locator('.colony-inspector h2').innerText(), /X40 Z40/)
    await page.getByRole('button', { name: 'Relocate module', exact: true }).click()
    await page.getByRole('spinbutton', { name: 'Cell X', exact: true }).fill('44')
    await page.getByRole('spinbutton', { name: 'Cell Z', exact: true }).fill('44')
    await page.getByRole('button', { name: 'Confirm placement', exact: true }).click()
    await balance(page, 1280) // relocation never buys or resets a module
    assert.match(await page.locator('.colony-inspector h2').innerText(), /X44 Z44/)
    await page.getByRole('button', { name: '+1 day', exact: true }).click(); await day(page, 1)
    await page.getByRole('button', { name: '+7 days', exact: true }).click(); await day(page, 8)
    await page.getByRole('button', { name: 'Logistics', exact: true }).click()
    await page.getByRole('button', { name: 'Service all modules', exact: false }).click(); await balance(page, 1260)
    await page.getByRole('button', { name: 'Request supplies', exact: false }).click(); await balance(page, 1180)
    await page.getByRole('button', { name: /^Deliver 10\.0 kg/ }).click(); await balance(page, 1220)
    await page.getByRole('slider', { name: 'Effective sun', exact: true }).press('Home')
    await page.getByRole('button', { name: '+1 day', exact: true }).click(); await day(page, 9)
    assert.match(await page.locator('.colony-status').innerText(), /Energy deficit/)
    await page.getByRole('button', { name: 'Resource economy', exact: true }).click()
    await page.getByRole('slider', { name: 'Water recovery target', exact: true }).press('End')
    assert.match(await page.locator('.colony-scenario').innerText(), /98%/)
    await page.getByRole('button', { name: '3D library', exact: true }).click()
    assert.equal(await page.locator('.colony-asset-card').count(), 14)
    await page.getByRole('button', { name: 'Colony', exact: true }).click()
    await page.locator('[data-testid="colony-viewport"][data-ready="true"]').waitFor()
    await page.getByRole('button', { name: 'New expedition', exact: true }).click(); await day(page, 0); await balance(page, 1400)
    await page.getByRole('button', { name: 'Build', exact: true }).click()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '+1 day', exact: true }).isDisabled(), true)
    // User actions are allowed during autorun; they must not overwrite clock ticks.
    await page.getByRole('button', { name: 'Add: Solar bank · 120 CR', exact: true }).click(); await balance(page, 1400)
    await page.getByRole('button', { name: 'Confirm placement', exact: true }).click(); await balance(page, 1280)
    // Construction deliberately pauses the clock; restart it after confirming.
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="colony-day"]')?.textContent !== '000')
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.getByRole('button', { name: 'Run', exact: true }).waitFor() // hidden tabs pause
    // Explicit context loss must leave the financial/resource controls usable.
    await page.locator('canvas').evaluate(canvas => canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext())
    await page.locator('.colony-plan-fallback').waitFor()
    await noOverflow(page)
    await context.close()
    console.log('PASS desktop: construction, clock, servicing, supplies, finite order, darkness, tabs, reset, run/pause, context loss')

    for (const width of [390, 320]) {
      const { page, context } = await createPage(width, 'ru-RU')
      await noOverflow(page)
      await screenshot(page, `mobile-${width}.png`)
      for (const label of ['Ресурсная экономика', '3D-библиотека', 'Колония']) {
        await page.getByRole('button', { name: label, exact: true }).click(); await noOverflow(page)
      }
      await page.getByRole('button', { name: 'Добавить: Солнечный массив · 120 CR', exact: true }).click()
      await page.getByTestId('construction-plan').waitFor()
      await noOverflow(page)
      await screenshot(page, `placement-${width}.png`)
      await page.getByRole('button', { name: 'Отменить размещение', exact: true }).click()
      await balance(page, 1400)
      await page.getByRole('button', { name: '+1 день', exact: true }).click(); await day(page, 1)
      await context.close()
      console.log(`PASS ${width}px RU: all views fit, manual stepping works`)
    }
  }
  const fallback = await createPage(390, 'en-US', true)
  await fallback.page.locator('.colony-plan-fallback').waitFor()
  await fallback.page.getByRole('button', { name: '+1 day', exact: true }).click(); await day(fallback.page, 1)
  await fallback.page.getByRole('button', { name: 'Add: Solar bank · 120 CR', exact: true }).click(); await balance(fallback.page, 1400)
  await fallback.page.getByRole('button', { name: 'Confirm placement', exact: true }).click(); await balance(fallback.page, 1280)
  assert.equal(await fallback.page.locator('.colony-plan-grid button').count(), 9)
  await fallback.page.locator('.colony-plan-grid button').first().press('Enter')
  assert.match(await fallback.page.locator('.colony-inspector h2').innerText(), /^Solar bank\s+X15 Z18$/)
  await noOverflow(fallback.page)
  await fallback.context.close()
  console.log('PASS no WebGL: interactive 2D plan, stepping and construction')

  assert.deepEqual(external, [], 'standalone colony must not call RPC, wallets, marketplaces or external fonts')
  if (!noWebgl) {
    assert.ok(modelResponses.length >= 14)
    assert.ok(modelResponses.every(([, status]) => status === 200), JSON.stringify(modelResponses))
  }
  assert.equal(errors.length, 0, `browser console/page/CSP errors (${errors.length}):\n${errors.slice(0, 6).join('\n')}`)
  console.log('PASS production CSP, all GLB responses, no external requests, no runtime errors')
} finally {
  await browser.close()
}
