// Product field lab smoke (/lab): the section must read the real game (wallet
// fields, balances, market book) and share ONE colony stock with /base.
// Providers are local spies: no wallet, RPC call, signature or transaction here.
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
// NO_WEBGL=1: 3D-сцена поля уходит в фолбэк, SIM-слой и мост колонии проверяются всё равно.
const noWebgl = process.env.NO_WEBGL === '1'
if (screenshots) mkdirSync(screenshots, { recursive: true })

const liveFixture = await labFixture({ connected: true, slug: 'lab-live' })
const benchFixture = await labFixture({ connected: false, slug: 'lab-bench' })
const assets = new Map([...liveFixture.assets, ...benchFixture.assets])
const htmlPaths = new Set(['/__lab-live/main', '/__lab-bench/main'])

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'], headless: true })
const errors = [], outside = []
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow')
const shot = async (page, name) => { if (screenshots) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.screenshot({ path: join(screenshots, name), fullPage: true }) } }

/** Число из фигуры/плитки по её подписи (dt или .lab-tile-label). */
const readFigure = (page, testid, label) => page.evaluate(([tid, text]) => {
  const root = document.querySelector(`[data-testid="${tid}"]`)
  if (!root) return null
  const dt = [...root.querySelectorAll('dt, .lab-tile-label')].find(node => node.textContent.trim() === text)
  const value = dt?.parentElement?.querySelector('dd, .lab-tile-value')?.textContent?.trim() ?? null
  return value
}, [testid, label])
const firstNumber = (text) => {
  const match = String(text ?? '').replace(/\s+/g, ' ').match(/-?\d[\d\s]*(?:[.,]\d+)?/)
  assert.ok(match, `no number in ${JSON.stringify(text)}`)
  return parseFloat(match[0].replace(/\s+/g, '').replace(',', '.'))
}

async function open(width, { mode = 'live', fallback = false } = {}) {
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
  await page.goto(`${base}${mode === 'live' ? '/__lab-live/main' : '/__lab-bench/main'}`, { waitUntil: 'networkidle' })
  await page.getByTestId('field-lab').waitFor()
  await page.getByTestId('lab-live').waitFor()
  await noOverflow(page)
  return { page, context }
}

/** Тот же помощник, что в engineering-смоке: сначала нужная колода, потом клавиша. */
async function actionButton(page, name) {
  const service = ['Новый сценарий SIM', 'Смоделировать поломку', 'Ремонт насоса SIM · 1 деталь', 'Перелить запас воды', 'Пылевой сценарий · 2 сола', 'Холодный сценарий · 2 сола']
  const control = ['Собрать еду SIM', 'Посадить SIM · 1 пакет', 'Освободить грядку SIM', 'Охлаждение: вкл.', 'Охлаждение: выкл.', 'Климат: авто', 'Климат: выключен', 'Защитить хранилище', 'Защитить посадку']
  if (service.includes(name)) await page.getByRole('button', { name: 'Сервис', exact: true }).click()
  else if (control.includes(name)) await page.getByRole('button', { name: 'Управление', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
}

try {
  // ── 1. Продуктовый контур: настоящие поля, балансы, стакан и правила рынка ──
  const { page, context } = await open(1440)
  const keys = await page.evaluate(() => window.__fieldKeys)
  assert.equal(keys.length, 2)
  assert.equal(await page.locator('[data-testid="lab-live"] .lab-tile').count(), 6)
  assert.match(await readFigure(page, 'lab-live', 'ПАЁК · POTATO'), /POTATO|100/)
  assert.match(await readFigure(page, 'lab-live', 'ЗАПАС · SKR'), /250/)
  assert.match(await readFigure(page, 'lab-live', 'ПОЛЯ КОШЕЛЬКА'), /2/)
  // Живой выход полей считается из on-chain конфигурации шпиона, а не выдуман.
  assert.doesNotMatch(await readFigure(page, 'lab-live', 'ВЫХОД ПОЛЕЙ В ДЕНЬ'), /—/)
  // Стакан рынка монтируется только с кошельком.
  assert.equal(await page.getByTestId('lab-market-book').count(), 1)
  assert.match(await page.getByTestId('lab-market-book').innerText(), /SOL/)
  // Три тира + микро-поле: правила входа из зеркала программы.
  assert.equal(await page.locator('[data-testid="lab-market"] .lab-table tbody tr').count(), 4)
  assert.equal(await page.locator('[data-testid="lab-market"] tr[data-tier="micro"]').count(), 1)
  // Общий стор колонии виден в лаборатории.
  assert.match(await page.getByTestId('lab-colony-link').innerText(), /ДЕНЬ \d{3} ИЗ 365/)
  await shot(page, 'lab-desktop.png')

  // Выбор настоящего поля по публичному ключу и существующий колбэк сбора.
  await page.locator('.mf-field-picker button').nth(1).click()
  assert.equal(await page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[1])
  assert.equal(await page.evaluate(() => window.__fieldCalls.length), 0)
  await page.locator('.mf-inspector').getByRole('button', { name: /^Собрать/ }).click()
  await page.waitForFunction(() => window.__fieldCalls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.__fieldCalls.at(-1)), ['harvest', keys[1]])
  await page.evaluate(() => window.__reorderFields())
  assert.equal(await page.locator('.mf-inspector').getAttribute('data-selected-id'), keys[1], 'selection follows the public key, not the slot')
  await page.evaluate(() => window.__reorderFields())

  // ── 2. Мост ресурсов: один сток на секцию ──
  await page.getByRole('button', { name: 'Инженерный режим · SIM', exact: true }).click()
  await page.getByTestId('lab-supply').waitFor()
  assert.equal(await page.getByTestId('lab-supply').getAttribute('data-field-id'), keys[1])
  const waterBefore = firstNumber(await readFigure(page, 'lab-colony-link', 'ВОДА КОЛОНИИ'))
  const roomBefore = await page.locator('[data-testid="lab-supply"] [data-resource="water"]').innerText()
  await page.locator('[data-testid="lab-supply"] [data-resource="water"] .lab-key').click()
  await page.waitForFunction(text => document.querySelector('[data-testid="lab-report"]')?.textContent?.includes(text), 'ПЕРЕДАНО ИЗ КОЛОНИИ')
  assert.match(await page.getByTestId('lab-report').innerText(), /ПЕРЕДАНО ИЗ КОЛОНИИ: 40/)
  const waterAfter = firstNumber(await readFigure(page, 'lab-colony-link', 'ВОДА КОЛОНИИ'))
  assert.ok(Math.abs(waterBefore - waterAfter - 40) < 0.01, `colony water ${waterBefore} → ${waterAfter}`)
  assert.notEqual(await page.locator('[data-testid="lab-supply"] [data-resource="water"]').innerText(), roomBefore)
  // Плитка колонии и карточка связи показывают одно и то же число.
  assert.ok(Math.abs(firstNumber(await readFigure(page, 'lab-live', 'ВОДА КОЛОНИИ')) - waterAfter) < 0.01)
  await shot(page, 'lab-supply.png')

  // ── 3. Часы колонии: передача снабжения останавливается вместе с тиком ──
  await page.getByRole('button', { name: 'ЗАПУСТИТЬ', exact: true }).click()
  await page.getByText('ОСТАНОВИ ЧАСЫ КОЛОНИИ').waitFor()
  assert.equal(await page.locator('[data-testid="lab-supply"] [data-resource="water"] .lab-key').isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '+1 ДЕНЬ', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'ОСТАНОВИТЬ', exact: true }).click()
  await page.waitForFunction(() => !document.body.textContent.includes('ОСТАНОВИ ЧАСЫ КОЛОНИИ'))
  assert.equal(await page.locator('[data-testid="lab-supply"] [data-resource="water"] .lab-key').isDisabled(), false)

  // ── 4. Партия еды со стенда уходит в хранилище базы ──
  await actionButton(page, '+7 солов')
  await actionButton(page, 'Собрать еду SIM')
  await page.getByTestId('lab-ship').waitFor()
  const shipButton = page.locator('[data-testid="lab-ship"] li .lab-key').first()
  // Хранилище старта забито: несколько дней экспедиции освобождают место.
  for (let day = 0; day < 12 && await shipButton.isDisabled(); day++) {
    await page.getByRole('button', { name: '+1 ДЕНЬ', exact: true }).click()
  }
  assert.equal(await shipButton.isDisabled(), false, 'base storage must free up so the bench can ship food')
  const foodBefore = firstNumber(await readFigure(page, 'lab-colony-link', 'ЕДА В ХРАНИЛИЩЕ'))
  const shippedKg = firstNumber(await shipButton.innerText())
  await shipButton.click()
  await page.waitForFunction(text => document.querySelector('[data-testid="lab-report"]')?.textContent?.includes(text), 'ПРИНЯТА В ХРАНИЛИЩЕ БАЗЫ')
  const foodAfter = firstNumber(await readFigure(page, 'lab-colony-link', 'ЕДА В ХРАНИЛИЩЕ'))
  assert.ok(Math.abs(foodAfter - foodBefore - shippedKg) < 0.05, `base food ${foodBefore} + ${shippedKg} != ${foodAfter}`)
  assert.match(await page.getByTestId('lab-supply').innerText(), /ПРИНЯТО БАЗОЙ ЗА СЕАНС/)
  await shot(page, 'lab-ship.png')
  await noOverflow(page); await context.close()
  console.log('PASS live lab: real fields and callbacks, market book, tier/micro economics, one shared colony stock, food shipped into base storage')

  // ── 5. Без кошелька: учебные стенды, но та же колония и те же передачи ──
  const bench = await open(1440, { mode: 'bench' })
  assert.equal(await bench.page.getByTestId('lab-market-book').count(), 0, 'the order book needs a wallet')
  assert.match(await bench.page.getByTestId('lab-hero').innerText(), /НЕТ КОШЕЛЬКА/)
  assert.equal(await bench.page.locator('.mf-field-picker button').count(), 3)
  assert.equal(await bench.page.locator('[data-testid="lab-bench"]').count(), 1)
  assert.match(await bench.page.getByTestId('lab-bench').innerText(), /УЧЕБНЫЙ СТЕНД · НЕ АККАУНТ КОШЕЛЬКА/)
  await bench.page.locator('.mf-field-picker button').nth(2).click()
  assert.equal(await bench.page.locator('.mf-inspector').getAttribute('data-selected-id'), 'lab-bench-2')
  await bench.page.getByRole('button', { name: 'Инженерный режим · SIM', exact: true }).click()
  await bench.page.getByTestId('lab-supply').waitFor()
  assert.equal(await bench.page.getByTestId('lab-supply').getAttribute('data-field-id'), 'lab-bench-2')
  // Стенды берут воду из того же стока колонии: запас один на всю сессию.
  const benchWaterBefore = firstNumber(await readFigure(bench.page, 'lab-colony-link', 'ВОДА КОЛОНИИ'))
  await bench.page.locator('[data-testid="lab-supply"] [data-resource="water"] .lab-key').click()
  await bench.page.waitForFunction(text => document.querySelector('[data-testid="lab-report"]')?.textContent?.includes(text), 'ПЕРЕДАНО ИЗ КОЛОНИИ')
  const benchWaterAfter = firstNumber(await readFigure(bench.page, 'lab-colony-link', 'ВОДА КОЛОНИИ'))
  assert.ok(Math.abs(benchWaterBefore - benchWaterAfter - 40) < 0.01)
  assert.match(await bench.page.getByTestId('lab-supply').innerText(), /Стенд учебный/)
  await shot(bench.page, 'lab-bench.png')
  await noOverflow(bench.page); await bench.context.close()
  console.log('PASS wallet-free lab: training benches, no order book, the same shared colony stock')

  // ── 6. Мобильная версия: одна колонка, тактильный минимум, никакого переполнения ──
  for (const width of [400, 390, 360, 320]) {
    const mobile = await open(width, { fallback: noWebgl })
    assert.equal(await mobile.page.locator('[data-testid="lab-live"] .lab-tile').count(), 6)
    assert.equal(await mobile.page.locator('[data-testid="lab-colony-link"]').count(), 1)
    await mobile.page.getByRole('button', { name: 'Инженерный режим · SIM', exact: true }).click()
    await mobile.page.getByTestId('lab-supply').waitFor()
    const small = await mobile.page.evaluate(() => [...document.querySelectorAll('[data-testid="field-lab"] button, [data-testid="field-lab"] a[href], [data-testid="field-lab"] input')]
      .filter(element => element.offsetParent !== null)
      .map(element => { const box = element.getBoundingClientRect(); return { size: `${Math.round(box.width)}x${Math.round(box.height)}`, label: (element.textContent || element.getAttribute('aria-label') || element.tagName).replace(/\s+/g, ' ').trim().slice(0, 40) } })
      .filter(item => parseFloat(item.size) < 44 || parseFloat(item.size.split('x')[1]) < 44))
    assert.deepEqual(small, [], `controls smaller than 44 px at ${width}px`)
    await shot(mobile.page, `lab-mobile-${width}.png`)
    await noOverflow(mobile.page); await mobile.context.close()
    console.log(`PASS ${width}px: single column, 44 px controls, no horizontal overflow`)
  }

  assert.deepEqual(outside, [], 'no external RPC/wallet/font/model requests in the lab fixture')
  assert.deepEqual(errors, [], 'no unexpected runtime, console or CSP errors')
  console.log('PASS production CSP, no external requests, no unexpected errors')
} finally {
  await browser.close(); liveFixture.dispose(); benchFixture.dispose()
}
