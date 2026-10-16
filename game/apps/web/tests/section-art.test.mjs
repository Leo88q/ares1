import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
test('three actual screen wrappers use distinct local illustration assets and preserve children/HUD', () => {
  const frame = source('components/ares/SectionFrame.tsx')
  for (const image of ['market-background.webp', 'journal-background.webp', 'cabin-background.webp']) assert.ok(frame.includes(image))
  assert.match(frame, /\{children\}/)
  assert.match(frame, /\{hud\}/)
  assert.doesNotMatch(frame, /useGame\(|useSolana\(|useWallet\(|fetch\(|sendTransaction\(/)
  for (const [file, section] of [['SupplyBay.tsx', 'supply'], ['StatsBay.tsx', 'journal'], ['CabinBay.tsx', 'cabin']]) {
    const wrapper = source(`components/ares/${file}`)
    assert.ok(wrapper.includes(`section="${section}"`))
    assert.match(wrapper, /\{children\}/)
    assert.match(wrapper, /SolHud/)
  }
})
test('navigation uses real image icons, same five callbacks/route choices and reactive language labels', () => {
  const nav = source('components/ares/AresBottomNav.tsx')
  assert.match(nav, /ship-nav-icon/)
  assert.doesNotMatch(nav, /<AresHullFrame|<svg/)
  assert.match(nav, /onChange\(item\.id\)/)
  assert.match(nav, /\[t, lang\]/)
  for (const id of ['main', 'market', 'stats', 'profile', 'operation']) assert.ok(nav.includes(`id: '${id}'`))
  const preview = source('components/ares/SectionArtPreview.tsx')
  assert.match(preview, /АРТ-ПРОСМОТР · БЕЗ АККАУНТОВ И ТРАНЗАКЦИЙ/)
  assert.doesNotMatch(preview, /useGame\(|useSolana\(|useWallet\(|sendTransaction\(|orders:|potatoBalance/)
  assert.match(preview, /href=\{art\.href\}/)
})
