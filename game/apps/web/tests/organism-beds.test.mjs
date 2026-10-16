// WP1 + WP10 checks: parameter parity with the Rust program and bed/slot rules.
// Behaviour is checked by running the TypeScript modules through the repo's tsx.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const tsx = resolve(webRoot, '../../node_modules/.bin/tsx')
const libRs = readFileSync(resolve(webRoot, '../../programs/solana_potato/src/lib.rs'), 'utf8')
const paramsSrc = readFileSync(resolve(webRoot, 'src/organism/parameters.ts'), 'utf8')

function rustConst(name) {
  const m = libRs.match(new RegExp(`pub const ${name}: [a-z0-9]+ = ([0-9_]+);`))
  assert.ok(m, `Rust constant ${name} not found`)
  return BigInt(m[1].replaceAll('_', ''))
}

// Run TS modules via tsx and return JSON.
function runTs(body) {
  const dir = mkdtempSync(join(tmpdir(), 'organism-'))
  const file = join(dir, 'probe.ts')
  writeFileSync(file, body.replaceAll('__WEB__', join(webRoot, 'src').replaceAll('\\', '/')))
  const r = spawnSync(tsx, [file], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

test('WP1: LAB and colony parameter blocks live in organism/parameters.ts', () => {
  assert.match(paramsSrc, /export const LAB = Object\.freeze\(\{/)
  assert.match(paramsSrc, /export const PARAMETERS = \{/)
  assert.match(readFileSync(resolve(webRoot, 'src/fields/engineering/engine.ts'), 'utf8'), /from '\.\.\/\.\.\/organism\/parameters'/)
  assert.match(readFileSync(resolve(webRoot, 'src/colony/simulation.ts'), 'utf8'), /from '\.\.\/organism\/parameters'/)
})

test('economy mirror matches the Rust program constants', () => {
  const e = runTs(`import { ECONOMY, SLOTS } from '__WEB__/organism/parameters.ts';
console.log(JSON.stringify({ field: ECONOMY.baseFieldPriceMicro, tax: ECONOMY.baseTaxMicro, repair: ECONOMY.baseRepairMicro, fert: ECONOMY.baseFertilizerMicro, upgrade: ECONOMY.baseUpgradeMicro, base: ECONOMY.baseYieldMicroPerDay, lic: String(ECONOMY.exportLicenseSkrAtoms), presale: String(ECONOMY.presaleSkrAtoms), burn: ECONOMY.feeBurnPercent, tiers: ECONOMY.tiers.map(t => [t.yieldBps, t.costBps]), slotSkr: String(SLOTS.priceSkrAtoms) }))`)
  assert.equal(BigInt(e.field), rustConst('BASE_FIELD_PRICE_MICRO'))
  assert.equal(BigInt(e.tax), rustConst('BASE_TAX_MICRO'))
  assert.equal(BigInt(e.repair), rustConst('BASE_REPAIR_MICRO'))
  assert.equal(BigInt(e.fert), rustConst('BASE_FERTILIZER_MICRO'))
  assert.equal(BigInt(e.upgrade), rustConst('BASE_UPGRADE_MICRO'))
  assert.equal(BigInt(e.base), rustConst('DEFAULT_BASE_YIELD_MICRO_PER_DAY'))
  assert.equal(BigInt(e.lic), rustConst('EXPORT_LICENSE_PRICE_SKR_ATOMS'))
  assert.equal(BigInt(e.presale), rustConst('PRESALE_PRICE_SKR_ATOMS'))
  assert.equal(e.burn, Number(rustConst('FEE_BURN_PERCENT')))
  // Slot price is decided to equal the export licence (§18).
  assert.equal(e.slotSkr, e.lic)
  assert.deepEqual(e.tiers, [[3500, 4000], [10000, 10000], [21000, 20000]])
})

test('slots: 6 free, 6 paid at 500 SKR, cap 12', () => {
  const r = runTs(`import { slotPriceSkrAtoms, totalSlotCostSkrAtoms } from '__WEB__/organism/beds.ts';
console.log(JSON.stringify({ first: String(slotPriceSkrAtoms(0)), sixth: String(slotPriceSkrAtoms(5)), seventh: String(slotPriceSkrAtoms(6)), last: String(slotPriceSkrAtoms(11)), total6: String(totalSlotCostSkrAtoms(6)), total12: String(totalSlotCostSkrAtoms(12)) }))`)
  assert.equal(r.first, '0'); assert.equal(r.sixth, '0')
  assert.equal(r.seventh, '500000000'); assert.equal(r.last, '500000000')
  assert.equal(r.total6, '0')
  assert.equal(r.total12, String(6n * 500_000_000n))
})

test('slot index and occupancy are bounded', () => {
  const r = runTs(`import { slotPriceSkrAtoms, totalSlotCostSkrAtoms } from '__WEB__/organism/beds.ts';
const errs = []; for (const f of [() => slotPriceSkrAtoms(12), () => slotPriceSkrAtoms(-1), () => slotPriceSkrAtoms(1.5), () => totalSlotCostSkrAtoms(13)]) { try { f(); errs.push('ok') } catch (e) { errs.push(e.name) } }
console.log(JSON.stringify(errs))`)
  assert.deepEqual(r, ['RangeError', 'RangeError', 'RangeError', 'RangeError'])
})

test('bed price equals field price per tier (§18): 100 / 250 / 500 POTATO', () => {
  const r = runTs(`import { bedPriceMicro } from '__WEB__/organism/beds.ts';
console.log(JSON.stringify([0,1,2].map(t => bedPriceMicro(t))))`)
  assert.deepEqual(r, [100_000_000, 250_000_000, 500_000_000])
})

test('beds: staggered offsets and equal cycle shares sum to the field', () => {
  const r = runTs(`import { bedOffsetDays, bedCycleKg } from '__WEB__/organism/beds.ts';
import { BEDS } from '__WEB__/organism/parameters.ts';
const offs = [0,1,2,3,4,5].map(i => bedOffsetDays(i, 90))
console.log(JSON.stringify({ offs, kg: bedCycleKg(216), k: BEDS.perField, sum: [0,1,2,3,4,5].reduce((a) => a + bedCycleKg(216), 0) }))`)
  assert.deepEqual(r.offs, [0, 15, 30, 45, 60, 75])
  assert.equal(r.k, 6)
  assert.ok(Math.abs(r.kg - 36) < 1e-9)
  assert.ok(Math.abs(r.sum - 216) < 1e-9)
})

test('harvest window 80–120 % of maturity (M2) with bounded factor', () => {
  const r = runTs(`import { harvestFactor } from '__WEB__/organism/beds.ts';
console.log(JSON.stringify({ early: harvestFactor(0.79), lo: harvestFactor(0.8), mid: harvestFactor(0.9), full: harvestFactor(1), late: harvestFactor(1.1), hi: harvestFactor(1.2), closed: harvestFactor(1.21) }))`)
  assert.equal(r.early, 0)
  assert.equal(r.lo, 0.5)
  assert.equal(r.full, 1)
  assert.ok(r.mid > r.lo && r.mid < 1)
  assert.ok(r.late < 1 && r.late > r.hi)
  assert.equal(r.hi, 0.5)
  assert.equal(r.closed, 0)
})
