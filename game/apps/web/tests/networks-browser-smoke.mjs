// Production-route regression: network editor controls from the retired local
// colony sandbox must never appear on the real, persistent Colony status route.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

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
    await page.goto(`${base}/colony`, { waitUntil: 'networkidle' })
    await page.waitForURL(url => url.pathname === '/base')
    const status = page.getByTestId('colony-status')
    await status.waitFor({ state: 'visible' })
    await page.getByTestId('persistent-colony').waitFor({ state: 'visible' })

    const copy = await status.innerText()
    assert.match(copy, /CONSTRUCTION INACTIVE/)
    assert.match(copy, /A field module is one on-chain account/i)
    assert.match(copy, /buying a Field does not automatically create a Colony/i)
    assert.match(copy, /does not create a ready-made colony or unlock separate construction resources/i)

    // No demo resources, line editor, paid network actions or simulated clock.
    for (const selector of [
      '[data-testid="network-panel"]', '[data-testid="network-route-preview"]',
      '[data-testid="module-service-status"]', '.colony-canvas-host canvas',
      '[data-testid="colony-viewport"]', '.colony-resource-value',
    ]) assert.equal(await page.locator(selector).count(), 0, `retired simulator control leaked at ${width}px: ${selector}`)
    for (const label of [/Install line/i, /Remove without CR refund/i, /New expedition/i, /\+1 day/i]) {
      assert.equal(await page.getByRole('button', { name: label }).count(), 0, `retired simulator action leaked at ${width}px: ${label}`)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `horizontal overflow at ${width}px`)
    if (screenshots) await page.screenshot({ path: join(screenshots, `colony-status-${width}.png`), fullPage: true })
    await context.close()
    console.log(`PASS ${width}px: no local network editor, simulated resources or paid demo actions`)
  }
  assert.deepEqual(external, [], `unexpected external requests: ${external.join(', ')}`)
  assert.ok(rpcRequests.every(url => url === allowedRpcEndpoint), `only the configured devnet RPC is permitted: ${rpcRequests.join(', ')}`)
  assert.deepEqual(errors, [], `browser console/page errors: ${errors.slice(0, 8).join('\n')}`)
  console.log('PASS real Colony route, production CSP, no demo network editor and no unexpected external requests')
} finally {
  await browser.close()
}
