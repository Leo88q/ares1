// Production-CSP section art/nav tests. Actual V1 market callback fixture is
// test-only, with no RPC, wallet signing or real transactions.
// Песочница /demo удалена вместе с арт-просмотром: пульт секций и иллюстрации
// проверяются на отдельной фикстуре (настоящие AresBottomNav + SectionFrame).
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { marketArtFixture } from './market-art-fixture.mjs'
import { sectionNavFixture } from './section-nav-fixture.mjs'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH; this test never downloads a browser')
const base = (process.env.SECTIONS_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
assert.ok(csp)
const screenshots = process.env.SECTIONS_SCREENSHOT_DIR
if (screenshots) mkdirSync(screenshots, { recursive: true })
const fixture = await marketArtFixture()
const navFixture = await sectionNavFixture()
const assets = new Map([...fixture.assets, ...navFixture.assets])
const htmlPaths = new Set(['/__market-art/market', '/__nav/main'])
const NAV_KEYS = ['АГРО', 'ЛАБ', 'КОЛОНИЯ', 'СНАБ', 'ЖУРНАЛ', 'КАЮТА', 'ОПЕРАЦИЯ']
const NAV_KEYS_EN = ['AGRO', 'LAB', 'COLONY', 'SUPPLY', 'LOG', 'CABIN', 'OPERATION']
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
    const mocked = assets.get(url.pathname)
    if (mocked) return route.fulfill({ status: 200, contentType: mocked.type, body: mocked.bytes, headers: htmlPaths.has(url.pathname) ? { 'content-security-policy': csp } : {} })
    if (!request.isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
  })
  await page.goto(`${base}${market ? '/__market-art/market' : '/__nav/main'}`, { waitUntil: 'networkidle' })
  await page.locator(market ? '[data-testid="ship-section"]' : '[data-testid="nav-harness-body"]').waitFor()
  await noOverflow(page)
  return { page, context }
}
try {
  const { page, context } = await open(1440)
  for (const [label, section] of [['СНАБ', 'supply'], ['ЖУРНАЛ', 'journal'], ['КАЮТА', 'cabin']]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    const frame = page.getByTestId('ship-section')
    assert.equal(await frame.getAttribute('data-section'), section)
    await frame.locator('.ship-section-image').evaluate(image => image.decode())
    assert.equal(await frame.locator('.ship-section-image').evaluate(image => image.complete && image.naturalWidth > 1000), true)
    assert.equal(await page.locator('.hull-nav-key[aria-current="page"]').innerText().then(text => text.includes(label)), true)
    await noOverflow(page); await shot(page, `${section}-desktop.png`)
  }
  // Семь клавиш пульта: ЛАБ открывает продуктовую лабораторию /lab.
  assert.equal(await page.locator('.hull-nav-key').count(), 7)
  assert.equal(await page.locator('.ship-nav-icon').count(), 7)
  assert.equal(await page.locator('.ship-nav-icon').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true)
  for (const label of NAV_KEYS) assert.equal(await page.getByRole('button', { name: new RegExp(`^${label}`) }).count(), 1, `nav key ${label}`)
  for (const [label, tab] of [['АГРО', 'main'], ['ЛАБ', 'lab'], ['КОЛОНИЯ', 'colony'], ['СНАБ', 'market'], ['ЖУРНАЛ', 'stats'], ['КАЮТА', 'profile'], ['ОПЕРАЦИЯ', 'operation']]) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
    assert.equal(await page.evaluate(() => window.__navCalls.at(-1)), tab, `${label} must navigate to ${tab}`)
  }
  // Секции без собственного кадра (АГРО/ЛАБ/КОЛОНИЯ/ОПЕРАЦИЯ) не подменяют иллюстрацию.
  assert.equal(await page.getByTestId('ship-section').count(), 0)
  assert.equal(await page.getByTestId('nav-harness-body').isVisible(), true)
  // Подписи пульта реактивные: общий i18n-стор, без собственных кнопок языка.
  await page.evaluate(() => window.__setLang('en'))
  for (const label of NAV_KEYS_EN) assert.equal(await page.getByRole('button', { name: new RegExp(`^${label}`) }).count(), 1)
  await page.evaluate(() => window.__setLang('ru'))
  for (const label of NAV_KEYS) assert.equal(await page.getByRole('button', { name: new RegExp(`^${label}`) }).count(), 1)
  await page.getByRole('button', { name: /^СНАБ/ }).click()
  assert.equal(await page.getByTestId('ship-section').getAttribute('data-section'), 'supply')
  await context.close()
  console.log('PASS section illustrations, local images, seven image nav keys with route ids and RU/EN labels')

  for (const width of [400, 390, 360, 320]) {
    const { page, context } = await open(width)
    for (const [label, section] of [['СНАБ', 'supply'], ['ЖУРНАЛ', 'journal'], ['КАЮТА', 'cabin']]) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
      assert.equal(await page.getByTestId('ship-section').getAttribute('data-section'), section)
      await noOverflow(page); await shot(page, `${section}-${width}.png`)
    }
    // Семь клавиш в один ряд: тактильный минимум по высоте всегда, по ширине —
    // 44 px от 360 px и 40 px на самых узких экранах (уплотнённый пульт).
    const boxes = await page.locator('.hull-nav-key').evaluateAll(keys => keys.map(key => {
      const rect = key.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }))
    assert.equal(boxes.length, 7)
    const minWidth = width <= 340 ? 40 : 44
    for (const box of boxes) {
      assert.ok(box.height >= 44, `nav key height ${box.height} at ${width}px`)
      assert.ok(box.width >= minWidth, `nav key width ${box.width} at ${width}px`)
    }
    await context.close()
  }
  console.log('PASS section art and the seven-key bottom dock at 400/390/360/320px, no overflow')

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
} finally { await browser.close(); fixture.dispose(); navFixture.dispose() }
