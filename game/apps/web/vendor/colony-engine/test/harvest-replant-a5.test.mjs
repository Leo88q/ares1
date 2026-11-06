// A5 (docs/GAME_AUDIT_2026-11-06.md, решение владельца — вариант В): ручная уборка на сервере (`harvestBedV2`)
// учитывает глубокий мир. Грядка остаётся пустой, партия закрывается; пересев — задача посадки мира,
// которая списывает семенной картофель и требует труда. Старый `harvestBed` сохранён для журналов.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { freshSession, applyAction } = await import('../lib/esm/colony/actions.js')
const { PARAMETERS } = await import('../lib/esm/colony/simulation.js')
const { isPlanted } = await import('../lib/esm/organism/unified.js')
const { seedNeededKg } = await import('../lib/esm/colony/deep/growth.js')

function ripeSession() {
  let s = freshSession()
  const gh = s.state.modules.find(m => m.kind === 'greenhouse').id
  let idx = -1
  for (let d = 0; d < 400 && idx < 0; d++) {
    const r = applyAction(s, { type: 'advance', days: 1 })
    if (r.ok) s = r.session
    idx = s.state.ledger.plots[0].beds.findIndex(b => b >= 0.8 * PARAMETERS.cropCycleDays)
  }
  assert.ok(idx >= 0, 'грядка должна созреть')
  return { s, gh, idx }
}

const batchOf = (s, gh, idx) => s.state.world.batches.find(b => b.greenhouseId === gh && b.bedIndex === idx)
const planted = (s, gh, idx) => isPlanted(s.state.ledger, gh, idx)

test('A5: ручная уборка учитывается в мире и оставляет грядку пустой', () => {
  const { s, gh, idx } = ripeSession()
  const r = applyAction(s, { type: 'harvestBedV2', moduleId: gh, index: idx })
  assert.equal(r.ok, true)
  const after = r.session.state
  assert.ok(after.ledger.harvestedKg > 0, 'уборка даёт сырьё')
  assert.ok(Math.abs(after.ledger.harvestedKg - after.world.totals.harvestedKg) < 1e-9, 'реестр и мир сходятся по урожаю')
  assert.equal(after.ledger.plots[0].beds[idx], 0)
  assert.equal(planted(r.session, gh, idx), false, 'грядка пуста до пересева')
  assert.equal(batchOf(r.session, gh, idx).plantedSol, null, 'партия закрыта в мире')
})

test('A5: пересев списывает семенной картофель и идёт задачей посадки', () => {
  const { s, gh, idx } = ripeSession()
  const noSeed = structuredClone(s)
  noSeed.state.world.stock.amount.seed_potato = 0
  const r = applyAction(noSeed, { type: 'harvestBedV2', moduleId: gh, index: idx })
  assert.equal(r.ok, true)
  assert.equal(planted(r.session, gh, idx), false, 'без семян в день уборки грядка не засевается')
  let s2 = r.session
  let seededOn = -1
  for (let d = 0; d < 10 && seededOn < 0; d++) {
    const next = applyAction(s2, { type: 'advance', days: 1 })
    assert.equal(next.ok, true)
    s2 = next.session
    if (planted(s2, gh, idx)) seededOn = d + 1
  }
  assert.ok(seededOn > 0, 'грядка засевается, когда появляется семенной картофель и выполнена посадка')
  assert.ok(Math.abs(batchOf(s2, gh, idx).seedKg - seedNeededKg(batchOf(s2, gh, idx).areaM2)) < 1e-9, 'посадка списала норму семян')
})

test('A5: повторная уборка пустой грядки отклоняется без изменения состояния', () => {
  const { s, gh, idx } = ripeSession()
  const once = applyAction(s, { type: 'harvestBedV2', moduleId: gh, index: idx })
  const again = applyAction(once.session, { type: 'harvestBedV2', moduleId: gh, index: idx })
  assert.equal(again.ok, false)
  assert.equal(again.code, 'NO_EFFECT')
})

test('A5: за 60 суток урожай реестра и мира не расходится (нет двойного учёта)', () => {
  const { s, gh, idx } = ripeSession()
  let cur = applyAction(s, { type: 'harvestBedV2', moduleId: gh, index: idx }).session
  for (let d = 0; d < 60; d++) cur = applyAction(cur, { type: 'advance', days: 1 }).session
  assert.ok(Math.abs(cur.state.ledger.harvestedKg - cur.state.world.totals.harvestedKg) < 1e-6)
})
