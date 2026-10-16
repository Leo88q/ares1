// Shared field engineering UI with production CSP, no wallets/RPC/transactions.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { mainFixture } from './fields-main-fixture.mjs'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH; this test never downloads a browser')
const base = (process.env.ENGINEERING_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
assert.ok(csp)
const screenshots = process.env.ENGINEERING_SCREENSHOT_DIR
if (screenshots) mkdirSync(screenshots, { recursive: true })
const fixture = await mainFixture()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
const errors = [], outside = []
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
const time = async page => parseFloat(await page.getByTestId('lab-hour').innerText())
async function actionButton(page, name) {
  const service = ['Новый сценарий SIM', 'Смоделировать поломку', 'Ремонт насоса SIM · 1 деталь', 'Перелить запас воды', 'Пылевой сценарий · 2 сола', 'Холодный сценарий · 2 сола']
  const control = ['Собрать еду SIM', 'Посадить SIM · 1 пакет', 'Освободить грядку SIM', 'Охлаждение: вкл.', 'Охлаждение: выкл.', 'Климат: авто', 'Климат: выключен', 'Защитить хранилище', 'Защитить посадку']
  if (service.includes(name)) await page.getByRole('button', { name: 'Сервис', exact: true }).click()
  else if (control.includes(name)) await page.getByRole('button', { name: 'Управление', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
}
async function climateSlider(page, key) {
  await page.getByRole('button', { name: 'Климат', exact: true }).click()
  await page.getByRole('slider', { name: 'Уставка термостата', exact: true }).press(key)
}

const screenshot = async (page, filename) => {
  if (!screenshots) return
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.screenshot({ path: join(screenshots, filename), fullPage: true })
}
async function open(width, { realMain = false, fallback = false, failModel = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ru-RU', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (fallback && /Error creating WebGL context/.test(message.text())) return
    if (failModel && /\/models\/fields\//.test(message.location().url)) return
    errors.push(message.text())
  })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin && !/^(data|blob):/.test(request.url())) { outside.push(request.url()); return route.abort() }
    const mocked = fixture.assets.get(url.pathname)
    if (realMain && mocked) return route.fulfill({ status: 200, contentType: mocked.type, body: mocked.bytes, headers: url.pathname === '/__fields/main' ? { 'content-security-policy': csp } : {} })
    if (failModel && url.pathname === '/models/fields/canopy.glb') return route.fulfill({ status: 503, body: 'Unavailable' })
    if (!request.isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
  })
  if (fallback) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /webgl/.test(type) ? null : original.call(this, type, ...args) }
  })
  await page.goto(`${base}${realMain ? '/__fields/main' : '/demo'}`, { waitUntil: 'networkidle' })
  await page.locator(fallback || failModel ? '[data-testid="fields-fallback"]' : '[data-testid="fields-viewport"][data-ready="true"]').waitFor()
  if (realMain) await page.getByRole('button', { name: 'Инженерный режим · SIM', exact: true }).click()
  await page.getByTestId('engineering-console').waitFor(); await noOverflow(page)
  return { page, context }
}
try {
  const { page, context } = await open(1440)
  assert.equal(await time(page), 0)
  assert.equal(await page.locator('.mf-stage-art').evaluate(image => image.complete && image.naturalWidth > 1000), true)
  assert.ok(await page.locator('.mf-resource-icon').count() >= 8)
  assert.equal(await page.locator('.mf-resource-icon').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true)
  assert.equal(await page.getByRole('button', { name: 'Телеметрия', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.eg-deck-pane:not([hidden])').count(), 1)
  await screenshot(page, 'engineering-initial.png')
  await actionButton(page, '+7 солов')
  assert.equal(await page.getByTestId('lab-stage').getAttribute('data-stage'), 'mature')
  await screenshot(page, 'engineering-grown.png')
  await actionButton(page, 'Собрать еду SIM')
  // WP11: +7 sols is 24.6 h after maturity → overripe factor 0.743 → 13.38 kg (window 80–120 %, overripeHours 240)
  assert.match(await page.getByTestId('lab-mass-ledger').innerText(), /13\.38 kg/)
  assert.equal(await page.getByRole('button', { name: 'Партии', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'Журнал', exact: true }).click()
  assert.match(await page.locator('.eg-deck-log').innerText(), /Собрана партия еды/)
  await page.getByRole('button', { name: 'Партии', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Собрать еду SIM', exact: true }).isDisabled(), true)
  await actionButton(page, 'Переработать до 5 кг')
  await page.getByTestId('lab-processing').waitFor()
  await actionButton(page, '+1 сол')
  assert.equal(await page.getByTestId('lab-processing').count(), 0)
  assert.match(await page.getByTestId('lab-mass-ledger').innerText(), /0\.75 kg/)
  await screenshot(page, 'engineering-processing.png')
  const firstHour = await time(page)
  await page.locator('.mf-field-picker button').last().click()
  assert.equal(await time(page), 0)
  await actionButton(page, '+1 ч')
  await page.locator('.mf-field-picker button').first().click()
  assert.equal(await time(page), firstHour)
  await actionButton(page, 'EN')
  assert.equal(await time(page), firstHour)
  assert.match(await page.getByTestId('lab-mass-ledger').innerText(), /0\.75 kg/)
  await actionButton(page, 'RU')
  await actionButton(page, 'Учебный урок')
  assert.equal(await page.getByTestId('engineering-console').count(), 0)
  await actionButton(page, 'Инженерный режим · SIM')
  assert.equal(await time(page), firstHour)
  // Storage age is independent of wallet tokens. No financial callback exists here.
  await actionButton(page, 'Охлаждение: вкл.')
  await actionButton(page, '+7 солов')
  // WP11: 13.38 harvested − 5 processed = 8.38 raw spoiled
  assert.match(await page.getByTestId('lab-mass-ledger').innerText(), /Испорчено: 8\.38 kg/)
  await actionButton(page, 'Новый сценарий SIM')
  assert.equal(await time(page), 0)
  await actionButton(page, 'Смоделировать поломку')
  await actionButton(page, '+1 сол')
  assert.equal(await page.getByTestId('lab-bottleneck').getAttribute('data-cause'), 'pump')
  await actionButton(page, 'Ремонт насоса SIM · 1 деталь')
  assert.equal(await page.getByRole('button', { name: 'Ремонт насоса SIM · 1 деталь', exact: true }).isDisabled(), true)
  await actionButton(page, '+1 ч')
  assert.equal(await page.getByTestId('lab-bottleneck').getAttribute('data-cause'), 'none')
  await actionButton(page, 'Перелить запас воды')
  await actionButton(page, 'Пылевой сценарий · 2 сола')
  await actionButton(page, '+1 сол')
  await screenshot(page, 'engineering-dust.png')
  // Climate is a separate energy load, not a cosmetic/random thermometer.
  await actionButton(page, 'Новый сценарий SIM')
  assert.equal(parseFloat(await page.getByTestId('lab-temperature').innerText()), 20)
  await actionButton(page, 'Климат: авто')
  await actionButton(page, '+1 сол')
  assert.ok(parseFloat(await page.getByTestId('lab-temperature').innerText()) < 18)
  assert.ok(parseFloat(await page.getByTestId('lab-temperature-factor').innerText()) < 100)
  await screenshot(page, 'climate-unheated.png')
  await actionButton(page, '+7 солов')
  assert.equal(await page.getByTestId('lab-stage').getAttribute('data-stage'), 'dead')
  assert.equal(await page.getByRole('button', { name: 'Собрать еду SIM', exact: true }).isDisabled(), true)
  await actionButton(page, 'Новый сценарий SIM')
  await climateSlider(page, 'End')
  assert.equal(await page.getByRole('slider', { name: 'Уставка термостата', exact: true }).inputValue(), '26')
  assert.equal(parseFloat(await page.getByTestId('lab-temperature').innerText()), 20, 'a setpoint cannot instantly create heat')
  await actionButton(page, 'Защитить хранилище')
  assert.equal(await page.getByRole('button', { name: 'Защитить хранилище', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.locator('.mf-field-picker button').last().click()
  await page.getByRole('button', { name: 'Климат', exact: true }).click()
  assert.equal(await page.getByRole('slider', { name: 'Уставка термостата', exact: true }).inputValue(), '20')
  await page.locator('.mf-field-picker button').first().click()
  assert.equal(await page.getByRole('slider', { name: 'Уставка термостата', exact: true }).inputValue(), '26')
  await page.getByRole('button', { name: 'Управление', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Защитить хранилище', exact: true }).getAttribute('aria-pressed'), 'true')
  await actionButton(page, 'Новый сценарий SIM')
  await actionButton(page, '+7 солов')
  assert.ok(Math.abs(parseFloat(await page.getByTestId('lab-temperature').innerText()) - 20) < 1)
  await page.getByTestId('lab-temperature-chart').waitFor()
  assert.equal(await page.getByTestId('lab-temperature-chart').locator('polyline').count(), 2)
  await screenshot(page, 'climate-controlled.png')
  await actionButton(page, 'Холодный сценарий · 2 сола')
  await actionButton(page, '+1 сол')
  assert.ok(parseFloat(await page.getByTestId('lab-outside').innerText()) < -55)
  await screenshot(page, 'climate-cold.png')
  await noOverflow(page); await context.close()
  console.log('PASS engineering: crop/food/resource regressions plus thermal inertia, climate off/loss, target clamp/no instant heating, per-field priorities, Celsius chart, cold scenario')

  for (const width of [390, 320]) {
    const { page, context } = await open(width)
    await page.locator('.mf-field-picker button').last().click()
    await actionButton(page, '+7 солов')
    await actionButton(page, 'Остекление')
    await screenshot(page, `engineering-${width}.png`)
    await actionButton(page, 'Собрать еду SIM')
    await noOverflow(page); await context.close()
  }
  for (const flags of [{ fallback: true }, { failModel: true }]) {
    const { page, context } = await open(390, flags)
    await page.locator('.mf-field-picker button').last().press('Enter')
    assert.equal(await page.getByTestId('engineering-console').getAttribute('data-field-id'), 'demo-2')
    await actionButton(page, '+7 солов')
    await actionButton(page, 'Собрать еду SIM')
    // WP11: tier 2 base 30.60 kg × overripe factor at +24.6 h (0.743) = 22.75 kg
    assert.match(await page.getByTestId('lab-mass-ledger').innerText(), /22\.75 kg/)
    await actionButton(page, 'Защитить хранилище')
    await climateSlider(page, 'Home')
    assert.equal(await page.getByRole('slider', { name: 'Уставка термостата', exact: true }).inputValue(), '12')
    await noOverflow(page); await context.close()
  }
  console.log('PASS 390/320px and no WebGL/model 503: resource controls and inventory remain usable')

  const real = await open(390, { realMain: true })
  const keys = await real.page.evaluate(() => window.__fieldKeys)
  await real.page.locator('.mf-field-picker button').nth(1).click()
  assert.equal(await real.page.getByTestId('engineering-console').getAttribute('data-field-id'), keys[1])
  await actionButton(real.page, '+7 солов')
  await actionButton(real.page, 'Собрать еду SIM')
  const before = await time(real.page)
  await real.page.evaluate(() => window.__reorderFields())
  assert.equal(await real.page.getByTestId('engineering-console').getAttribute('data-field-id'), keys[1])
  assert.equal(await time(real.page), before)
  assert.equal(await real.page.evaluate(() => window.__fieldCalls.length), 0)
  await actionButton(real.page, 'POTATO · on-chain')
  assert.match(await real.page.locator('.mf-inspector').innerText(), /0\.20/)
  await real.page.locator('.mf-inspector').getByRole('button', { name: /^Собрать/ }).click()
  assert.deepEqual(await real.page.evaluate(() => window.__fieldCalls.at(-1)), ['harvest', keys[1]])
  await actionButton(real.page, 'Инженерный режим · SIM')
  assert.equal(await time(real.page), before)
  await real.page.evaluate(() => window.__removeSelected())
  assert.equal(await real.page.getByTestId('engineering-console').getAttribute('data-field-id'), keys[0])
  assert.equal(await time(real.page), 0)
  await screenshot(real.page, 'engineering-main-390.png')
  await noOverflow(real.page); await real.context.close()
  console.log('PASS actual MainScreen (mock providers): SIM keyed by public key, no financial callbacks, unchanged POTATO amount/action, deletion/reorder safe')
  assert.deepEqual(outside, []); assert.deepEqual(errors, [])
  console.log('PASS shipped CSP, no external requests, no unexpected console/page errors')
} finally { await browser.close(); fixture.dispose() }
