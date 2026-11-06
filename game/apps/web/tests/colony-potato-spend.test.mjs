// Колонийная трата POTATO (вариант B): клиентская логика, проводка и IDL.
// Модуль potatoSpend.ts транспилируется в .mjs и проверяется поведением (фейковый fetch и sleep).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = fileURLToPath(new URL('../src/', import.meta.url))
const read = (rel) => readFileSync(new URL(rel, `file://${src}`), 'utf8')

const transpiled = ts.transpileModule(read('colony/potatoSpend.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const dir = mkdtempSync(join(tmpdir(), 'potato-spend-'))
const modPath = join(dir, 'potatoSpend.mjs')
writeFileSync(modPath, transpiled)
const spend = await import(pathToFileURL(modPath).href)

const noSleep = async () => {}
const receipt = { signature: 'sig1', owner: 'wallet1', amountMicro: '70000000', purpose: 1, slot: 42 }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeFetch(responses) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const next = responses.shift()
    // Ответ создаётся заново на каждый вызов: тело Response читается только один раз.
    const value = typeof next === 'function' ? next() : next
    if (value instanceof Error) throw value
    return value
  }
  return { fetchImpl, calls }
}

const deps = (fetchImpl, extra = {}) => ({ backendBase: 'https://api.example', fetchImpl, sleep: noSleep, attempts: 5, delayMs: 0, ...extra })

test('флаг POTATO-трат выключен по умолчанию (в тестовой среде без import.meta.env)', () => {
  assert.equal(spend.COLONY_POTATO_SPEND_ENABLED, false)
})

test('цена в микро-POTATO: 1 CR = 1 POTATO (временно), округление до целых CR', () => {
  assert.equal(spend.colonySpendMicro(70), 70_000_000)
  assert.equal(spend.colonySpendMicro(20), 20_000_000)
  assert.equal(spend.colonySpendMicro(120.4), 120_000_000)
})

test('сумма проверяется до отправки: 0, отрицательные и выше лимита программы отклоняются', () => {
  assert.doesNotThrow(() => spend.assertSpendAmount(spend.COLONY_SPEND_MAX_MICRO))
  for (const bad of [0, -1, spend.COLONY_SPEND_MAX_MICRO + 1, 1.5, NaN]) {
    assert.throws(() => spend.assertSpendAmount(bad), (err) => err.code === 'INVALID_AMOUNT', String(bad))
  }
})

test('лимит и назначения совпадают с программой (COLONY_SPEND_MAX_MICRO, COLONY_PURPOSE_*)', () => {
  const lib = readFileSync(new URL('../../../programs/solana_potato/src/lib.rs', import.meta.url), 'utf8')
  assert.match(lib, /COLONY_SPEND_MAX_MICRO: u64 = 10_000_000_000;/)
  assert.match(lib, /COLONY_PURPOSE_BUILD: u8 = 1;/)
  assert.match(lib, /COLONY_PURPOSE_REPAIR: u8 = 2;/)
  assert.match(lib, /COLONY_PURPOSE_UPGRADE: u8 = 3;/)
  assert.equal(spend.COLONY_SPEND_MAX_MICRO, 10_000_000_000)
  assert.deepEqual(spend.COLONY_PURPOSE, { build: 1, repair: 2, upgrade: 3 })
})

test('квитанция: 409 NOT_FINALIZED повторяется до подтверждения, затем 201 — успех', async () => {
  const notFinal = () => json(409, { ok: false, code: 'NOT_FINALIZED', message: 'x' })
  const { fetchImpl, calls } = fakeFetch([notFinal, notFinal, () => json(201, { ok: true, reused: false, receipt })])
  const got = await spend.recordColonySpend({ signature: 'sig1', wallet: 'wallet1' }, deps(fetchImpl))
  assert.deepEqual(got, receipt)
  assert.equal(calls.length, 3)
  assert.equal(calls[0].url, 'https://api.example/api/colony-spend')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { signature: 'sig1', wallet: 'wallet1' })
})

test('квитанция: повтор той же подписи (200, reused) — успех без двойного списания', async () => {
  const { fetchImpl } = fakeFetch([json(200, { ok: true, reused: true, receipt })])
  const got = await spend.recordColonySpend({ signature: 'sig1', wallet: 'wallet1' }, deps(fetchImpl))
  assert.equal(got.signature, 'sig1')
})

test('квитанция: подпись уже записана за другим кошельком — отказ с причиной', async () => {
  const { fetchImpl } = fakeFetch([json(409, { ok: false, code: 'SIGNATURE_OWNED', message: 'x' })])
  await assert.rejects(
    spend.recordColonySpend({ signature: 'sig1', wallet: 'wallet2' }, deps(fetchImpl)),
    (err) => err.code === 'REJECTED' && err.reason === 'SIGNATURE_OWNED',
  )
})

test('квитанция: сеть не подтвердила за все попытки — RECEIPT_TIMEOUT, колония не меняется', async () => {
  const notFinal = () => json(409, { ok: false, code: 'NOT_FINALIZED', message: 'x' })
  const { fetchImpl, calls } = fakeFetch([notFinal, notFinal, notFinal])
  await assert.rejects(
    spend.recordColonySpend({ signature: 'sig1', wallet: 'wallet1' }, deps(fetchImpl, { attempts: 3 })),
    (err) => err.code === 'RECEIPT_TIMEOUT',
  )
  assert.equal(calls.length, 3)
})

test('квитанция: сетевой сбой и 5xx повторяются; при исчерпании — NETWORK / REJECTED', async () => {
  const ok = json(201, { ok: true, reused: false, receipt })
  const a = fakeFetch([new TypeError('fetch failed'), json(503, { ok: false }), ok])
  assert.deepEqual(await spend.recordColonySpend({ signature: 'sig1', wallet: 'w' }, deps(a.fetchImpl)), receipt)

  const b = fakeFetch([new TypeError('x'), new TypeError('y')])
  await assert.rejects(spend.recordColonySpend({ signature: 'sig1', wallet: 'w' }, deps(b.fetchImpl, { attempts: 2 })), (err) => err.code === 'NETWORK')
})

test('квитанция: 400 INVALID_SIGNATURE не повторяется и даёт отказ с причиной', async () => {
  const { fetchImpl, calls } = fakeFetch([json(400, { ok: false, code: 'INVALID_SIGNATURE', message: 'x' })])
  await assert.rejects(
    spend.recordColonySpend({ signature: 'bad', wallet: 'w' }, deps(fetchImpl)),
    (err) => err.code === 'REJECTED' && err.reason === 'INVALID_SIGNATURE',
  )
  assert.equal(calls.length, 1)
})

test('сообщения об ошибках есть для всех кодов на ru и en, без пустых строк', () => {
  const codes = ['NO_WALLET', 'INSUFFICIENT', 'INVALID_AMOUNT', 'RECEIPT_TIMEOUT', 'NETWORK', 'REJECTED',
    'NOT_FINALIZED', 'SIGNATURE_OWNED', 'INVALID_SIGNATURE', 'INVALID_WALLET', 'TX_FAILED', 'NOT_COLONY_SPEND',
    'MINT_MISMATCH', 'OWNER_MISMATCH', 'OWNER_NOT_SIGNER', 'BURN_MISMATCH']
  for (const lang of ['ru', 'en']) {
    for (const code of codes) {
      const msg = spend.colonySpendMessage(code, lang)
      assert.ok(msg.length > 0, `${lang}/${code}`)
      assert.notEqual(msg, code, `${lang}/${code} должен быть переведён`)
    }
    assert.ok(spend.colonySpendMessage('UNKNOWN', lang).length > 0)
  }
})

test('IDL: colony_spend с правильным дискриминатором, аккаунтами и аргументами', () => {
  const idl = JSON.parse(read('idl.json'))
  const ix = idl.instructions.find((i) => i.name === 'colony_spend')
  assert.ok(ix, 'colony_spend есть в IDL')
  const disc = createHash('sha256').update('global:colony_spend').digest().subarray(0, 8)
  assert.deepEqual(Buffer.from(ix.discriminator), disc)
  assert.deepEqual(ix.accounts.map((a) => a.name), ['potato_mint', 'user_potato', 'config', 'owner', 'token_program'])
  assert.deepEqual(ix.args.map((a) => [a.name, a.type]), [['amount_micro', 'u64'], ['purpose', 'u8']])
  assert.equal(ix.accounts[3].signer, true)
})

test('проводка: ixColonySpend использует данные программы и порядок аккаунтов из ColonySpend', () => {
  const anchor = read('utils/anchorClient.ts')
  const m = anchor.match(/export async function ixColonySpend[\s\S]*?\n}\n/)
  assert.ok(m, 'ixColonySpend найден')
  assert.match(m[0], /ixDiscriminator\('colony_spend'\)/)
  assert.match(m[0], /u64LE\(params\.amountMicro\), u8\(params\.purpose\)/)
  const order = ['potatoMint', 'userPotato', 'config', 'owner', 'TOKEN_PROGRAM_ID'].map((k) => m[0].indexOf(k))
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
})

test('GameContext: spendColonyPotato проверяет кошелёк, сумму и баланс до подписи, квитанция — после', () => {
  const g = read('contexts/GameContext.tsx')
  const block = g.match(/const spendColonyPotato = useCallback\([\s\S]*?\n {1}\)\n/)
  assert.ok(block, 'spendColonyPotato найден')
  const b = block[0]
  const pos = (s) => b.indexOf(s)
  assert.ok(pos("ColonySpendFailure('NO_WALLET')") >= 0)
  assert.ok(pos('assertSpendAmount(amountMicro)') > 0)
  assert.ok(pos("ColonySpendFailure('INSUFFICIENT')") > 0)
  assert.ok(pos('await sendIx(') > pos('ColonySpendFailure(\'INSUFFICIENT\')'))
  assert.ok(pos('await recordColonySpend(') > pos('await sendIx('))
  assert.ok(pos('await refreshAll()') > pos('await recordColonySpend('))
})

test('ColonyScreen: оплата только при переданном potatoSpend, перенос не списывает POTATO, колония меняется после оплаты', () => {
  const screen = read('colony/ColonyScreen.tsx')
  assert.doesNotMatch(screen, /useGame\(|useSolana\(/, 'экран колонии остаётся без кошелька и игровых провайдеров')
  assert.match(screen, /potatoSpend\?: PotatoSpend/)
  // Единый путь: стоимость из движка (spendFor), проверка до оплаты, оплата до действия на сервере.
  assert.match(screen, /const cost = spendFor\(action\)/)
  const run = screen.match(/const run = async[\s\S]*?\n  }\n/)
  assert.ok(run, 'run найден')
  const r = run[0]
  assert.ok(r.indexOf('colony.canPerform(action)') >= 0 && r.indexOf('colony.canPerform(action)') < r.indexOf('payColony('), 'предпроверка до оплаты')
  assert.ok(r.indexOf('payColony(') < r.indexOf('colony.perform('), 'оплата до действия')
  assert.ok(r.indexOf('payColony(') > 0 && r.indexOf('if (cost && potatoSpend)') > 0, 'оплата только при стоимости и переданном potatoSpend')
  // Перенос (move) не имеет стоимости: spendFor возвращает null, POTATO не списывается.
  const confirm = screen.match(/const confirmPlacement = \(\): void => \{[\s\S]*?\n  }\n/)
  assert.ok(confirm, 'confirmPlacement найден')
  assert.match(confirm[0], /type: 'move'/)
  assert.match(confirm[0], /void run\(action/)
  // Ремонт: стоимость задаёт движок (repairCredits внутри spendFor), экран её не дублирует.
  const repair = screen.match(/const repair = \(\): void => \{[^\n]*\}/)
  assert.ok(repair, 'repair найден')
  assert.match(repair[0], /run\(\{ type: 'repair' \}\)/)
  const actions = readFileSync(new URL('../vendor/colony-engine/src/colony/actions.ts', import.meta.url), 'utf8')
  assert.match(actions, /if \(action\.type === 'repair'\) return \{ purpose: 2, cr: PARAMETERS\.repairCredits \}/)
  assert.match(actions, /return null\n}/)
})

test('маршрут /base: флаг POTATO-трат стоит в обёртке, а не в экране; экран подключается лениво', () => {
  const route = read('colony/ColonyBaseRoute.tsx')
  assert.match(route, /const spendEnabled = COLONY_SIM_ENABLED && COLONY_POTATO_SPEND_ENABLED/)
  assert.match(route, /potatoSpend=\{spendEnabled \? spendColonyPotato : undefined\}/)
  const app = read('App.tsx')
  assert.match(app, /lazy\(\(\) => import\('\.\/colony\/ColonyBaseRoute'\)\)/)
  assert.match(app, /path="\/base" element=\{<ColonyBaseRoute \/>\}/)
})

test('.env.example: VITE_COLONY_POTATO_SPEND выключен по умолчанию', () => {
  const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  assert.match(env, /^VITE_COLONY_POTATO_SPEND=false$/m)
  assert.doesNotMatch(env, /^VITE_COLONY_POTATO_SPEND=true/m)
})
