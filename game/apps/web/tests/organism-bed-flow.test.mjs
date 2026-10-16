// WP10 acceptance (§14.8): daily flow from staggered beds, sum over one cycle = field cycle.
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
  const file = join(mkdtempSync(join(tmpdir(), 'bedflow-')), 'probe.ts')
  writeFileSync(file, body.replaceAll('__WEB__', join(webRoot, 'src').replaceAll('\\', '/')))
  const r = spawnSync(tsx, [file], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const head = `import { bedHarvestSchedule, kgInInterval } from '__WEB__/organism/beds.ts';\nimport { BEDS } from '__WEB__/organism/parameters.ts';\n`

test('colony example (§14.3): 216 kg / 90 days / 6 beds → 6 events of 36 kg every 15 days', () => {
  const r = runTs(head + `console.log(JSON.stringify(bedHarvestSchedule(216, 90, BEDS.perField).map(e => [e.day, e.kg])))`)
  assert.deepEqual(r.map(x => x[0]), [90, 105, 120, 135, 150, 165])
  for (const [, kg] of r) assert.ok(Math.abs(kg - 36) < 1e-9)
})

test('sum over one cycle window equals the field cycle kg (no kg created or lost)', () => {
  const r = runTs(head + `const ev = bedHarvestSchedule(216, 90, BEDS.perField); console.log(JSON.stringify({ cycle: kgInInterval(ev, 90, 180) }))`)
  assert.ok(Math.abs(r.cycle - 216) < 1e-9)
})

test('daily flow is continuous: every cycle/K window holds exactly one bed harvest; average = cycle kg / cycle days', () => {
  const r = runTs(head + `const C = 90, K = BEDS.perField, ev = bedHarvestSchedule(216, C, K);
const windows = Array.from({ length: K }, (_, i) => kgInInterval(ev, C + i * C / K, C + (i + 1) * C / K));
console.log(JSON.stringify({ windows, avg: kgInInterval(ev, C, 2 * C) / C }))`)
  for (const w of r.windows) assert.ok(Math.abs(w - 36) < 1e-9)
  assert.ok(Math.abs(r.avg - 2.4) < 1e-9)
})

test('harvest quality factor applies per bed: ratio 0.8 → half, ratio 1.21 → nothing', () => {
  const r = runTs(head + `console.log(JSON.stringify({ early: bedHarvestSchedule(216, 90, 6, 0.8)[0].kg, closed: bedHarvestSchedule(216, 90, 6, 1.21)[0].kg }))`)
  assert.ok(Math.abs(r.early - 18) < 1e-9)
  assert.equal(r.closed, 0)
})
