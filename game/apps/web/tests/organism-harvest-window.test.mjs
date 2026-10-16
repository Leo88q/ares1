// WP11: continuous harvest window in the ARES-LAB/2 engine (M2: 80–120 % of maturity).
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
  writeFileSync(file, body.replaceAll('__WEB__', join(webRoot, 'src').replaceAll('\\', '/')))
  const r = spawnSync(tsx, [file], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const common = `import { initialEngineering, canHarvest, harvestMass, maturityRatio } from '__WEB__/fields/engineering/engine.ts';
const base = (over) => ({ ...initialEngineering('t', 0), ...over });
const at = (progress, hour = 0, matureHour) => base({ hour, crop: { planted: true, progress, health: 1, ...(matureHour === undefined ? {} : { matureHour }) } });
`

test('no harvest before the 80 % window; partial at 80 %; full at 100 %', () => {
  const r = runTs(common + `console.log(JSON.stringify({
    p50: [canHarvest(at(0.5)), harvestMass(at(0.5))],
    p80: [canHarvest(at(0.8)), harvestMass(at(0.8))],
    p100: [canHarvest(at(1, 10, 10)), harvestMass(at(1, 10, 10))],
  }))`)
  assert.deepEqual(r.p50, [false, 0])
  assert.equal(r.p80[0], true)
  assert.ok(Math.abs(r.p80[1] - 18 * 0.5) < 1e-9, `80% mass ${r.p80[1]}`)
  assert.equal(r.p100[0], true)
  assert.ok(Math.abs(r.p100[1] - 18) < 1e-9, `100% mass ${r.p100[1]}`)
})

test('overripe window (240 h): 100 % at maturity, 87.5 % at +12 h, 75 % at +24 h, 50 % at +48 h, closed after', () => {
  const r = runTs(common + `console.log(JSON.stringify({
  m0: harvestMass(at(1, 100, 100)),
  h12: harvestMass(at(1, 100 + 12, 100)),
  h24: harvestMass(at(1, 100 + 24, 100)),
  h48: harvestMass(at(1, 100 + 48, 100)),
  h60: canHarvest(at(1, 100 + 60, 100)),
}))`)
  assert.ok(Math.abs(r.m0 - 18) < 1e-9)
  // ratio +12 h = 1 + 12/240 = 1.05 → factor 0.875 → 15.75 kg
  assert.ok(Math.abs(r.h12 - 18 * 0.875) < 1e-9, `12h ${r.h12}`)
  // ratio +24 h = 1.10 → factor 0.75 → 13.5 kg
  assert.ok(Math.abs(r.h24 - 18 * 0.75) < 1e-9, `24h ${r.h24}`)
  // ratio +48 h = 1.20 → factor 0.5 → 9 kg
  assert.ok(Math.abs(r.h48 - 18 * 0.5) < 1e-9, `48h ${r.h48}`)
  // ratio +60 h = 1.25 → window closed
  assert.equal(r.h60, false)
})

test('dead or unplanted crops cannot be harvested; ratio is 0', () => {
  const r = runTs(common + `console.log(JSON.stringify({
  dead: canHarvest(base({ crop: { planted: true, progress: 1, health: 0 } })),
  empty: canHarvest(base({ crop: { planted: false, progress: 0, health: 1 } })),
  ratioDead: maturityRatio(base({ crop: { planted: true, progress: 1, health: 0 } })),
}))`)
  assert.deepEqual(r, { dead: false, empty: false, ratioDead: 0 })
})
