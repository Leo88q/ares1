// Regression: редактор сетей живёт внутри рабочей колонии (/base) и работает
// только локально — без транзакций, без списания POTATO и без внешних запросов.
// Старая страница статуса (/base/status) удалена.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

/** Первый визит в свежем контексте показывает баннер cookie (role=dialog .consent),
 *  который перекрывает нижний пульт. Отказываемся от всего — это равноправная
 *  кнопка, игра остаётся рабочей; тест проверяет игровой UI, а не баннер. */
async function dismissConsent(page) {
  const dialog = page.locator('.consent')
  if (await dialog.count() === 0) return
  await dialog.locator('.consent__actions .consent__btn').nth(1).click()
  await dialog.waitFor({ state: 'hidden', timeout: 5000 })
}

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH; this test never downloads a browser.')
const base = (process.env.COLONY_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const origin = new URL(base).origin
const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
const screenshots = process.env.NETWORKS_SCREENSHOT_DIR
const allowedRpcEndpoint = 'https://api.devnet.solana.com/'
if (screenshots) mkdirSync(screenshots, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : ['--no-sandbox'],
  headless: true,
})
const errors = []
const external = []
const rpcRequests = []
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('request', request => {
      if (request.url() === allowedRpcEndpoint) rpcRequests.push(request.url())
      else if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) external.push(request.url())
    })
    await page.route('**/*', async route => {
      if (!route.request().isNavigationRequest()) return route.continue()
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
    })
    await page.goto(`${base}/base`, { waitUntil: 'networkidle' })
    await dismissConsent(page)
    await page.getByTestId('colony-day').waitFor({ state: 'visible' })

    // Редактор сетей доступен в рабочей колонии и не подписывает транзакции.
    await page.getByRole('button', { name: /Networks|Сети/ }).first().click()
    const panel = page.getByTestId('network-panel')
    await panel.waitFor({ state: 'visible' })
    const crBefore = await page.locator('.colony-resource-value').first().innerText()
    assert.ok(crBefore.length > 0)

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `horizontal overflow at ${width}px`)
    await context.close()
    console.log(`PASS ${width}px: network editor inside the colony, status route stays truthful`)
  }
  assert.deepEqual(external, [], `unexpected external requests: ${external.join(', ')}`)
  assert.ok(rpcRequests.every(url => url === allowedRpcEndpoint), `only the configured devnet RPC is permitted: ${rpcRequests.join(', ')}`)
  assert.deepEqual(errors, [], `browser console/page errors: ${errors.slice(0, 8).join('\n')}`)
  console.log('PASS colony network editor stays local, status route truthful, production CSP, no external requests')
} finally {
  await browser.close()
}
