// Browser smoke for the shipped Field Lab: production CSP, mocked account data,
// no wallet/RPC/transactions. The obsolete SIM console is intentionally absent
// from the shipped app, so this suite exercises the live field view and fallback.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { labFixture } from './lab-fixture.mjs'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH; this test never downloads a browser')
const base = (process.env.ENGINEERING_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
assert.ok(csp)
const screenshots = process.env.ENGINEERING_SCREENSHOT_DIR
// NO_WEBGL=1: every field view opens in its 2D fallback (sandboxes without WebGL).
const noWebgl = process.env.NO_WEBGL === '1'
if (screenshots) mkdirSync(screenshots, { recursive: true })
const fixture = await labFixture({ connected: true, fields: 3, slug: 'lab-bench' })
const errors = [], outside = [], modelResponses = []
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
const screenshot = async (page, filename) => {
  if (!screenshots) return
  await page.screenshot({ path: join(screenshots, filename), fullPage: true })
}
async function open(width, { fallback = false, failModel = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ru-RU', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.url().includes('/models/fields/') && response.url().endsWith('.glb')) modelResponses.push([response.url(), response.status()])
  })
  page.on('console', message => {
    if (message.type() !== 'error') return
    if ((noWebgl || fallback) && /WebGL/.test(message.text())) return
    if (failModel && /\/models\/fields\//.test(message.location().url)) return
    errors.push(message.text())
  })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin && !/^(data|blob):/.test(request.url())) { outside.push(request.url()); return route.abort() }
    const mocked = fixture.assets.get(url.pathname)
    if (mocked) return route.fulfill({ status: 200, contentType: mocked.type, body: mocked.bytes, headers: url.pathname === '/__lab-bench/main' ? { 'content-security-policy': csp } : {} })
    if (failModel && url.pathname === '/models/fields/canopy.glb') return route.fulfill({ status: 503, body: 'Unavailable' })
    if (!request.isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
  })
  if (fallback) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/.test(type) ? null : original.call(this, type, ...args) }
  })
  await page.goto(`${base}/__lab-bench/main`, { waitUntil: 'networkidle' })
  await page.getByTestId('field-lab').waitFor()
  await page.getByTestId('fields-panel').waitFor()
  if (fallback || failModel || noWebgl) {
    await page.getByTestId('fields-fallback').waitFor()
  } else {
    const outcome = await Promise.race([
      page.locator('[data-testid="fields-viewport"][data-ready="true"]').waitFor({ timeout: 30000 }).then(() => 'ready').catch(() => 'timeout'),
      page.locator('[data-testid="fields-fallback"]').waitFor({ timeout: 30000 }).then(() => 'fallback').catch(() => 'timeout'),
    ])
    if (outcome !== 'ready') {
      const fallbackText = await page.locator('[data-testid="fields-fallback"]').allInnerTexts()
      const summary = (await page.getByTestId('field-lab').innerText()).slice(0, 1800)
      throw new Error(`Field viewport ${outcome}; fallback: ${JSON.stringify(fallbackText)}; model responses: ${JSON.stringify(modelResponses)}; runtime errors: ${errors.join(' | ')}; page summary: ${summary}`)
    }
  }
  return { page, context }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
try {
  const { page, context } = await open(1440, { fallback: noWebgl })
  const fields = page.locator('.mf-field-picker button')
  assert.equal(await fields.count(), 3)
  assert.equal(await page.getByTestId('fields-viewport').getAttribute('data-scene'), 'greenhouse-interior')
  if (!noWebgl) assert.equal(await page.getByTestId('fields-viewport').getAttribute('data-ready'), 'true')
  assert.equal(await page.locator('.mf-stage-art').count(), 0, 'no mismatched perspective artwork below the 3D room')
  assert.ok(await page.locator('.mf-resource-icon').count() >= 8)
  assert.equal(await page.locator('.mf-resource-icon').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true)
  const secondId = await fields.nth(1).getAttribute('data-field-id')
  await fields.nth(1).click()
  assert.equal(await page.locator('.mf-inspector').getAttribute('data-selected-id'), secondId)
  assert.equal(await page.getByTestId('fields-viewport').getAttribute('data-selected-id'), secondId)
  await page.getByRole('button', { name: /Карточки|Cards/ }).click()
  assert.equal(await page.locator('.mf-card-grid').count(), 1)
  assert.equal(await page.locator('.mf-card-grid .plant-module-panel').count(), 3)
  await page.getByRole('button', { name: /3D/ }).click()
  await screenshot(page, 'engineering-initial.png')
  await noOverflow(page)
  await context.close()
  console.log('PASS Field Lab: connected field list, 3D readiness, selection, card view and resource art')

  for (const width of [390, 320]) {
    const { page, context } = await open(width, { fallback: noWebgl })
    assert.equal(await page.locator('.mf-field-picker button').count(), 3)
    await page.locator('.mf-field-picker button').last().click()
    assert.equal(await page.locator('.mf-inspector').getAttribute('data-selected-id'), await page.locator('.mf-field-picker button').last().getAttribute('data-field-id'))
    await noOverflow(page)
    await screenshot(page, `engineering-${width}.png`)
    await context.close()
  }
  console.log('PASS responsive Field Lab at 390px and 320px')

  for (const flags of [{ fallback: true }, { failModel: true }]) {
    const { page, context } = await open(390, flags)
    assert.ok(await page.getByTestId('fields-fallback').isVisible())
    assert.equal(await page.locator('.mf-field-picker button').count(), 3)
    await page.locator('.mf-field-picker button').last().click()
    await page.getByRole('button', { name: /Карточки|Cards/ }).click()
    assert.equal(await page.locator('.mf-card-grid').count(), 1)
    await noOverflow(page)
    await context.close()
  }
  console.log('PASS WebGL and model-error fallbacks preserve field selection and cards')
  assert.deepEqual(outside, [])
  assert.deepEqual(errors, [])
  console.log(`PASS CSP, no external requests or browser errors; ${modelResponses.length} field models loaded`)
} finally {
  await browser.close()
  fixture.dispose()
}
