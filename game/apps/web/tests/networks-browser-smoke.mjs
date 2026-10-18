// Real standalone colony, no fake game providers. Enforce the production CSP.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH; this test never downloads a browser.')
const base = (process.env.COLONY_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
const screenshots = process.env.NETWORKS_SCREENSHOT_DIR
if (screenshots) mkdirSync(screenshots, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
const errors = [], external = []
try {
  for (const [width, forceFallback] of [[1440, false], [390, false], [320, true]]) {
    const fallback = forceFallback || process.env.NO_WEBGL === '1'
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && !(fallback && /Error creating WebGL context/.test(message.text()))) errors.push(message.text()) })
    page.on('request', request => { if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) external.push(request.url()) })
    await page.route('**/*', async route => {
      if (!route.request().isNavigationRequest()) return route.continue()
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
    })
    if (fallback) await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/.test(type) ? null : original.call(this, type, ...args) }
    })
    await page.goto(`${base}/colony`, { waitUntil: 'networkidle' })
    await page.locator(fallback ? '.colony-plan-fallback' : '[data-testid="colony-viewport"][data-ready="true"]').waitFor()
    await page.getByRole('button', { name: 'Networks', exact: true }).click()
    await page.getByTestId('network-panel').waitFor()
    const balance = async () => Number((await page.locator('.colony-resource-value').nth(4).innerText()).replace(/[^0-9.]/g, ''))
    assert.equal(await balance(), 1400)
    await page.getByLabel('Existing line', { exact: true }).selectOption({ label: 'Water supply · recycler-6 → greenhouse-5' })
    await page.getByRole('button', { name: 'Remove without CR refund', exact: true }).click()
    assert.equal(await balance(), 1400)
    assert.match(await page.getByTestId('module-service-status').innerText(), /— Water supply/)
    await page.getByRole('button', { name: '+1 day', exact: true }).click()
    assert.match(await page.getByTestId('crop-days').innerText(), /^60\.0 /, 'isolated greenhouse cannot grow')
    await page.getByLabel('Network type', { exact: true }).selectOption('water')
    await page.getByLabel('From module', { exact: true }).selectOption('recycler-6')
    await page.getByLabel('To module', { exact: true }).selectOption('greenhouse-5')
    assert.equal(await page.getByLabel('To module', { exact: true }).locator('option[value="solar-1"]').count(), 0)
    await page.getByRole('button', { name: 'Use waypoint · OFF', exact: true }).click()
    await page.getByRole('spinbutton', { name: 'Waypoint X', exact: true }).fill('23')
    await page.getByRole('spinbutton', { name: 'Waypoint Z', exact: true }).fill('23')
    assert.equal(await page.getByRole('button', { name: 'Install line', exact: true }).isDisabled(), true)
    assert.equal(await balance(), 1400)
    await page.getByRole('button', { name: 'Use waypoint · ON', exact: true }).click()
    await page.getByTestId('network-route-preview').waitFor({ state: 'attached' })
    const price = Number((await page.getByTestId('network-route-status').innerText()).match(/(\d+) CR/)[1])
    assert.ok(price > 0)
    if (screenshots) {
      await page.getByTestId('network-panel').screenshot({ path: join(screenshots, `editor-${width}.png`) })
      await page.getByTestId('colony-viewport').screenshot({ path: join(screenshots, `scene-${width}.png`) })
    }
    await page.getByRole('button', { name: 'Install line', exact: true }).click()
    assert.equal(await balance(), 1400 - price)
    assert.equal(await page.getByRole('button', { name: 'Install line', exact: true }).isDisabled(), true, 'no duplicate purchase')
    assert.match(await page.getByTestId('module-service-status').innerText(), /✓ Water supply/)
    await page.getByRole('button', { name: '+1 day', exact: true }).click()
    assert.match(await page.getByTestId('crop-days').innerText(), /^61\.0 /, 'reconnected greenhouse resumes growth')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const small = await page.getByTestId('network-panel').locator('button, select, input').evaluateAll(elements => elements.filter(e => {
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 43.9 || r.height < 43.9)
    }).map(e => e.textContent))
    assert.deepEqual(small, [], 'network controls must be at least 44px')
    await context.close()
    console.log(`PASS ${width}px${fallback ? ' without WebGL' : ''}: disconnect, no growth, free preview, waypoint rejection, paid reconnect, no duplicate, growth resumes, 44px controls`)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('PASS production CSP, no external requests or runtime errors')
} finally { await browser.close() }
