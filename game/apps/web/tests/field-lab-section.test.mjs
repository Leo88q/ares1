import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('navigation opens the real Lab and preserves seven unique section keys', () => {
  const nav = source('components/ares/AresBottomNav.tsx')
  assert.match(nav, /export type AresTab = 'main' \| 'lab' \| 'colony' \| 'market' \| 'stats' \| 'profile' \| 'operation'/)
  assert.match(nav, /id: 'lab', label: t\('ЛАБ'\), code: 'K2'/)
  assert.match(nav, /lab: '\/ares\/icons\/gauge\.webp'/)
  const ids = [...nav.matchAll(/id: '([a-z]+)', label:/g)].map(match => match[1])
  assert.deepEqual(ids, ['main', 'lab', 'colony', 'market', 'stats', 'profile', 'operation'])
  assert.equal(new Set(ids).size, ids.length)
})

test('legacy URLs cannot enter a local colony simulator or training route', () => {
  const app = source('App.tsx')
  assert.match(app, /<Route path="\/lab" element=\{<FieldLabScreen \/>} \/>/)
  assert.match(app, /<Route path="\/base" element=\{<ColonyStatusScreen \/>} \/>/)
  assert.match(app, /<Route path="\/colony" element=\{<Navigate to="\/base" replace \/>} \/>/)
  assert.match(app, /<Route path="\/demo" element=\{<Navigate to="\/lab" replace \/>} \/>/)
  assert.doesNotMatch(app, /ColonyProvider|<ColonyScreen|TutorialProvider|TutorialScreen/)
  assert.doesNotMatch(app, /FarmTab|DemoScreen/)

  const main = source('main.tsx')
  assert.doesNotMatch(main, /=== '\/demo'|=== '\/colony'/)
  assert.doesNotMatch(main, /DemoScreen|ColonyScreen/)
})

test('Lab reads only connected wallet fields and reuses on-chain actions', () => {
  const lab = source('lab/FieldLabScreen.tsx')
  assert.match(lab, /const game = useGame\(\)/)
  assert.match(lab, /const \{ connected, ready, config, rpcError, publicKey \} = useSolana\(\)/)
  assert.match(lab, /game\.fields\.map\(field => fieldVisual\(field, nowSec\)\)/)
  for (const callback of ['onHarvest={game.harvest}', 'onUpgrade={game.upgradeField}', 'onRepair={game.repairField}', 'onPayTax={game.payTax}', 'onApplyFertilizer={game.applyFertilizer}']) {
    assert.ok(lab.includes(callback), `Lab must reuse the existing callback: ${callback}`)
  }
  assert.match(lab, /dailyYieldMicro\(\{ \.\.\.field, epochId \}, cfg, nowSec\)/)
  assert.match(lab, /game\.stats\.potatoBalance/)
  assert.match(lab, /game\.stats\.skrBalance/)
  assert.match(lab, /\{connected && <MarketBook \/>}/)
  assert.match(lab, /ready && !connected && <EmptyFields/)
  assert.match(lab, /ready && connected && !game\.fieldsError && game\.fields\.length === 0 && <EmptyFields/)
  assert.doesNotMatch(lab, /ColonyProvider|useColony|BENCH_PREFIX|demo=|onBuy=|purchaseField|localStorage|sessionStorage|sendTransaction|pause/i)
})

test('the field selector has no demo source, local resource ledger, or SIM controls', () => {
  const panel = source('fields/FieldsPanel.tsx')
  assert.match(panel, /fields: readonly FieldVisual\[\]/)
  assert.match(panel, /renderInspector\(field: FieldVisual\): ReactNode/)
  assert.match(panel, /renderCards\?: \(\) => ReactNode/)
  assert.doesNotMatch(panel, /demo|SIM|bench|source-tabs|onBuy|lab-supply|lab-ship/i)

  const labCss = source('lab/lab.css')
  assert.doesNotMatch(labCss, /lab-bench|lab-supply|lab-ship|SIM|учебн/i)
  const art = source('fields/art-direction.css')
  assert.doesNotMatch(art, /mf-source-tabs|eg-console|eg-telemetry|eg-topology|is-sim/i)
})

test('the colony tab connects only to the persistent backend and never simulates authoritative state', () => {
  const status = source('components/ColonyStatusScreen.tsx')
  const panel = source('components/PersistentColonyPanel.tsx')
  assert.match(status, /PersistentColonyPanel/)
  assert.match(panel, /\/auth\/challenge/)
  assert.match(panel, /\/initialize/)
  assert.match(panel, /\/actions/)
  assert.match(panel, /\/state/)
  assert.match(panel, /expectedSequence/)
  assert.match(panel, /session\.cluster !== CLUSTER/)
  assert.match(panel, /wallet\.connected && !wallet\.signMessage/)
  assert.match(panel, /\/rules/)
  assert.doesNotMatch(panel, /localStorage|initialColony|advanceDays|setItem\(/)
})

test('all user-facing SKR purchase controls stay closed; real POTATO field gameplay remains separate', () => {
  const presale = source('components/PresaleSection.tsx')
  assert.match(presale, /data-testid="skr-presale-closed"/)
  assert.match(presale, /ПОКУПКА ЗА SKR ОТКЛЮЧЕНА/)
  assert.doesNotMatch(presale, /<button|<input|sendTransaction|ixBuyFieldSkr|useWallet/)

  const game = source('contexts/GameContext.tsx')
  assert.doesNotMatch(game, /buyFieldPresale|ixBuyFieldSkr/)
  assert.match(game, /ixCreateField/)

  const profile = source('components/ProfileScreen.tsx')
  assert.doesNotMatch(profile, /ixBuyExportLicense|buyLicense|ПРИОБРЕСТИ ЛИЦЕНЗИЮ|ПРОДЛИТЬ ЛИЦЕНЗИЮ/)
  assert.match(profile, /Покупка лицензии за SKR закрыта до отдельного одобрения запуска/)
  const slots = source('slots/config.ts')
  assert.match(slots, /export const SLOTS_ENABLED = false/)
  assert.match(slots, /export function slotsReady\(\): boolean \{\s*return false/)
  const main = source('components/MainScreen.tsx')
  assert.doesNotMatch(main, /CaseReveal|revealTier|PRESALE_DROP/)
  const chain = source('utils/anchorClient.ts')
  assert.doesNotMatch(chain, /ixBuyFieldSkr|ixBuyFieldSol|ixBuyExportLicense|ixInitPresale|ixUpdatePresalePrice/)
  assert.match(chain, /decodeExportLicense/)

  for (const file of ['components/MainScreen.tsx', 'components/Header.tsx']) {
    assert.doesNotMatch(source(file), /data-tutorial=/)
  }
})
