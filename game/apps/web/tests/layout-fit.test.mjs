import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('the phone shell drives responsive rules even when the browser viewport is desktop-sized', () => {
  const global = source('styles/global.css')
  assert.match(global, /container-type:\s*inline-size;\s*container-name:\s*app-shell;/)
  assert.match(global, /@container app-shell \(max-width: 420px\)/)

  const statusCss = source('components/colony-status.css')
  assert.match(statusCss, /@container app-shell \(max-width: 380px\)/)
  assert.match(statusCss, /\.colony-status-metrics \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(statusCss, /\.colony-status-wallet, \.colony-status-section-title, \.colony-status-steps li, \.colony-status-metrics > div \{[^}]*min-width: 0/)

  const lab = source('lab/lab.css')
  assert.match(lab, /\.lab-app \{[^}]*container-name: lab;/)
  assert.match(lab, /@container lab \(max-width: 480px\)/)
  assert.match(lab, /\.lab-tile \{[^}]*padding: clamp\(16px, 5cqi, 24px\)/)
  assert.match(lab, /\.lab-card \{[^}]*padding: clamp\(18px, 9cqi, 42px\)/)

  const operation = source('components/OperationScreen.tsx')
  assert.match(operation, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(min\(128px, 100%\), 1fr\)\)'/)
  assert.doesNotMatch(operation, /gridTemplateColumns: 'repeat\(4, minmax\(0, 1fr\)\)'/)
})

test('frame text keeps a readable inset and normal words do not split one character at a time', () => {
  const fit = source('styles/i18n-fit.css')
  assert.match(fit, /overflow-wrap: break-word;/)
  assert.match(fit, /font-size: clamp\(18px, 5\.2cqi, 28px\)/)
  assert.doesNotMatch(fit, /overflow-wrap:\s*anywhere;/)
  for (const file of ['ui/prize-reveal.css', 'lab/lab.css']) {
    assert.doesNotMatch(source(file), /overflow-wrap:\s*anywhere;/)
  }
  // Only the unbroken public-key string may split anywhere in the status screen.
  const statusCss = source('components/colony-status.css')
  assert.match(statusCss, /\.colony-status-wallet > span \{[^}]*overflow-wrap: anywhere;/)

  const sections = source('components/ares/section-art.css')
  assert.match(sections, /\.ship-section-body \.hull-panel > \.hull-panel-content \{[^}]*padding: clamp\(18px, 5\.5cqi, 26px\)/)
  assert.match(sections, /\.ship-section-body \.pf-card,[\s\S]*padding: clamp\(18px, 5\.5cqi, 26px\) !important/)

  const fields = source('fields/art-direction.css')
  assert.match(fields, /\.mf-field-picker button \{[^}]*min-height: 75px/)
  assert.match(fields, /@container app-shell \(max-width:480px\)/)

  const labView = source('lab/FieldLabScreen.tsx')
  assert.match(labView, /className="lab-tile-label"><ResourceIcon[^>]*\/><span>\{label\}<\/span>/)
  const colonyView = source('components/ColonyStatusScreen.tsx')
  assert.match(colonyView, /className="colony-status-wallet__label"><Wallet[^>]*\/>/)
  assert.doesNotMatch(colonyView, /ColonyProvider|useColony|setInterval|pause\(/i)
})
