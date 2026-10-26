import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('the archived engineering study has no wallet, RPC, storage, token, or wall-clock authority', () => {
  const engine = source('fields/engineering/engine.ts')
  assert.doesNotMatch(engine, /useGame\(|useSolana\(|useWallet\(|sendIx\(|sendTransaction\(|fetch\(|Date\.now\(|Math\.random\(|localStorage\.|sessionStorage\.|potatoBalance|earnedCredits/)
})

test('engineering SIM is not imported into the real game, field Lab, or colony status route', () => {
  const app = source('App.tsx')
  const main = source('components/MainScreen.tsx')
  const lab = source('lab/FieldLabScreen.tsx')
  const fields = source('fields/FieldsPanel.tsx')
  const colony = source('components/ColonyStatusScreen.tsx')
  for (const [name, code] of [['App', app], ['MainScreen', main], ['FieldLabScreen', lab], ['FieldsPanel', fields], ['ColonyStatusScreen', colony]]) {
    assert.doesNotMatch(code, /EngineeringConsole|engineering\/|EngineeringState/, `${name} must not mount the training simulator`)
  }
  assert.doesNotMatch(lab, /BENCH_PREFIX|demo=|pause|localStorage|sessionStorage/i)
  assert.doesNotMatch(fields, /SIM|bench|training|source-tabs/i)
})
