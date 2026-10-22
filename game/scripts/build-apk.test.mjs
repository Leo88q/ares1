import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const script = readFileSync(fileURLToPath(new URL('./build-apk.sh', import.meta.url)), 'utf8')
const guide = readFileSync(fileURLToPath(new URL('../docs/dapp-store-release.md', import.meta.url)), 'utf8')
const rentEstimator = readFileSync(fileURLToPath(new URL('./estimate-game-rent.ts', import.meta.url)), 'utf8')

test('dApp Store web build uses the pinned Solana Mobile WebShell, not the obsolete Bubblewrap TWA path', () => {
  assert.match(script, /CLI_VERSION="0\.6\.0"/)
  assert.match(script, /webshell init/)
  assert.match(script, /webshell build/)
  assert.match(script, /app-release\.apk/)
  assert.doesNotMatch(script, /bubblewrap|assetlinks/i)
})

test('release script fails closed without HTTPS origin, application id, Android SDK, and APK signature verification', () => {
  assert.match(script, /PWA_URL.*https:\/\//s)
  assert.match(script, /ANDROID_APPLICATION_ID is required/)
  assert.match(script, /ANDROID_HOME.*ANDROID_SDK_ROOT/)
  assert.match(script, /JDK 17\+/)
  assert.match(script, /apksigner verify --print-certs/)
  assert.match(script, /KEYSTORE_PATH/)
})

test('rent estimator is read-only, checks the cluster identity, and uses explicit account-size inputs', () => {
  assert.match(rentEstimator, /FIELD_ACCOUNT_BYTES = 70/)
  assert.match(rentEstimator, /SPL_TOKEN_ACCOUNT_BYTES = 165/)
  assert.match(rentEstimator, /getGenesisHash\(\)/)
  assert.match(rentEstimator, /expectedGenesisHash\(cluster\)/)
  assert.match(rentEstimator, /getMinimumBalanceForRentExemption/)
  assert.doesNotMatch(rentEstimator, /sendTransaction|sendRawTransaction|signTransaction|Keypair/)
})

test('release guide distinguishes Store submission from game-program deployment and account rent', () => {
  assert.match(guide, /KYC\/KYB/)
  assert.match(guide, /0\.2 SOL/)
  assert.match(guide, /not a recurring game subscription/)
  assert.match(guide, /not submitted, not approved, and not live/)
  assert.match(guide, /free devnet beta/i)
  assert.match(guide, /fake\/minimal game contract/i)
})
