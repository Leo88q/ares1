// T4 (cost of delay) and T5 (2 L line buffer) in the ARES-LAB/2 engine. Approved as H, not validated.
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
  const file = join(mkdtempSync(join(tmpdir(), 'delay-')), 'probe.ts')
  writeFileSync(file, body.replaceAll('__WEB__', join(webRoot, 'src').replaceAll('\\', '/')))
  const r = spawnSync(tsx, [file], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const head = `import { initialEngineering, advanceEngineering, delayFactor, harvestMass } from '__WEB__/fields/engineering/engine.ts';\nimport { LAB } from '__WEB__/organism/parameters.ts';\nconst at = (hour, plantedHour = 0) => ({ ...initialEngineering('t', 0), hour, crop: { planted: true, progress: 1, health: 1, matureHour: plantedHour + LAB.nominalCycleHours, plantedHour } });\n`

test('T4: no penalty up to the nominal cycle, linear to 0 at 2× nominal', () => {
  const r = runTs(head + `console.log(JSON.stringify({ at0: delayFactor(at(0)), at148: delayFactor(at(148)), at222: delayFactor(at(222)), at296: delayFactor(at(296)), at400: delayFactor(at(400)), noPlant: delayFactor({ ...at(300), crop: { planted: true, progress: 0, health: 1 } }) }))`)
  assert.equal(r.at0, 1); assert.equal(r.at148, 1)
  assert.ok(Math.abs(r.at222 - 0.5) < 1e-9)
  assert.equal(r.at296, 0); assert.equal(r.at400, 0)
  assert.equal(r.noPlant, 1)
})

test('T4 is applied to harvest mass, not to the window or maturity', () => {
  // matured at 200 h, harvested at 222 h: window ratio 1 + 22/240 → factor 0.7708; delay 222 − 148 = 74 → 0.5
  const r = runTs(head + `const late = { ...initialEngineering('t', 0), hour: 222, crop: { planted: true, progress: 1, health: 1, matureHour: 200, plantedHour: 0 } };
console.log(JSON.stringify({ m148: harvestMass(at(148)), late: harvestMass(late), planted100: harvestMass(at(248, 100)) }))`)
  assert.ok(Math.abs(r.m148 - 18) < 1e-9)
  const expectedLate = 18 * (1 - 0.5 * ((22 / 240) / 0.2)) * 0.5
  assert.ok(Math.abs(r.late - expectedLate) < 1e-9, `late ${r.late} vs ${expectedLate}`)
  // planted at 100 h, harvested at 248 h: elapsed 148 h → no delay penalty
  assert.ok(Math.abs(r.planted100 - 18) < 1e-9)
})

test('T4 calibration: the ideal crop matures within 1 h of the nominal cycle', () => {
  const r = runTs(`import { initialEngineering, advanceEngineering } from '__WEB__/fields/engineering/engine.ts';\nimport { LAB } from '__WEB__/organism/parameters.ts';\nlet s = initialEngineering('t', 0); for (let i = 0; i < 200; i++) s = advanceEngineering(s, 1);\nconsole.log(JSON.stringify({ mature: s.crop.matureHour, nominal: LAB.nominalCycleHours }))`)
  assert.ok(Math.abs(r.mature - r.nominal) <= 1, `matureHour ${r.mature} vs nominal ${r.nominal}`)
})

test('T5: line buffer is 2 L at tier 0 and scales with tier like the other lab reserves', () => {
  const r = runTs(`import { LAB } from '__WEB__/organism/parameters.ts';\nimport { initialEngineering } from '__WEB__/fields/engineering/engine.ts';\nconsole.log(JSON.stringify({ cap: LAB.lineCapacityL, init: LAB.lineInitialL, t0: initialEngineering('t', 0).lineL, t2: initialEngineering('t', 2).lineL }))`)
  assert.equal(r.cap, 2); assert.equal(r.init, 2)
  assert.equal(r.t0, 2)
  assert.ok(Math.abs(r.t2 - 2 * 1.7) < 1e-9)
})
