// A5 (docs/GAME_AUDIT_2026-11-06.md): ручная уборка грядки на сервере не списывает семена и сразу засевает
// грядку заново. Тест зафиксирован как todo: он падает на текущем поведении. Исправление меняет семантику
// harvestBed и проигрывание существующих журналов, поэтому требует решения владельца.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { freshSession, applyAction } = await import('../lib/esm/colony/actions.js')
const { PARAMETERS } = await import('../lib/esm/colony/simulation.js')

test('A5: ручная уборка не даёт сырьё без семенного картофеля и пересева', {
  todo: 'A5: harvestBed засевает грядку заново без семян. Нужно решение владельца (запас семян, версия журнала)',
}, () => {
  let s = freshSession()
  const gh = s.state.modules.find(m => m.kind === 'greenhouse').id
  let idx = -1
  for (let d = 0; d < 400 && idx < 0; d++) {
    const r = applyAction(s, { type: 'advance', days: 1 })
    if (r.ok) s = r.session
    idx = s.state.ledger.plots[0].beds.findIndex(b => b >= 0.8 * PARAMETERS.cropCycleDays)
  }
  assert.ok(idx >= 0, 'грядка должна созреть')
  const r = applyAction(s, { type: 'harvestBed', moduleId: gh, index: idx })
  assert.equal(r.ok, true)
  assert.equal(r.session.state.ledger.plots[0].planted[idx], false, 'грядка должна остаться пустой до пересева')
})
