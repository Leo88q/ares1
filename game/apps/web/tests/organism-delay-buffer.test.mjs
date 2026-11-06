// T4 (cost of delay) and T5 (2 L line buffer) in the ARES-LAB/2 engine. Approved as H, not validated.
// Ожидаемые значения выводятся из LAB (вендорный движок), а не зашиты: см. docs/LAB_BENCH_PARAMS_MAPPING.md.
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
  writeFileSync(file, body.replaceAll('__ENGINE__', join(webRoot, 'vendor/colony-engine/src').replaceAll('\\\\', '/')).replaceAll('__WEB__', join(webRoot, 'src').replaceAll('\\\\', '/')))
  const r = spawnSync(tsx, [file], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const head = `import { initialEngineering, advanceEngineering, delayFactor, harvestMass } from '__WEB__/fields/engineering/engine.ts';\nimport { LAB } from '__ENGINE__/organism/parameters.ts';\nconst at = (hour, plantedHour = 0) => ({ ...initialEngineering('t', 0), hour, crop: { planted: true, progress: 1, health: 1, matureHour: plantedHour + LAB.nominalCycleHours, plantedHour } });\nconst consts = { K: LAB.harvestKg, N: LAB.nominalCycleHours, W: LAB.overripeHours };\n`

test('T4: no penalty up to the nominal cycle, linear to 0 at 2× nominal', () => {
  const r = runTs(head + `const N = LAB.nominalCycleHours;\nconsole.log(JSON.stringify({ at0: delayFactor(at(0)), atN: delayFactor(at(N)), at15: delayFactor(at(1.5 * N)), at2: delayFactor(at(2 * N)), at3: delayFactor(at(3 * N)), noPlant: delayFactor({ ...at(3 * N), crop: { planted: true, progress: 0, health: 1 } }) }))`)
  assert.equal(r.at0, 1); assert.equal(r.atN, 1)
  assert.ok(Math.abs(r.at15 - 0.5) < 1e-9)
  assert.equal(r.at2, 0); assert.equal(r.at3, 0)
  assert.equal(r.noPlant, 1)
})

test('T4 is applied to harvest mass, not to the window or maturity', () => {
  // Harvest at 1.5 × nominal (delay factor 0.5). Matured 10 % of the overripe span earlier → window ratio 1.1 → factor 0.75.
  const r = runTs(head + `const N = LAB.nominalCycleHours; const W = LAB.overripeHours;\nconst late = { ...initialEngineering('t', 0), hour: 1.5 * N, crop: { planted: true, progress: 1, health: 1, matureHour: 1.5 * N - 0.1 * W, plantedHour: 0 } };\nconsole.log(JSON.stringify({ ...consts, m0: harvestMass(at(N)), late: harvestMass(late), planted100: harvestMass(at(N + 100, 100)) }))`)
  assert.ok(Math.abs(r.m0 - r.K) < 1e-9, `m0 ${r.m0} vs K ${r.K}`)
  const expectedLate = r.K * (1 - 0.5 * ((0.1) / 0.2)) * 0.5
  assert.ok(Math.abs(r.late - expectedLate) < 1e-9, `late ${r.late} vs ${expectedLate}`)
  // planted at 100 h, harvested at 100 + N: elapsed N → no delay penalty
  assert.ok(Math.abs(r.planted100 - r.K) < 1e-9)
})

test('T4 calibration: the ideal crop matures within 1 h of the nominal cycle; water comes from the stock and the balance closes', () => {
  // Вода учитывается: склад подаёт воду по действию supply, бак пополняется refill. Баланс проверяется.
  const r = runTs(`import { initialEngineering, advanceEngineering, engineeringAction, supplyRoom } from '__WEB__/fields/engineering/engine.ts';\nimport { LAB } from '__ENGINE__/organism/parameters.ts';\nlet s = initialEngineering('t', 0); const w0 = s.tankL + s.supplyL + s.lineL; let i = 0;\nwhile (i < 800 && s.crop.matureHour === undefined) { s = advanceEngineering(s, 1); i++; if (s.supplyL < 10) s = engineeringAction(s, { type: 'supply', resource: 'water', amount: Math.min(50, supplyRoom(s, 'water')) }); if (s.tankL < LAB.tankCapacityL - 1e-9) s = engineeringAction(s, { type: 'refill' }) }\nconsole.log(JSON.stringify({ mature: s.crop.matureHour, nominal: LAB.nominalCycleHours, steps: i, w0, left: s.tankL + s.supplyL + s.lineL, cons: s.totals.waterConsumedL, inflow: s.totals.inflowLitres, stockMin: s.tankL >= 0 && s.supplyL >= 0 }))`)
  assert.notEqual(r.mature, undefined, `crop did not mature within ${r.steps} h`)
  assert.ok(Math.abs(r.mature - r.nominal) <= 1, `matureHour ${r.mature} vs nominal ${r.nominal}`)
  assert.ok(Math.abs(r.w0 + r.inflow - r.left - r.cons) < 1e-6, `баланс воды: ${r.w0} + ${r.inflow} − ${r.left} − ${r.cons}`)
  assert.ok(r.cons > 0 && r.stockMin === true, 'расход положительный, запасы не уходят в минус')
})

test('T5: line buffer is 2 L at tier 0 and scales with tier like the other lab reserves', () => {
  const r = runTs(`import { LAB } from '__ENGINE__/organism/parameters.ts';\nimport { initialEngineering } from '__WEB__/fields/engineering/engine.ts';\nconsole.log(JSON.stringify({ cap: LAB.lineCapacityL, init: LAB.lineInitialL, t0: initialEngineering('t', 0).lineL, t2: initialEngineering('t', 2).lineL }))`)
  assert.equal(r.cap, 2); assert.equal(r.init, 2)
  assert.equal(r.t0, 2)
  assert.ok(Math.abs(r.t2 - 2 * 1.7) < 1e-9)
})
