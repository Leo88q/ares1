// Действия колонии: разбор входа, неизменность исходного сеанса, NO_EFFECT и воспроизведение журнала
// через JSON-снимок (как в БД). Если эти тесты падают, серверная симуляция расходится с клиентом.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const actions = await import('../lib/esm/colony/actions.js')
const { CATALOG } = await import('../lib/esm/colony/simulation.js')
const { applyAction, freshSession, parseSimAction, serializeSession, spendFor, ENGINE_VERSION, MAX_ADVANCE_DAYS } = actions

const run = (session, list) => list.reduce((s, a) => {
  const r = applyAction(s, a)
  return r.ok ? r.session : s
}, session)

test('версия движка: та же, что в золотом хеше', () => {
  assert.equal(ENGINE_VERSION, 1)
  assert.equal(MAX_ADVANCE_DAYS, 7)
})

test('parseSimAction: принимает корректные действия и отбрасывает некорректные', () => {
  assert.deepEqual(parseSimAction({ type: 'advance', days: 7 }), { type: 'advance', days: 7 })
  assert.equal(parseSimAction({ type: 'advance', days: 8 }), null)
  assert.equal(parseSimAction({ type: 'advance', days: 1.5 }), null)
  assert.equal(parseSimAction({ type: 'advance', days: '3' }), null)
  assert.equal(parseSimAction({ type: 'build', kind: 'nuke', at: { x: 1, z: 1, rotation: 0 } }), null)
  assert.equal(parseSimAction({ type: 'build', kind: 'habitat', at: { x: 48, z: 1, rotation: 0 } }), null)
  assert.equal(parseSimAction({ type: 'build', kind: 'habitat', at: { x: 1, z: 1, rotation: 4 } }), null)
  assert.equal(parseSimAction({ type: 'harvestBed', moduleId: 'm', index: 64 }), null)
  assert.equal(parseSimAction({ type: 'deep', deep: { op: 'importResource', resource: '__proto__', amount: 1 } }), null)
  assert.equal(parseSimAction({ type: 'deep', deep: { op: 'taskPriority', taskId: 't', priority: 1e9 } }), null)
  assert.equal(parseSimAction({ type: 'unknown' }), null)
  assert.equal(parseSimAction(null), null)
  assert.equal(parseSimAction([]), null)
  assert.equal(parseSimAction({ type: 'scenario', scenario: { sunHours: NaN, waterRecovery: 0.5 } }), null)
})

test('parseSimAction: лишние поля отбрасываются (нормализация для журнала)', () => {
  const parsed = parseSimAction({ type: 'build', kind: 'habitat', at: { x: 2, z: 3, rotation: 1, evil: true }, extra: 1 })
  assert.deepEqual(parsed, { type: 'build', kind: 'habitat', at: { x: 2, z: 3, rotation: 1 } })
})

test('applyAction не меняет исходный сеанс', () => {
  const s0 = freshSession()
  const before = serializeSession(s0)
  const r = applyAction(s0, { type: 'advance', days: 3 })
  assert.equal(r.ok, true)
  assert.equal(serializeSession(s0), before)
  assert.notEqual(serializeSession(r.session), before)
})

test('NO_EFFECT: действие без изменения состояния отклоняется (и не будет оплачено)', () => {
  const s0 = freshSession()
  // Перенос несуществующего модуля, припасы при нехватке CR и ремонт без повреждений ничего не меняют.
  assert.deepEqual(applyAction(s0, { type: 'move', moduleId: 'nope', at: { x: 1, z: 1, rotation: 0 } }), { ok: false, code: 'NO_EFFECT' })
  assert.deepEqual(applyAction(s0, { type: 'harvestBed', moduleId: 'nope', index: 0 }), { ok: false, code: 'NO_EFFECT' })
  assert.deepEqual(applyAction(s0, { type: 'repair' }), { ok: false, code: 'NO_EFFECT' })
  assert.deepEqual(applyAction(s0, { type: 'scenario', scenario: { ...s0.scenario } }), { ok: false, code: 'NO_EFFECT' })
})

test('ENDED: после последнего дня шаги не принимаются', () => {
  const s0 = freshSession()
  const end = { ...s0, state: { ...s0.state, day: 365 } }
  assert.deepEqual(applyAction(end, { type: 'advance', days: 1 }), { ok: false, code: 'ENDED' })
})

test('deep: неизвестный id не меняет мир (NO_EFFECT); сеанс без мира даёт NO_WORLD', () => {
  const s0 = freshSession()
  assert.ok(s0.state.world, 'стартовая колония уже содержит глубокий мир')
  assert.deepEqual(applyAction(s0, { type: 'deep', deep: { op: 'taskCancel', taskId: 'no-such-task' } }), { ok: false, code: 'NO_EFFECT' })
  const noWorld = { ...s0, state: { ...s0.state, world: undefined } }
  assert.deepEqual(applyAction(noWorld, { type: 'deep', deep: { op: 'taskCancel', taskId: 'x' } }), { ok: false, code: 'NO_WORLD' })
})

test('журнал через JSON-снимок воспроизводит непрерывный прогон побайтно', () => {
  const journal = [
    { type: 'advance', days: 7 },
    { type: 'build', kind: 'greenhouse', at: { x: 10, z: 10, rotation: 0 } },
    { type: 'advance', days: 7 },
    { type: 'supplies' },
    { type: 'advance', days: 7 },
    { type: 'deliver' },
    { type: 'advance', days: 7 },
    { type: 'repair' },
    { type: 'advance', days: 7 },
  ]
  const continuous = run(freshSession(), journal)
  // Снимок после половины журнала: сохраняем как текст, восстанавливаем и продолжаем.
  const half = run(freshSession(), journal.slice(0, 4))
  const restored = JSON.parse(serializeSession(half))
  const resumed = run(restored, journal.slice(4))
  assert.equal(serializeSession(resumed), serializeSession(continuous))
})

test('детерминизм: два прогона одного журнала дают одинаковую строку', () => {
  const journal = [{ type: 'advance', days: 7 }, { type: 'supplies' }, { type: 'advance', days: 7 }, { type: 'deliver' }]
  assert.equal(serializeSession(run(freshSession(), journal)), serializeSession(run(freshSession(), journal)))
})

test('spendFor: оплачиваются только стройка (purpose 1) и ремонт (purpose 2), 1 POTATO = 1 CR', () => {
  assert.deepEqual(spendFor({ type: 'build', kind: 'greenhouse', at: { x: 1, z: 1, rotation: 0 } }), { purpose: 1, cr: CATALOG.greenhouse.credits })
  assert.deepEqual(spendFor({ type: 'repair' }), { purpose: 2, cr: 20 })
  assert.equal(spendFor({ type: 'supplies' }), null)
  assert.equal(spendFor({ type: 'move', moduleId: 'm', at: { x: 1, z: 1, rotation: 0 } }), null)
})

test('сети: некорректная сеть отклоняется движком (NO_EFFECT)', () => {
  const s0 = freshSession()
  const bogus = parseSimAction({ type: 'networkAdd', network: { type: 'power', from: 'nope-a', to: 'nope-b', cells: [{ x: 1, z: 1 }] } })
  assert.ok(bogus)
  assert.deepEqual(applyAction(s0, bogus), { ok: false, code: 'NO_EFFECT' })
})

test('deep-журнал: реальные операции меняют мир и переживают JSON-снимок', () => {
  const warm = run(freshSession(), [{ type: 'advance', days: 7 }, { type: 'advance', days: 7 }, { type: 'advance', days: 7 }])
  const deepJournal = [
    { type: 'deep', deep: { op: 'taskPaused', taskId: 'T-62', paused: true } },
    { type: 'deep', deep: { op: 'safeMode', deviceId: 'greenhouse-5', on: true } },
    { type: 'deep', deep: { op: 'isolateSection', sectionId: 'sec-habitat-4', isolated: true } },
    { type: 'deep', deep: { op: 'contractDeliver', contractId: 'local-potato', kg: 5 } },
    { type: 'deep', deep: { op: 'importResource', resource: 'filters', amount: 2 } },
    { type: 'advance', days: 7 },
    { type: 'deep', deep: { op: 'taskPaused', taskId: 'T-62', paused: false } },
  ]
  let accepted = 0
  let s = warm
  for (const a of deepJournal) {
    const r = applyAction(s, a)
    if (r.ok) { accepted++; s = r.session }
  }
  assert.ok(accepted >= 5, `ожидалось минимум 5 принятых операций, принято ${accepted}`)

  // Тот же журнал, но с JSON-снимком посередине.
  let t = warm
  for (const a of deepJournal.slice(0, 3)) { const r = applyAction(t, a); if (r.ok) t = r.session }
  let u = JSON.parse(serializeSession(t))
  for (const a of deepJournal.slice(3)) { const r = applyAction(u, a); if (r.ok) u = r.session }
  assert.equal(serializeSession(u), serializeSession(s))
})
