// Phone touch-target audit (Solana Seeker class, 400×890 CSS px, DPR 3). Lists visible controls smaller than 44 px
// and any horizontal overflow, per screen. §31 proposal item 7.
// Usage: CHROMIUM_EXECUTABLE_PATH=/path/to/chrome ROUTES=/lab,/base,/market yarn workspace web exec node tests/tap-target-audit.mjs
// Optional: AUDIT_BASE_URL (default http://127.0.0.1:4173), NO_WEBGL=1 (no WebGL flags, 3D routes use their fallback),
// SEEKER_DPR (default 3), SEEKER_SCREENSHOT_DIR (writes one PNG per route).
// Requires a built and running preview (`yarn workspace web preview`). Never downloads a browser.
import { chromium } from 'playwright-core'

if (!process.env.CHROMIUM_EXECUTABLE_PATH) throw new Error('Set CHROMIUM_EXECUTABLE_PATH to an installed Chromium binary; this test never downloads a browser.')
const base = (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const routes = (process.env.ROUTES || '/,/lab,/base,/market,/stats,/profile,/operation').split(',')
const dpr = Number(process.env.SEEKER_DPR || 3)
const shotDir = process.env.SEEKER_SCREENSHOT_DIR
if (shotDir) (await import('node:fs')).mkdirSync(shotDir, { recursive: true })
const noWebgl = process.env.NO_WEBGL === '1'
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON)
    : ['--no-sandbox', ...(noWebgl ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])],
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 400, height: 890 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)))
// Close the first-run tutorial and cookie dialog so they do not hide the controls under test.
const dismiss = () => page.evaluate(() => {
  const words = ['skip', 'пропустить', 'reject all', 'отклонить все']
  const btn = [...document.querySelectorAll('button')].find(b => b.offsetParent && words.includes(b.textContent.trim().toLowerCase()))
  if (btn) { btn.click(); return btn.textContent.trim() }
  return null
})
let failures = 0
for (const r of routes) {
  await page.goto(base + r, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto', r, e.message.slice(0, 100)))
  await page.waitForFunction(() => document.querySelector('nav, [class*="bottom-nav"], .colony-app, main'), null, { timeout: 90000 }).catch(() => console.log(r, 'no shell within 90s'))
  await page.waitForTimeout(2500)
  for (let i = 0; i < 6; i++) { if (!await dismiss()) break; await page.waitForTimeout(800) }
  await page.waitForTimeout(800)
  const audit = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a[href], [role="button"], input, select, textarea, [role="tab"]')]
    const small = []
    let total = 0
    for (const el of els) {
      const cs = getComputedStyle(el)
      if (!el.offsetParent && cs.position !== 'fixed') continue
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const b = el.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) continue
      total++
      if (b.width < 44 || b.height < 44) {
        const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)
        small.push(`${Math.round(b.width)}x${Math.round(b.height)} ${label}`)
      }
    }
    return { total, small: [...new Set(small)] }
  })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
  console.log(r, JSON.stringify({ total: audit.total, small: audit.small.length, overflow }))
  for (const s of audit.small) console.log('   ', s)
  if (overflow) console.log('    horizontal overflow')
  if (shotDir) await page.screenshot({ path: `${shotDir}/${r.replace(/\//g, '_') || 'root'}.png` })
  failures += audit.small.length + (overflow ? 1 : 0)
}
console.log('errors', JSON.stringify(errors))
await browser.close()
if (failures > 0 || errors.length > 0) { console.error(`FAIL: ${failures} small targets, ${errors.length} page errors`); process.exit(1) }
console.log(`PASS: every visible control is at least 44 px and no horizontal overflow on ${routes.length} routes at ${dpr}x`)
