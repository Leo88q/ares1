import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

/**
 * Полевая лаборатория как продуктовая секция (2026-10-17).
 * Песочница /demo удалена: /lab живёт внутри игрового шелла, читает настоящие
 * поля/балансы/рынок и один общий стор колонии с /base. Эти тесты держат границу:
 * реальные данные — из контекстов игры, учебный SIM-слой — без денег и без сети.
 */
const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('ARES section keys: seven keys, ЛАБ opens /lab with a real icon, no duplicates', () => {
  const nav = source('components/ares/AresBottomNav.tsx')
  assert.match(nav, /export type AresTab = 'main' \| 'lab' \| 'colony' \| 'market' \| 'stats' \| 'profile' \| 'operation'/)
  assert.match(nav, /id: 'lab', label: t\('ЛАБ'\), code: 'K2'/)
  assert.match(nav, /lab: '\/ares\/icons\/gauge\.webp'/)
  assert.match(nav, /colony: '\/ares\/icons\/gear\.webp'/)
  assert.match(nav, /src=\{NAV_ICON\[item\.id\]\}/)
  const ids = [...nav.matchAll(/id: '([a-z]+)', label:/g)].map(m => m[1])
  assert.deepEqual(ids, ['main', 'lab', 'colony', 'market', 'stats', 'profile', 'operation'])
  assert.equal(new Set(ids).size, ids.length)
  // Коды клавиш не пересекаются: K1…K7 по порядку пульта.
  assert.deepEqual([...nav.matchAll(/code: '(K\d)'/g)].map(m => m[1]), ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7'])
})

test('App: /lab is a lazy product route, /demo redirects to it, АГРО keeps only the real game, one shared colony store', () => {
  const app = source('App.tsx')
  assert.match(app, /const FieldLabScreen = lazy\(\(\) => import\('\.\/lab\/FieldLabScreen'\)\)/)
  assert.match(app, /const MainScreen = lazy\(\(\) => import\('\.\/components\/MainScreen'\)\)/)
  assert.match(app, /<Route path="\/" element=\{<MainScreen \/>\} \/>/)
  assert.match(app, /<Route path="\/lab" element=\{<FieldLabScreen \/>\} \/>/)
  assert.match(app, /<Route path="\/base" element=\{<ColonyScreen embedded \/>} \/>/)
  assert.match(app, /<Route path="\/demo" element=\{<Navigate to="\/lab" replace \/>\} \/>/)
  assert.match(app, /location\.pathname === '\/lab' \? 'lab'/)
  assert.match(app, /location\.pathname === '\/base' \? 'colony'/)
  // Общий стор колонии mounted один раз вокруг всех секций.
  assert.match(app, /import \{ ColonyProvider \} from '\.\/colony\/ColonyContext'/)
  assert.match(app, /<ColonyProvider>\s*\n\s*<AppRoutes \/>/)
  // Обёртка-переключатель ПОЛЯ/ЛАБОРАТОРИЯ удалена: АГРО — только настоящая игра.
  assert.doesNotMatch(app, /FarmTab|DemoScreen/)
  assert.ok(!existsSync(new URL('../src/components/ares/FarmTab.tsx', import.meta.url)))
  assert.ok(!existsSync(new URL('../src/components/DemoScreen.tsx', import.meta.url)))
  assert.ok(!existsSync(new URL('../src/components/ares/SectionArtPreview.tsx', import.meta.url)))
})

test('main.tsx: no wallet-free /demo bootstrap left, standalone /colony sandbox still branches before providers', () => {
  const main = source('main.tsx')
  assert.doesNotMatch(main, /=== '\/demo'/)
  assert.doesNotMatch(main, /DemoScreen/)
  assert.ok(main.indexOf("=== '/colony'") < main.indexOf("import('./contexts/SolanaContext')"))
})

test('shared colony store: one expedition for the whole session, no persistence, no network, no money', () => {
  const store = source('colony/ColonyContext.tsx')
  assert.match(store, /export function ColonyProvider/)
  assert.match(store, /export function useColony\(\): ColonyStore/)
  assert.match(store, /export const COLONY_TICK_MS = 1200/)
  assert.match(store, /const shared = useContext\(ColonyContext\)/)
  assert.match(store, /const local = useColonyStore\(shared === null\)/)
  assert.match(store, /return shared \?\? local/)
  // Часы живут только в сторе: экраны не тикают сами и не теряют экспедицию.
  assert.match(store, /window\.setInterval\(\(\) => setState\(s => advanceDays\(s, 1, scenario\)\), COLONY_TICK_MS\)/)
  assert.match(store, /document\.addEventListener\('visibilitychange', pauseHidden\)/)
  assert.doesNotMatch(store, /localStorage\.|sessionStorage\.|indexedDB|fetch\(|sendTransaction\(|new PublicKey|mintTo\(|transfer\(/)

  const screen = source('colony/ColonyScreen.tsx')
  assert.match(screen, /const colony = useColony\(\)/)
  assert.match(screen, /colony\.advance\(1\)/)
  assert.match(screen, /colony\.advance\(7\)/)
  assert.match(screen, /colony\.reset\(\)/)
  assert.doesNotMatch(screen, /advanceDays\(|initialColony\(|setInterval\(/)
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

test('field lab reads the real game: wallet fields, balances, on-chain yield config and existing action callbacks', () => {
  const lab = source('lab/FieldLabScreen.tsx')
  assert.match(lab, /const game = useGame\(\)/)
  assert.match(lab, /const \{ connected, ready, config, rpcError, publicKey \} = useSolana\(\)/)
  assert.match(lab, /const colony = useColony\(\)/)
  assert.match(lab, /useMarketplace\(\)/)
  // Настоящие поля и действия: те же колбэки, что в АГРО.
  assert.match(lab, /game\.fields\.map\(field => fieldVisual\(field, nowSec\)\)/)
  for (const callback of ['onHarvest={game.harvest}', 'onUpgrade={game.upgradeField}', 'onRepair={game.repairField}', 'onPayTax={game.payTax}', 'onApplyFertilizer={game.applyFertilizer}']) {
    assert.ok(lab.includes(callback), `lab must reuse the existing callback: ${callback}`)
  }
  assert.match(lab, /onBuy=\{tier => void game\.purchaseField\(tier\)\}/)
  // Живой выход полей: on-chain конфигурация и текущая эпоха, не выдуманное число.
  assert.match(lab, /dailyYieldMicro\(\{ \.\.\.field, epochId \}, cfg, nowSec\)/)
  assert.match(lab, /baseYieldMicroPerDay: Number\(config\.baseYieldMicroPerDay\)/)
  assert.match(lab, /globalMultiplierBps: config\.globalMultiplierBps/)
  assert.match(lab, /game\.stats\.potatoBalance/)
  assert.match(lab, /game\.stats\.skrBalance/)
  assert.match(lab, /HARVEST_THRESHOLD_MICRO/)
  // Стакан монтируется только с кошельком: без подключения нет выдуманных ордеров.
  assert.match(lab, /\{connected && <MarketBook \/>}/)
  assert.match(lab, /import '\.\/lab\.css'/)
  // Никаких собственных аккаунтов, ключей, хранилищ и транзакций.
  assert.doesNotMatch(lab, /new PublicKey|new Keypair|useWallet\(|sendTransaction\(|localStorage\.|sessionStorage\.|mintTo|transfer\(/)
})

test('wallet-free training benches are labelled, isolated and never invent on-chain fields', () => {
  const lab = source('lab/FieldLabScreen.tsx')
  assert.match(lab, /const BENCH_PREFIX = 'lab-bench-'/)
  assert.match(lab, /const isBenchId = \(id: string\): boolean => id\.startsWith\(BENCH_PREFIX\)/)
  assert.match(lab, /const live = connected && ownedFields\.length > 0/)
  assert.match(lab, /const panelFields = live \? ownedFields : benchFields/)
  assert.match(lab, /demo=\{!live\}/)
  assert.match(lab, /УЧЕБНЫЙ СТЕНД · НЕ АККАУНТ КОШЕЛЬКА/)
  assert.match(lab, /if \(isBenchId\(selected\.id\)\) return <BenchInspector/)
  // Бенч-поле — локальный визуал, а не аккаунт: только fieldVisual-форма.
  assert.match(lab, /useMemo<FieldVisual\[\]>/)
})

test('colony↔bench bridge: one stock per section, transfers are recorded on both ledgers and blocked while the clock runs', () => {
  const lab = source('lab/FieldLabScreen.tsx')
  assert.match(lab, /renderLabSupply=\{\(field, sim, dispatch\) => \(/)
  assert.match(lab, /dispatch\(\{ type: 'supply', resource, amount: grant \}\)/)
  assert.match(lab, /onColonyChange\(state => drawFromColony\(state, resource, grant\)\.state\)/)
  assert.match(lab, /dispatch\(\{ type: 'ship', lotId, kg \}\)/)
  assert.match(lab, /onColonyChange\(state => receiveLabFood\(state, kg, kind\)\.state\)/)
  assert.match(lab, /ОСТАНОВИ ЧАСЫ КОЛОНИИ, ЧТОБЫ ПЕРЕДАТЬ СНАБЖЕНИЕ/)
  assert.match(lab, /disabled=\{running \|\| grant <= 0\}/)
  assert.match(lab, /disabled=\{running \|\| shippableKg\(sim, lot\.id, colonyState\) <= 0\}/)
  assert.match(lab, /\{running && <p className="lab-warning" role="status">/)

  const bridge = source('lab/bridge.ts')
  assert.match(bridge, /export const SUPPLY_STEP/)
  assert.match(bridge, /export function colonyStock/)
  assert.match(bridge, /export function supplyGrant/)
  assert.match(bridge, /export function drawFromColony/)
  assert.match(bridge, /export function receiveLabFood/)
  assert.match(bridge, /export function shippableKg/)
  assert.doesNotMatch(bridge, /localStorage\.|sessionStorage\.|fetch\(|sendTransaction\(|new PublicKey/)

  // Тот же стор в обеих секциях: литры/питание/запчасти/еду читаем из ColonyState.
  const economics = source('lab/economics.ts')
  assert.match(economics, /export function colonyLink/)
  assert.match(economics, /export function tierEconomics/)
  assert.match(economics, /export function microFieldEconomics/)
  assert.match(economics, /FIELD_PRICE_MICRO|fieldPriceMicro/)
})

test('mobile column: lab keeps one phone column, 44 px keys and clearance above the seven-key console', () => {
  const lab = source('lab/lab.css')
  assert.match(lab, /\.lab-main \{[^}]*padding: 12px 12px 124px/)
  assert.match(lab, /\.lab-key \{[^}]*min-height: 44px/)
  assert.match(lab, /\.lab-key--small \{ min-height: 44px/)
  assert.match(lab, /\.lab-workspace \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(lab, /@media \(max-width: 820px\) \{\s*\.lab-fields \.mf-workspace \{ grid-template-columns: minmax\(0, 1fr\); \}/)
  assert.match(lab, /@media \(max-width: 480px\)[\s\S]*\.lab-live \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(lab, /\.lab-table-scroll \{ overflow-x: auto/)
  // Семь клавиш пульта: уплотнение на узких экранах, подпись читается.
  const nav = source('components/ares/section-art.css')
  assert.match(nav, /@media \(max-width: 480px\)[\s\S]*\.hull-nav \.hull-nav-key__label \{ font-size: 8\.5px/)
  assert.match(nav, /@media \(max-width: 380px\) \{[\s\S]*\.hull-nav-wrap \{ width: calc\(100% - 4px\); \}/)
  assert.match(nav, /@media \(max-width: 380px\) \{[\s\S]*\.ship-nav \.hull-panel-content \{ padding: 4px 2px; gap: 1px; \}/)
  // Колония остаётся встроенной секцией с тем же запасом снизу.
  const colony = source('colony/colony.css')
  assert.match(colony, /\.colony-app--embedded \.colony-main \{[^}]*padding: 12px 12px 124px/)
})

test('demo sandbox is gone: no dead demo styles or components remain in the product source', () => {
  for (const file of ['fields/fields.css', 'fields/art-direction.css', 'components/ares/section-art.css', 'App.tsx', 'main.tsx']) {
    assert.doesNotMatch(source(file), /mf-demo/, `${file} still carries demo-sandbox styles`)
  }
  assert.ok(!existsSync(new URL('../src/components/ares/farm-tab.css', import.meta.url)))
})
