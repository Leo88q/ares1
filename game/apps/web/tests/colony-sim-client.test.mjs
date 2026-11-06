// Серверная колония (F4): HTTP-клиент, очередь действий и повтор при устаревшем sequence.
// Модули транспилируются из TypeScript и проверяются поведением: фейковый fetch и фейковый сервер.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = fileURLToPath(new URL('../src/', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'colony-sim-client-'))

// Транспиляция: импорты типов стираются, runtime-зависимостей у модулей нет.
function load(rel) {
  const text = readFileSync(join(src, rel), 'utf8')
  const out = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  const file = join(dir, rel.replace(/[\/.]/g, '_') + '.mjs')
  writeFileSync(file, out)
  return import(pathToFileURL(file).href)
}

const client = await load('colony/simClient.ts')
const link = await load('colony/serverLink.ts')
const { createSimClient, simErrorMessage, SimLoadError } = client
const { ColonyServerLink } = link

const UUID = () => crypto.randomUUID()
const noSleep = async () => {}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Фейковый сервер на уровне SimClient: повторяет правила ColonySimService (requestId, sequence, NO_EFFECT).
function fakeServer() {
  let sequence = 0
  let credits = 100
  const seen = new Map()
  const received = []
  const view = () => ({ sequence, state: { credits }, scenario: { sunHours: 12, waterRecovery: 0.5 }, engineVersion: 1, stateHash: 'h' })
  const api = {
    received,
    bump() { sequence++ }, // имитирует действие из другой вкладки
    failNext: 0,
    get: async () => view(),
    act: async input => {
      received.push(input)
      if (api.failNext > 0) { api.failNext--; throw new Error('NETWORK') }
      const prior = seen.get(input.requestId)
      if (prior !== undefined) return { ok: true, reused: true, view: { ...view(), sequence: prior } }
      if (input.expectedSequence !== sequence) return { ok: false, status: 409, code: 'STALE_SEQUENCE', view: view() }
      if (input.action.type === 'noop') return { ok: false, status: 422, code: 'NO_EFFECT', view: view() }
      credits -= input.action.cost ?? 0
      sequence++
      seen.set(input.requestId, sequence)
      return { ok: true, reused: false, view: view() }
    },
  }
  return api
}

// ---------- HTTP-клиент ----------

test('act: POST на /actions с Bearer, requestId и без spendSignature, если его нет', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return json(201, { ok: true, reused: false, view: { sequence: 1, state: {}, scenario: {}, engineVersion: 1, stateHash: 'h' } })
  }
  const c = createSimClient({ baseUrl: 'https://api.example/api/colony-sim', token: 'T', fetchImpl, sleep: noSleep })
  const res = await c.act({ requestId: UUID(), expectedSequence: 0, action: { type: 'repair' } })
  assert.equal(res.ok, true)
  assert.equal(calls[0].url, 'https://api.example/api/colony-sim/actions')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, 'Bearer T')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.expectedSequence, 0)
  assert.deepEqual(body.action, { type: 'repair' })
  assert.equal('spendSignature' in body, false)
})

test('act: сетевой сбой повторяется с тем же телом и requestId, затем успех', async () => {
  const bodies = []
  let n = 0
  const fetchImpl = async (_url, init) => {
    bodies.push(init.body)
    n++
    if (n < 3) throw new TypeError('fetch failed')
    return json(200, { ok: true, reused: true, view: { sequence: 1, state: {}, scenario: {}, engineVersion: 1, stateHash: 'h' } })
  }
  let slept = 0
  const c = createSimClient({ baseUrl: 'x', token: 'T', fetchImpl, sleep: async () => { slept++ } })
  const res = await c.act({ requestId: UUID(), expectedSequence: 0, action: { type: 'supplies' } })
  assert.equal(res.reused, true)
  assert.equal(n, 3)
  assert.equal(slept, 2)
  assert.equal(new Set(bodies).size, 1, 'все повторы отправляют одно и то же тело')
})

test('act: после исчерпания повторов бросает NETWORK (ответ мог потеряться)', async () => {
  const fetchImpl = async () => { throw new TypeError('down') }
  const c = createSimClient({ baseUrl: 'x', token: 'T', fetchImpl, retries: 1, sleep: noSleep })
  await assert.rejects(c.act({ requestId: UUID(), expectedSequence: 0, action: { type: 'deliver' } }), /NETWORK/)
})

test('act: отказ сервера (409 с view) возвращается как значение, а не исключение', async () => {
  const view = { sequence: 5, state: {}, scenario: {}, engineVersion: 1, stateHash: 'h' }
  const fetchImpl = async () => json(409, { ok: false, code: 'STALE_SEQUENCE', view })
  const c = createSimClient({ baseUrl: 'x', token: 'T', fetchImpl, sleep: noSleep })
  const res = await c.act({ requestId: UUID(), expectedSequence: 0, action: { type: 'repair' } })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'STALE_SEQUENCE')
  assert.equal(res.status, 409)
  assert.equal(res.view.sequence, 5)
})

test('get: ошибка сессии (401) даёт код из тела; успех отдаёт view', async () => {
  const bad = createSimClient({ baseUrl: 'x', token: 'T', fetchImpl: async () => json(401, { error: 'SESSION_INVALID' }) })
  await assert.rejects(bad.get(), (err) => err instanceof SimLoadError && err.code === 'SESSION_INVALID' && err.status === 401)
  const good = createSimClient({ baseUrl: 'x', token: 'T', fetchImpl: async () => json(200, { ok: true, view: { sequence: 0 } }) })
  assert.equal((await good.get()).sequence, 0)
})

test('simErrorMessage: коды переводятся на оба языка, неизвестный код получает общий текст', () => {
  assert.match(simErrorMessage('STALE_SEQUENCE', true), /другой вкладке/)
  assert.match(simErrorMessage('STALE_SEQUENCE', false), /another tab/)
  assert.match(simErrorMessage('INVALID_ACTION', true), /Некорректный/)
  assert.equal(simErrorMessage('ЧТО-ТО', false), 'The action failed.')
  assert.equal(simErrorMessage(undefined, true), 'Действие не выполнено.')
})

// ---------- Связка: очередь, sequence, повтор ----------

test('perform: каждое действие берёт sequence последнего ответа; идентификаторы уникальны', async () => {
  const server = fakeServer()
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']
  const link2 = new ColonyServerLink(server, () => ids.shift(), () => {})
  await link2.load()
  const a = await link2.perform({ type: 'repair' })
  const b = await link2.perform({ type: 'repair' })
  assert.equal(a.ok && b.ok, true)
  assert.deepEqual(server.received.map(r => r.expectedSequence), [0, 1])
  assert.equal(new Set(server.received.map(r => r.requestId)).size, 2)
})

test('perform: параллельные нажатия выстраиваются в очередь и не дают одинакового sequence', async () => {
  const server = fakeServer()
  const l = new ColonyServerLink(server, UUID, () => {})
  await l.load()
  const results = await Promise.all([
    l.perform({ type: 'supplies' }), l.perform({ type: 'supplies' }), l.perform({ type: 'supplies' }),
  ])
  assert.deepEqual(results.map(r => r.ok), [true, true, true])
  assert.deepEqual(server.received.map(r => r.expectedSequence), [0, 1, 2])
})

test('STALE_SEQUENCE: один повтор с тем же requestId и той же подписью оплаты, затем успех', async () => {
  const server = fakeServer()
  const l = new ColonyServerLink(server, UUID, () => {})
  await l.load()
  server.bump() // другая вкладка продвинула колонию
  const res = await l.perform({ type: 'repair' }, { spendSignature: '5'.repeat(88) })
  assert.equal(res.ok, true)
  assert.equal(server.received.length, 2)
  assert.equal(server.received[0].requestId, server.received[1].requestId)
  assert.equal(server.received[0].spendSignature, server.received[1].spendSignature)
  assert.equal(server.received[1].expectedSequence, 1)
  assert.equal(l.snapshot().error, null)
})

test('STALE_SEQUENCE дважды подряд: отказ возвращается, ошибка видна в состоянии', async () => {
  const server = fakeServer()
  const l = new ColonyServerLink(server, UUID, () => {})
  await l.load()
  // Сервер всегда отвечает устаревшим sequence (колонию постоянно меняет другая вкладка).
  const newer = { sequence: 9, state: { credits: 100 }, scenario: { sunHours: 12, waterRecovery: 0.5 }, engineVersion: 1, stateHash: 'h' }
  server.act = async input => {
    server.received.push(input)
    return { ok: false, status: 409, code: 'STALE_SEQUENCE', view: newer }
  }
  const res = await l.perform({ type: 'repair' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'STALE_SEQUENCE')
  assert.equal(server.received.length, 2, 'ровно одна попытка и один повтор')
  assert.equal(server.received[1].expectedSequence, 9, 'повтор берёт sequence из ответа сервера')
  assert.equal(l.snapshot().error, 'STALE_SEQUENCE')
  assert.equal(l.snapshot().view.sequence, 9)
})

test('NO_EFFECT: отказ без ошибки сеанса; состояние обновляется', async () => {
  const server = fakeServer()
  const l = new ColonyServerLink(server, UUID, () => {})
  await l.load()
  const res = await l.perform({ type: 'noop' })
  assert.deepEqual(res, { ok: false, code: 'NO_EFFECT' })
  assert.equal(l.snapshot().error, null)
  assert.ok(l.snapshot().view, 'состояние сохранено')
})

test('NETWORK: после сбоя действия связка перечитывает состояние и сообщает NETWORK', async () => {
  const server = fakeServer()
  const l = new ColonyServerLink(server, UUID, () => {})
  await l.load()
  server.failNext = 1
  const res = await l.perform({ type: 'repair' })
  assert.deepEqual(res, { ok: false, code: 'NETWORK' })
  assert.equal(l.snapshot().error, 'NETWORK')
  assert.equal(l.snapshot().view.sequence, 0)
})

test('busy: пока действие в очереди, флаг занятости поднят; после ответа опущен', async () => {
  const server = fakeServer()
  const seen = []
  const l = new ColonyServerLink(server, UUID, s => seen.push(s.busy))
  await l.load()
  await l.perform({ type: 'supplies' })
  assert.ok(seen.includes(true), 'busy поднимался')
  assert.equal(l.snapshot().busy, false)
})

test('до загрузки действие не уходит на сервер', async () => {
  const server = fakeServer()
  const l = new ColonyServerLink(server, UUID, () => {})
  const res = await l.perform({ type: 'repair' })
  assert.deepEqual(res, { ok: false, code: 'NOT_LOADED' })
  assert.equal(server.received.length, 0)
})
