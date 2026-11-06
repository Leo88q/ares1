// Старая запись журнала `harvestBed` (до A5): проигрывается прежней семантикой.
// Грядка сбрасывается и тут же засевается заново без семян — так записи и были сделаны.
// Новые записи идут через `harvestBedV2`. Хеш зафиксирован на коде до A5: если он
// меняется, старые сессии на сервере получают REPLAY_HASH_MISMATCH.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const { freshSession, applyAction, serializeSession } = await import('../lib/esm/colony/actions.js')
const { PARAMETERS } = await import('../lib/esm/colony/simulation.js')

const GOLDEN_LEGACY_HASH = 'e3b7b0ddff13978cc2b6629fbaeb48d3e27a3f8124e9cd8a3b7c9435e6fc4127'

test('старая запись harvestBed проигрывается с прежним хешем', () => {
  let s = freshSession()
  const gh = s.state.modules.find(m => m.kind === 'greenhouse').id
  let idx = -1
  for (let d = 0; d < 400 && idx < 0; d++) {
    const r = applyAction(s, { type: 'advance', days: 1 })
    if (r.ok) s = r.session
    idx = s.state.ledger.plots[0].beds.findIndex(b => b >= 0.8 * PARAMETERS.cropCycleDays)
  }
  assert.ok(idx >= 0, 'грядка должна созреть')
  const h = applyAction(s, { type: 'harvestBed', moduleId: gh, index: idx })
  assert.equal(h.ok, true)
  assert.equal(h.session.state.ledger.plots[0].planted?.[idx] ?? true, true, 'старая семантика: грядка засажена сразу')
  const after = applyAction(h.session, { type: 'advance', days: 30 })
  assert.equal(after.ok, true)
  const hash = createHash('sha256').update(serializeSession(after.session)).digest('hex')
  assert.equal(hash, GOLDEN_LEGACY_HASH)
})
