// ARES «Единый организм», P1 (docs/ORGANISM_INTEGRATION.md §32.4): one ledger, no silent loss, no minting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceDay, bedFullKg, canHarvestBed, craftPotato, exportKg, fieldCycleKg, harvestBed, initialUnifiedBase,
  unifiedBalance, UNIFIED_CYCLE_DAYS, type UnifiedBase, type UnifiedPlot,
} from '../../apps/web/src/organism/unified'
import { BEDS, PARAMETERS } from '../../apps/web/src/organism/parameters'

const close = (actual: number, expected: number, tolerance = 1e-7): void =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)
const conserved = (b: UnifiedBase): void => close(unifiedBalance(b).residual, 0, 1e-6)
const plot = (beds: number[], id = 'p1', tier: 0 | 1 | 2 = 0): UnifiedPlot => ({ id, tier, beds: [...beds] })
const base = (over: Partial<Parameters<typeof initialUnifiedBase>[0]> = {}, beds = [60, 45, 30, 15, 0, -15]): UnifiedBase =>
  initialUnifiedBase({ plots: [plot(beds)], crew: 3, storageCapKg: 500, startKg: 20, ...over })

test('unified: one field cycle equals the colony reference (216 kg tier 0), bed = 1/6', () => {
  close(fieldCycleKg(0), 216)
  close(bedFullKg(0), 216 / BEDS.perField)
  close(fieldCycleKg(1), 216 * 1.35)
  assert.equal(UNIFIED_CYCLE_DAYS, PARAMETERS.cropCycleDays)
})

test('unified: manual harvest only inside the factor window; outside it the same object is returned', () => {
  const b = base({}, [-1, -1, -1, -1, -1, -1])
  assert.equal(canHarvestBed(b, 'p1', 0), false)
  assert.equal(harvestBed(b, 'p1', 0), b)
  // 20 % of cycle: below T2 minimum 30 % → refused
  const early = base({}, [18, -1, -1, -1, -1, -1])
  assert.equal(harvestBed(early, 'p1', 0), early)
  // 50 % (T2 window): allowed, kg = bed × 0.5·r/0.8 with r = 0.5
  const t2 = base({}, [45, -1, -1, -1, -1, -1])
  const h = harvestBed(t2, 'p1', 0)
  close(h.harvestedKg, bedFullKg(0) * 0.5 * 0.5 / 0.8)
  assert.equal(h.plots[0].beds[0], 0)
  conserved(h)
})

test('unified: storage full → harvest refused, nothing lost (G5 fixed)', () => {
  const b = base({ storageCapKg: 30, startKg: 25 }, [90, -1, -1, -1, -1, -1]) // bed full = 36 kg > 5 kg free
  assert.equal(canHarvestBed(b, 'p1', 0), false)
  assert.equal(harvestBed(b, 'p1', 0), b)
})

test('unified: automatic harvest at full cycle waits when storage has no room, then completes later', () => {
  // 15 kg free, one full bed is 36 kg: the ripe bed holds at the full cycle and no kg appears
  const full = base({ storageCapKg: 40, startKg: 25 }, [UNIFIED_CYCLE_DAYS - 1, -1, -1, -1, -1, -1])
  const waiting = advanceDay(full, 1)
  assert.equal(waiting.harvestedKg, 0)
  assert.equal(waiting.plots[0].beds[0], UNIFIED_CYCLE_DAYS)
  conserved(waiting)
  // room appears after the crew eats (3 people × 0.5 kg/day from processed food)
  let cur = waiting
  for (let i = 0; i < 30 && cur.harvestedKg === 0; i++) cur = advanceDay(cur, 0)
  assert.ok(cur.harvestedKg > 0, 'bed is harvested once storage has room')
  conserved(cur)
})

test('unified: storage smaller than one bed (36 kg) can never harvest that bed (design limit, documented)', () => {
  const b = base({ storageCapKg: 25, startKg: 0 }, [UNIFIED_CYCLE_DAYS, -1, -1, -1, -1, -1])
  let cur = b
  for (let i = 0; i < 60; i++) cur = advanceDay(cur, 0)
  assert.equal(cur.harvestedKg, 0)
  assert.equal(cur.plots[0].beds[0], UNIFIED_CYCLE_DAYS)
  conserved(cur)
})

test('unified: a full year with 6 staggered beds conserves every kilogram, never negative', () => {
  let b = base({ storageCapKg: 500, startKg: 20 })
  for (let d = 0; d < 365; d++) {
    b = advanceDay(b, 1)
    conserved(b)
    assert.ok(b.rawKg >= -1e-9 && b.processedKg >= -1e-9, 'stock never negative')
    assert.ok(storedKgOk(b), 'storage never above the cap')
  }
  assert.ok(b.harvestedKg > 0 && b.eatenKg > 0)
  // POTATO is never minted here, whatever the harvest is
  assert.equal(b.potatoLedger, 0)
})
const storedKgOk = (b: UnifiedBase): boolean => b.rawKg + b.processedKg <= b.storageCapKg + 1e-9

test('unified: crew shortfall is recorded, not hidden', () => {
  const b = base({ startKg: 0, storageCapKg: 500 }, [-1, -1, -1, -1, -1, -1])
  const next = advanceDay(b, 1)
  close(next.foodShortfallKg, 3 * PARAMETERS.freshFoodKgCrewDay)
  close(next.eatenKg, 0)
  conserved(next)
})

test('unified: crafting refused until PotatoPerKg is calibrated (fail-closed)', () => {
  const b = base({ startKg: 50, potatoPerKg: null })
  assert.equal(craftPotato(b, 10), b)
  const calibrated = base({ startKg: 50, potatoPerKg: 0.5 })
  const c = craftPotato(calibrated, 10)
  close(c.potatoLedger, 5)
  close(c.craftedKg, 10)
  conserved(c)
})

test('unified: export takes only processed food and keeps the balance', () => {
  const b = base({ startKg: 40 })
  const e = exportKg(b, 15)
  close(e.exportedKg, 15)
  close(e.processedKg, 25)
  conserved(e)
  // cannot export more than processed stock
  close(exportKg(b, 1000).exportedKg, 40)
})

test('unified: deterministic — same inputs give the same ledger', () => {
  const run = (): UnifiedBase => { let b = base({}); for (let d = 0; d < 120; d++) b = advanceDay(b, 1); return b }
  assert.deepEqual(run(), run())
})
