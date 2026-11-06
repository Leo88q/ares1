// WP11: continuous harvest window in the ARES-LAB/2 engine (M2: 80–120 % of maturity; T2: early 30–80 %).
// K (harvestKg) и W (overripeHours) берутся из LAB, а не зашиты. Окно закрывается через 0,2 × W после зрелости.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsx = resolve(webRoot, '../../node_modules/.bin/tsx')
function runTs(body) {
  const file = join(mkdtempSync(join(tmpdir(), 'harvest-')), 'probe.ts')
  writeFileSync(file, body.replaceAll('__ENGINE__', join(webRoot, 'vendor/colony-engine/src').replaceAll('\\\\', '/')).replaceAll('__WEB__', join(webRoot, 'src').replaceAll('\\\\', '/')))
  const r = spawnSync(tsx, [file], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const common = `import { initialEngineering, canHarvest, harvestMass, maturityRatio } from '__WEB__/fields/engineering/engine.ts';
import { LAB } from '__ENGINE__/organism/parameters.ts';
const base = (over) => ({ ...initialEngineering('t', 0), ...over });
const at = (progress, hour = 0, matureHour) => base({ hour, crop: { planted: true, progress, health: 1, ...(matureHour === undefined ? {} : { matureHour }) } });
const consts = { K: LAB.harvestKg, W: LAB.overripeHours };
`

test('T2: no harvest below 30 %; early harvest 30–80 % with 0.5 × r / 0.8; full window from 80 %', () => {
  const r = runTs(common + `console.log(JSON.stringify({
    ...consts,
    p29: [canHarvest(at(0.29)), harvestMass(at(0.29))],
    p30: [canHarvest(at(0.3)), harvestMass(at(0.3))],
    p50: [canHarvest(at(0.5)), harvestMass(at(0.5))],
    p80: [canHarvest(at(0.8)), harvestMass(at(0.8))],
    p100: [canHarvest(at(1, 10, 10)), harvestMass(at(1, 10, 10))],
  }))`)
  const K = r.K
  assert.deepEqual(r.p29, [false, 0])
  // r = 0.3 → factor 0.5 × 0.3 / 0.8 = 0.1875
  assert.equal(r.p30[0], true)
  assert.ok(Math.abs(r.p30[1] - K * 0.1875) < 1e-9, `30% mass ${r.p30[1]}`)
  // r = 0.5 → factor 0.3125
  assert.equal(r.p50[0], true)
  assert.ok(Math.abs(r.p50[1] - K * 0.3125) < 1e-9, `50% mass ${r.p50[1]}`)
  // r = 0.8 → factor 0.5 (continuous with the window ramp)
  assert.equal(r.p80[0], true)
  assert.ok(Math.abs(r.p80[1] - K * 0.5) < 1e-9, `80% mass ${r.p80[1]}`)
  assert.equal(r.p100[0], true)
  assert.ok(Math.abs(r.p100[1] - K) < 1e-9, `100% mass ${r.p100[1]}`)
})

test('overripe window (LAB.overripeHours): factor 1 − 0.5 × (since / W) / 0.2, closed after 0.2 × W', () => {
  const r = runTs(common + `const W = LAB.overripeHours;\nconsole.log(JSON.stringify({
  ...consts,
  m0: harvestMass(at(1, 100, 100)),
  h12: harvestMass(at(1, 100 + 12, 100)),
  h72: harvestMass(at(1, 100 + 72, 100)),
  h140: harvestMass(at(1, 100 + 0.1944 * W, 100)),
  open140: canHarvest(at(1, 100 + 0.1944 * W, 100)),
  closed: canHarvest(at(1, 100 + 0.2 * W + 24, 100)),
}))`)
  const K = r.K, W = r.W
  const factor = (since) => 1 - 0.5 * ((since / W) / 0.2)
  assert.ok(Math.abs(r.m0 - K) < 1e-9)
  assert.ok(Math.abs(r.h12 - K * factor(12)) < 1e-9, `12h ${r.h12}`)
  assert.ok(Math.abs(r.h72 - K * factor(72)) < 1e-9, `72h ${r.h72}`)
  assert.ok(Math.abs(r.h140 - K * factor(0.1944 * W)) < 1e-9, `140h ${r.h140}`)
  assert.equal(r.open140, true)
  // window closes when ratio exceeds 1.2, i.e. after 0.2 × W hours
  assert.equal(r.closed, false)
})

test('dead or unplanted crops cannot be harvested; ratio is 0', () => {
  const r = runTs(common + `console.log(JSON.stringify({
  dead: canHarvest(base({ crop: { planted: true, progress: 1, health: 0 } })),
  empty: canHarvest(base({ crop: { planted: false, progress: 0, health: 1 } })),
  ratioDead: maturityRatio(base({ crop: { planted: true, progress: 1, health: 0 } })),
}))`)
  assert.deepEqual(r, { dead: false, empty: false, ratioDead: 0 })
})
