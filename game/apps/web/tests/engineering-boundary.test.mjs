import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('engineering engine is independent and has no financial, network, storage or wall-clock authority', () => {
  const source = readFileSync(new URL('../src/fields/engineering/engine.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /useGame\(|useSolana\(|useWallet\(|sendIx\(|sendTransaction\(|fetch\(|Date\.now\(|Math\.random\(|localStorage\.|sessionStorage\.|potatoBalance|earnedCredits/)
  assert.match(source, /ARES-LAB\/2/)
  assert.match(source, /maxAdvanceHours/)
  assert.match(source, /chargeEfficiency/)
  assert.match(source, /processingLossKg/)
  assert.match(source, /spoiledKg/)
})
test('SIM mode is ID-bound and leaves original field inspector/card actions available', () => {
  const source = readFileSync(new URL('../src/fields/FieldsPanel.tsx', import.meta.url), 'utf8')
  assert.match(source, /Map<string, EngineeringState>/)
  assert.match(source, /previous\.get\(field\.id\)/)
  assert.match(source, /validIds\.current\.has\(field\.id\)/)
  assert.match(source, /renderInspector\(selected\)/)
  assert.match(source, /renderCards\(\)/)
  const visual = readFileSync(new URL('../src/fields/engineering/presentation.ts', import.meta.url), 'utf8')
  assert.match(visual, /field\.id !== state\.fieldId/)
  assert.doesNotMatch(visual, /pendingMicro\s*:/)
  const copy = readFileSync(new URL('../src/fields/engineering/copy.ts', import.meta.url), 'utf8')
  assert.match(copy, /SIM-ресурсы и партии еды отделены от POTATO/)
  assert.match(copy, /not validated Mars farming/)
})
