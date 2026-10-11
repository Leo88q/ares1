import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('V2 marketplace is an explicit opt-in and the checked-in environment defaults it off', () => {
  const feature = readFileSync(join(root, 'src/utils/marketFeature.ts'), 'utf8')
  const env = readFileSync(join(root, '.env.example'), 'utf8')
  const screen = readFileSync(join(root, 'src/components/MarketScreen.tsx'), 'utf8')

  assert.match(feature, /VITE_MARKET_V2_ENABLED\s*===\s*'true'/)
  assert.match(env, /^VITE_MARKET_V2_ENABLED=false$/m)
  assert.match(env, /Keep false until the V2 binary is deployed on this cluster and the owner approves tier thresholds/)
  assert.match(screen, /if\s*\(MARKET_V2_ENABLED\)\s*return\s*<MarketV2Rollout\s*\/>/)
  assert.match(screen, /version\s*===\s*'v2'\s*\?\s*<MarketScreenV2\s*\/>\s*:\s*<MarketScreenInner\s*\/>/)
  assert.match(screen, /setVersion\('legacy'\)/)
})

test('unverified SKR mint blocks new SKR trades without hiding escrow recovery actions', () => {
  const screen = readFileSync(join(root, 'src/components/MarketScreenV2.tsx'), 'utf8')
  const modal = readFileSync(join(root, 'src/components/CreateOrderV2Modal.tsx'), 'utf8')

  assert.match(screen, /order\.status === 'active' && order\.quoteAsset === 'skr' && !skrMintReady && !order\.isOwn/)
  assert.match(screen, /order\.status === 'expired' \? onCloseExpired : order\.isOwn \? onCancel : onFill/)
  assert.match(modal, /quoteAsset === 'skr' && !skrMintReady/)
  assert.match(screen, /ордера видны, свои можно отменить, истёкший escrow можно вернуть/)
})
