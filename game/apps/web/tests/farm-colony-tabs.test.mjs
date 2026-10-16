import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('ARES section keys include КОЛОНИЯ (route /base) alongside the existing five, with real icon and no duplicates', () => {
  const nav = source('components/ares/AresBottomNav.tsx')
  assert.match(nav, /export type AresTab = 'main' \| 'colony' \| 'market' \| 'stats' \| 'profile' \| 'operation'/)
  assert.match(nav, /id: 'colony', label: t\('КОЛОНИЯ'\)/)
  assert.match(nav, /item\.id === 'colony' \? '\/ares\/icons\/gear\.webp'/)
  const ids = [...nav.matchAll(/id: '([a-z]+)', label:/g)].map(m => m[1])
  assert.deepEqual(ids, ['main', 'colony', 'market', 'stats', 'profile', 'operation'])
  assert.ok(new Set(ids).size === ids.length)
})

test('App: АГРО tab is FarmTab (real fields + lab), КОЛОНИЯ is the embedded 3D base at /base, navigation maps both', () => {
  const app = source('App.tsx')
  assert.match(app, /const FarmTab = lazy\(\(\) => import\('\.\/components\/ares\/FarmTab'\)\)/)
  assert.match(app, /const ColonyScreen = lazy\(\(\) => import\('\.\/colony\/ColonyScreen'\)\)/)
  assert.match(app, /<Route path="\/" element=\{<FarmTab \/>\} \/>/)
  assert.match(app, /<Route path="\/base" element=\{<ColonyScreen embedded \/>\} \/>/)
  assert.match(app, /location\.pathname === '\/base' \? 'colony'/)
  assert.match(app, /screen === 'colony' \? '\/base'/)
  // the in-app tab must not replace the standalone no-wallet sandboxes
  const main = source('main.tsx')
  assert.ok(main.indexOf("=== '/colony'") < main.indexOf("import('./contexts/SolanaContext')"))
  assert.ok(main.indexOf("=== '/demo'") < main.indexOf("import('./contexts/SolanaContext')"))
})

test('FarmTab: two modes in one column; real fields keep MainScreen, lab embeds DemoScreen; no wallet hooks in the wrapper', () => {
  const tab = source('components/ares/FarmTab.tsx')
  assert.match(tab, /import\('\.\.\/MainScreen'\)/)
  assert.match(tab, /import\('\.\.\/DemoScreen'\)/)
  assert.match(tab, /\{mode === 'fields' \? <MainScreen \/> : <DemoScreen embedded \/>\}/)
  assert.match(tab, /aria-pressed=\{mode === 'fields'\}/)
  assert.match(tab, /aria-pressed=\{mode === 'lab'\}/)
  assert.doesNotMatch(tab, /useGame\(|useSolana\(|useWallet\(|sendTransaction\(|localStorage\.|sessionStorage\./)
})

test('DemoScreen embedded: no own page chrome, no second section bar, no archive link; standalone /demo unchanged', () => {
  const demo = source('components/DemoScreen.tsx')
  assert.match(demo, /export default function DemoScreen\(\{ embedded = false \}/)
  assert.match(demo, /\{!embedded && <nav className="mf-demo-nav">/)
  assert.match(demo, /\{!embedded && <AresBottomNav/)
  assert.match(demo, /\{!embedded && <details className="mf-demo-archive">/)
  assert.match(demo, /\{!embedded && <div className="mf-demo-actions">/)
  assert.match(demo, /embedded \? 'mf-demo mf-demo--embedded' : 'mf-demo-shell'/)
  assert.match(demo, /FieldVisual\[\]/)
  assert.match(demo, /href="\/market"/)
})

test('ColonyScreen embedded: no second header, no nested <main>, no document.title override, no back link; standalone unchanged', () => {
  const screen = source('colony/ColonyScreen.tsx')
  assert.match(screen, /export default function ColonyScreen\(\{ embedded = false \}/)
  assert.match(screen, /\{!embedded && <header className="colony-header">/)
  assert.match(screen, /const Main = embedded \? 'div' : 'main'/)
  assert.match(screen, /if \(embedded\) return undefined/)
  assert.match(screen, /\{!embedded && <a className="colony-back"/)
  assert.match(screen, /colony-app--embedded/)
})

test('mobile column: embedded styles exist for both tabs and the section key bar fits six keys', () => {
  const colony = source('colony/colony.css')
  assert.match(colony, /\.colony-app--embedded \.colony-main \{[^}]*padding: 12px 12px 124px/)
  assert.match(colony, /\.colony-app--embedded \.colony-workspace \{ grid-template-columns: minmax\(0, 1fr\)/)
  const farm = source('components/ares/farm-tab.css')
  assert.match(farm, /\.farm-tab \.mf-demo-embed \{ padding: 0 12px; \}/)
  assert.match(farm, /\.farm-tab \.mf-demo--embedded \{ padding-bottom: 124px/)
  const nav = source('components/ares/section-art.css')
  assert.match(nav, /@media \(max-width: 480px\)[\s\S]*\.hull-nav \.hull-nav-key__label \{ font-size: 8\.5px/)
})
