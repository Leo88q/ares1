// Production-CSP section art/nav tests. Actual V1 market callback fixture is
// test-only, with no RPC, wallet signing or real transactions.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { marketArtFixture } from './market-art-fixture.mjs'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH; this test never downloads a browser')
const base = (process.env.SECTIONS_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
assert.ok(csp)
const screenshots = process.env.SECTIONS_SCREENSHOT_DIR
if (screenshots) mkdirSync(screenshots, { recursive: true })
const fixture = await marketArtFixture()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
const errors = [], outside = []
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow')
async function shot(page, name) { if (screenshots) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.screenshot({ path: join(screenshots, name), fullPage: true }) } }
async function open(width, market = false) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ru-RU', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin && !/^(data|blob):/.test(request.url())) { outside.push(request.url()); return route.abort() }
    const mocked = fixture.assets.get(url.pathname)
    if (market && mocked) return route.fulfill({ status: 200, contentType: mocked.type, body: mocked.bytes, headers: url.pathname === '/__market-art/market' ? { 'content-security-policy': csp } : {} })
    if (!request.isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
  })
  await page.goto(`${base}${market ? '/__market-art/market' : '/demo'}`, { waitUntil: 'networkidle' })
  if (!market) await page.locator('[data-testid="fields-viewport"][data-ready="true"]').waitFor()
  await noOverflow(page)
  return { page, context }
}
try {
  const { page, context } = await open(1440)
  await page.getByRole('button', { name: '+1 сол', exact: true }).click()
  const hour = await page.getByTestId('lab-hour').innerText()
  for (const [label, section, href] of [['СНАБ', 'supply', '/market'], ['ЖУРНАЛ', 'journal', '/stats'], ['КАЮТА', 'cabin', '/profile']]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    const frame = page.getByTestId('ship-section')
    assert.equal(await frame.getAttribute('data-section'), section)
    await frame.locator('.ship-section-image').evaluate(image => image.decode())
    assert.equal(await frame.locator('.ship-section-image').evaluate(image => image.complete && image.naturalWidth > 1000), true)
    assert.match(await page.getByTestId('section-art-preview').innerText(), /БЕЗ АККАУНТОВ И ТРАНЗАКЦИЙ/)
    assert.equal(await page.getByRole('link', { name: 'Открыть настоящий раздел →', exact: true }).getAttribute('href'), href)
    assert.equal(await page.locator('.hull-nav-key[aria-current="page"]').innerText().then(text => text.includes(label)), true)
    await noOverflow(page); await shot(page, `${section}-desktop.png`)
  }
  assert.equal(await page.locator('.ship-nav-icon').count(), 6)
  assert.equal(await page.locator('.ship-nav-icon').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true)
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  for (const label of ['AGRO', 'COLONY', 'SUPPLY', 'LOG', 'CABIN', 'OPERATION']) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 1)
  await page.getByRole('button', { name: 'RU', exact: true }).click()
  await page.getByRole('button', { name: 'АГРО', exact: true }).click()
  await page.locator('[data-testid="fields-viewport"][data-ready="true"]').waitFor()
  assert.equal(await page.getByTestId('lab-hour').innerText(), hour, 'art section switching must not reset field session')
  await context.close()
  console.log('PASS section illustrations, local images, real route links, image navigation and RU/EN labels, preserved farm session')

  for (const width of [390, 320]) {
    const { page, context } = await open(width)
    for (const [label, section] of [['СНАБ', 'supply'], ['ЖУРНАЛ', 'journal'], ['КАЮТА', 'cabin']]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      assert.equal(await page.getByTestId('ship-section').getAttribute('data-section'), section)
      await noOverflow(page); await shot(page, `${section}-${width}.png`)
    }
    await context.close()
  }
  console.log('PASS section art and bottom dock at 390/320px, no overflow')

  const market = await open(390, true)
  const ids = await market.page.evaluate(() => window.__artOrderIds)
  assert.equal(await market.page.getByTestId('ship-section').getAttribute('data-section'), 'supply')
  assert.equal(await market.page.getByTestId('ship-section').locator('.ship-section-image').evaluate(image => image.complete && image.naturalWidth > 0), true)
  await market.page.getByRole('button', { name: /^Купить за/ }).click()
  assert.deepEqual(await market.page.evaluate(() => window.__artOrderCalls.at(-1)), ['fill', ids[0]])
  await market.page.getByRole('tab', { name: /^Мои ордера/ }).click()
  await market.page.getByRole('button', { name: 'Отменить ордер', exact: true }).click()
  await market.page.getByRole('button', { name: 'Отменить', exact: true }).click()
  assert.deepEqual(await market.page.evaluate(() => window.__artOrderCalls.at(-1)), ['cancel', ids[1]])
  await market.page.getByRole('button', { name: 'Понятно', exact: true }).click()
  await market.page.getByRole('button', { name: 'Отгрузить', exact: true }).click()
  await market.page.getByLabel('Количество POTATO', { exact: true }).fill('100')
  await market.page.getByLabel('Цена за 1 POTATO (SOL)', { exact: true }).fill('0.002')
  await market.page.getByRole('button', { name: 'Оформить ордер', exact: true }).click()
  await market.page.waitForFunction(() => window.__artOrderCalls.some(call => call[0] === 'create'))
  assert.deepEqual(await market.page.evaluate(() => window.__artOrderCalls.at(-1)), ['create', 100, 0.002])
  assert.equal(await market.page.evaluate(() => window.__artOrderCalls.length), 3)
  await shot(market.page, 'actual-market-390.png'); await noOverflow(market.page); await market.context.close()
  console.log('PASS actual V1 MarketScreen/CreateOrderModal with mocked providers: same fill/cancel keys and create amount/price, no signing/RPC')
  assert.deepEqual(errors, []); assert.deepEqual(outside, [])
  console.log('PASS production CSP, no unexpected console/page errors or external requests')
} finally { await browser.close(); fixture.dispose() }
