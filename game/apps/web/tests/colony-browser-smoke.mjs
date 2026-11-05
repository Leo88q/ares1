// Production-route smoke: /colony ведёт на /base, где живёт рабочая колония —
// 3D-макет базы, стройка модулей и локальная экспедиция (CR/кг/литры). Смоук
// проверяет, что раздел действительно смонтирован, а не подменён страницей
// статуса, и что страница статуса остаётся доступной отдельным адресом.
// Он ничего не подписывает: кошелёк в тесте не подключается.
// CHROMIUM_EXECUTABLE_PATH=/path/to/chrome yarn workspace web test:colony-browser
// Optional COLONY_BASE_URL and COLONY_SCREENSHOT_DIR.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH to an installed Chromium binary; this test never downloads a browser.')
const base = (process.env.COLONY_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const screenshots = process.env.COLONY_SCREENSHOT_DIR
if (screenshots) mkdirSync(screenshots, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'],
  headless: true,
})
const errors = []
const external = []
const rpcRequests = []
const allowedRpcEndpoint = 'https://api.devnet.solana.com/'

async function openColony(width, locale = 'en-US') {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', request => {
    if (request.url() === allowedRpcEndpoint) rpcRequests.push(request.url())
    else if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) external.push(request.url())
  })
  await page.goto(`${base}/colony`, { waitUntil: 'networkidle' })
  await page.waitForURL(url => url.pathname === '/base')
  return { page, context }
}

try {
  for (const width of [1440, 390, 320]) {
    const { page, context } = await openColony(width, 'en-US')
    // Раздел колонии смонтирован в игровом shell: часы, ресурсы, стройка, 3D.
    await page.getByTestId('colony-day').waitFor({ state: 'visible' })
    assert.ok(await page.locator('.colony-resource-value').count() >= 4, `colony resources missing at ${width}px`)
    assert.ok(await page.locator('.colony-build-item').count() >= 5, `build catalog missing at ${width}px`)
    // 3D-сцена либо canvas (WebGL есть), либо честный 2D-план без WebGL.
    const scene = page.getByTestId('colony-viewport')
    await scene.waitFor({ state: 'visible' })
    assert.ok(await page.locator('.colony-canvas-host canvas, .colony-plan-grid').count() > 0, `colony scene missing at ${width}px`)
    // Пульт секций: клавиша КОЛОНИЯ активна и раздел не скрыт флагом бэкенда.
    assert.equal(await page.locator('.ship-nav .hull-nav-key').count(), 7, `section keys missing at ${width}px`)
    assert.equal(await page.locator('.ship-nav .hull-nav-key[aria-pressed="true"]').count(), 1)
    // Стройка не тратит POTATO и не подписывает транзакции: кошелёк не подключён,
    // а кнопки времени работают на локальной экспедиции.
    await page.getByRole('button', { name: '+1 day', exact: true }).first().click()
    assert.match(await page.getByTestId('colony-day').innerText(), /^00[2-9]$/)
    // Страница статуса протокола осталась доступной отдельным адресом.
    const statusPage = await context.newPage()
    await statusPage.goto(`${base}/base/status`, { waitUntil: 'networkidle' })
    assert.match(await statusPage.getByTestId('colony-status').innerText(), /CONSTRUCTION INACTIVE/)
    await statusPage.close()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `horizontal overflow at ${width}px`)

    if (width === 1440 && screenshots) await page.screenshot({ path: join(screenshots, 'colony-desktop.png'), fullPage: true })
    if (width === 390 && screenshots) await page.screenshot({ path: join(screenshots, 'colony-mobile.png'), fullPage: true })
    await context.close()
    console.log(`PASS ${width}px: /colony → /base mounts the working colony (3D scene, clocks, build catalog), status page stays at /base/status, no overflow`)
  }
  assert.deepEqual(external, [], `unexpected external requests: ${external.join(', ')}`)
  assert.ok(rpcRequests.every(url => url === allowedRpcEndpoint), `only the configured devnet RPC is permitted: ${rpcRequests.join(', ')}`)
  assert.deepEqual(errors, [], `browser console/page errors: ${errors.slice(0, 8).join('\n')}`)
  console.log('PASS Colony route uses same-origin assets only and has no runtime errors')
} finally {
  await browser.close()
}
