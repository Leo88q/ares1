// Product Lab smoke: real account data and controls only; no local benches or pauseable sim.
// CHROMIUM_EXECUTABLE_PATH=... [LAB_BASE_URL=...] yarn workspace web test:lab-browser
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { labFixture } from './lab-fixture.mjs'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH; this test never downloads a browser')
const base = (process.env.LAB_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
assert.ok(csp)
const screenshots = process.env.LAB_SCREENSHOT_DIR
const noWebgl = process.env.NO_WEBGL === '1'
if (screenshots) mkdirSync(screenshots, { recursive: true })

const liveFixture = await labFixture({ connected: true, slug: 'lab-live' })
const emptyFixture = await labFixture({ connected: false, slug: 'lab-empty' })
const assets = new Map([...liveFixture.assets, ...emptyFixture.assets])
const htmlPaths = new Set(['/__lab-live/main', '/__lab-empty/main'])
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
const errors = [], outside = []
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow')
const shot = async (page, name) => { if (screenshots) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.screenshot({ path: join(screenshots, name), fullPage: true }) } }
const readTile = (page, label) => page.locator('[data-testid="lab-live"] .lab-tile').filter({ hasText: label }).innerText()

async function open(width, { connected = true, fallback = false } = {}) {
  const slug = connected ? 'lab-live' : 'lab-empty'
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ru-RU', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (noWebgl && /WebGL/.test(message.text())) return
    if (fallback && /WebGL context could not be created|Error creating WebGL context/.test(message.text())) return
    errors.push(message.text())
  })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin && !/^(data|blob):/.test(request.url())) { outside.push(request.url()); return route.abort() }
    const mocked = assets.get(url.pathname)
    if (mocked) return route.fulfill({ status: 200, contentType: mocked.type, body: mocked.bytes, headers: htmlPaths.has(url.pathname) ? { 'content-security-policy': csp } : {} })
    if (!request.isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
  })
  if (fallback) await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/.test(type) ? null : getContext.call(this, type, ...args) }
  })
  await page.goto(`${base}/__${slug}/main`, { waitUntil: 'networkidle' })
  await page.getByTestId('field-lab').waitFor()
  await page.getByTestId('lab-live').waitFor()
  await noOverflow(page)
  return { page, context }
}

try {
  // Connected wallet: displayed values come from the mocked account/config, and
  // all field mutations call the existing GameContext callbacks.
  const desktop = await open(1440)
  const { page } = desktop
  const keys = await page.evaluate(() => window.__fieldKeys)
  assert.equal(keys.length, 2)
  assert.equal(await page.locator('[data-testid="lab-live"] .lab-tile').count(), 4)
  assert.match(await readTile(page, 'БАЛАНС POTATO'), /POTATO/)
  assert.match(await readTile(page, 'БАЛАНС SKR'), /SKR/)
  assert.match(await readTile(page, 'ПОЛЯ КОШЕЛЬКА'), /2/)
  assert.doesNotMatch(await readTile(page, 'РАСЧЁТНЫЙ ВЫХОД ПОЛЕЙ В ДЕНЬ'), /—/)
  assert.equal(await page.getByTestId('lab-market-book').count(), 1)
  assert.equal(await page.locator('[data-testid="lab-colony-link"]').count(), 0)
  await page.getByTestId('fields-viewport').waitFor()
  await shot(page, 'lab-desktop.png')

  await page.locator('.mf-field-picker button').nth(1).click()
  assert.equal(await page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[1])
  assert.equal(await page.evaluate(() => window.__fieldCalls.length), 0)
  await page.locator('.mf-inspector').getByRole('button', { name: /^Собрать/ }).click()
  await page.waitForFunction(() => window.__fieldCalls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.__fieldCalls.at(-1)), ['harvest', keys[1]])
  await page.evaluate(() => window.__reorderFields())
  assert.equal(await page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[1], 'selection follows the wallet account key')
  await page.evaluate(() => window.__reorderFields())
  assert.equal(await page.getByTestId('lab-bench').count(), 0)
  assert.equal(await page.getByTestId('lab-supply').count(), 0)
  assert.equal(await page.getByRole('button', { name: /SIM|пауза|pause/i }).count(), 0)
  await desktop.context.close()
  console.log('PASS connected Lab: account fields, on-chain calculations, market book and existing harvest callback')

  // No wallet: no invented fields, market book, bench, local stock or purchase form.
  const empty = await open(1440, { connected: false })
  assert.equal(await empty.page.locator('.mf-field-picker button').count(), 0)
  assert.equal(await empty.page.getByTestId('lab-market-book').count(), 0)
  assert.equal(await empty.page.getByTestId('lab-empty-state').count(), 1)
  assert.match(await empty.page.getByTestId('lab-empty-state').innerText(), /ПОДКЛЮЧИ КОШЕЛЁК/)
  assert.equal(await empty.page.getByTestId('lab-bench').count(), 0)
  assert.equal(await empty.page.locator('input, form').count(), 0)
  assert.equal(await empty.page.getByRole('button', { name: /SIM|пауза|pause/i }).count(), 0)
  await shot(empty.page, 'lab-no-wallet.png')
  await empty.context.close()
  console.log('PASS no-wallet Lab: truthful empty state and no training/demo fallback')

  // Mobile layout keeps all visible controls usable and never exposes a pauseable clock.
  for (const width of [400, 390, 360, 320]) {
    const mobile = await open(width, { fallback: noWebgl })
    assert.equal(await mobile.page.locator('[data-testid="lab-live"] .lab-tile').count(), 4)
    const small = await mobile.page.evaluate(() => [...document.querySelectorAll('[data-testid="field-lab"] button, [data-testid="field-lab"] a[href], [data-testid="field-lab"] input')]
      .filter(element => element.offsetParent !== null)
      .map(element => { const box = element.getBoundingClientRect(); return { size: `${Math.round(box.width)}x${Math.round(box.height)}`, label: (element.textContent || element.getAttribute('aria-label') || element.tagName).replace(/\s+/g, ' ').trim().slice(0, 40) } })
      .filter(item => parseFloat(item.size) < 44 || parseFloat(item.size.split('x')[1]) < 44))
    assert.deepEqual(small, [], `controls smaller than 44 px at ${width}px`)
    assert.equal(await mobile.page.getByRole('button', { name: /SIM|пауза|pause/i }).count(), 0)
    await shot(mobile.page, `lab-mobile-${width}.png`)
    await noOverflow(mobile.page)
    await mobile.context.close()
    console.log(`PASS ${width}px: live layout, 44 px controls, no pause/SIM or overflow`)
  }

  assert.deepEqual(outside, [], 'no external RPC/wallet/font/model requests in the Lab fixture')
  assert.deepEqual(errors, [], 'no unexpected runtime, console or CSP errors')
  console.log('PASS production CSP, no external requests, no unexpected errors')
} finally {
  await browser.close()
  liveFixture.dispose()
  emptyFixture.dispose()
}
