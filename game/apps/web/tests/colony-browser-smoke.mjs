// Production-route smoke for the real Colony status/backend flow.
// The former local colony simulator is intentionally not exposed to players;
// /colony must redirect to /base and never mount demo balances or controls.
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
  await page.getByTestId('colony-status').waitFor({ state: 'visible' })
  await page.getByTestId('persistent-colony').waitFor({ state: 'visible' })
  return { page, context }
}

try {
  for (const width of [1440, 390, 320]) {
    const { page, context } = await openColony(width, width < 500 ? 'en-US' : 'en-US')
    const status = page.getByTestId('colony-status')
    const persistent = page.getByTestId('persistent-colony')
    assert.match(await status.innerText(), /CONSTRUCTION INACTIVE/)
    assert.match(await status.innerText(), /feature is disabled in the current game environment/i)
    assert.match(await status.innerText(), /ACCESS CLOSED/)
    assert.match(await persistent.innerText(), /backend-persistent/i)
    assert.match(await persistent.innerText(), /Sign a one-time sign-in message\. The signature does not transfer tokens or submit a transaction\./i)
    assert.match(await persistent.innerText(), /CONNECT A WALLET FIRST/)

    // No local/demo simulation may be reachable through the public Colony route.
    assert.equal(await page.locator('.colony-canvas-host canvas, [data-testid="colony-viewport"]').count(), 0)
    assert.equal(await page.getByTestId('colony-day').count(), 0)
    assert.equal(await page.getByRole('button', { name: /New expedition|Run simulation/i }).count(), 0)
    assert.equal(await page.locator('.colony-resource-value').count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `horizontal overflow at ${width}px`)

    if (width === 1440 && screenshots) await page.screenshot({ path: join(screenshots, 'colony-status-desktop.png'), fullPage: true })
    if (width === 390 && screenshots) await page.screenshot({ path: join(screenshots, 'colony-status-mobile.png'), fullPage: true })
    await context.close()
    console.log(`PASS ${width}px: /colony redirects to /base, persistent status only, no local simulation or horizontal overflow`)
  }
  assert.deepEqual(external, [], `unexpected external requests: ${external.join(', ')}`)
  assert.ok(rpcRequests.every(url => url === allowedRpcEndpoint), `only the configured devnet RPC is permitted: ${rpcRequests.join(', ')}`)
  assert.deepEqual(errors, [], `browser console/page errors: ${errors.slice(0, 8).join('\n')}`)
  console.log('PASS Colony production route uses same-origin assets only and has no runtime errors')
} finally {
  await browser.close()
}
