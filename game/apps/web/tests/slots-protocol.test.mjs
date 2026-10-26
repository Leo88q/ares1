// S7 шаг 5: протокол слотов в браузере должен совпадать с сервером побайтно.
// Сравнивает строку подписи web (src/slots/protocol.ts) и backend (src/slots/requestAuth.ts)
// на одних и тех же полях, а также правила бесплатных/платных слотов и формат цены.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const repoGame = resolve(webRoot, '../..')
const tsx = resolve(repoGame, 'node_modules/.bin/tsx')
const protocolPath = resolve(webRoot, 'src/slots/protocol.ts')
const backendAuth = resolve(repoGame, 'apps/backend/src/slots/requestAuth.ts')

function runTs(source) {
  const dir = mkdtempSync(join(tmpdir(), 'slots-proto-'))
  const file = join(dir, 'probe.mts')
  writeFileSync(file, source)
  const r = spawnSync(tsx, [file], { encoding: 'utf8', cwd: repoGame })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

test('slot request message: web and backend build byte-identical strings', () => {
  const fields = { field_id: 'Field_abc-123', slot: 9, wallet: '2'.repeat(44), payment_signature: '4'.repeat(88) }
  const ts = 1800000000
  const out = runTs(`
import { slotRequestMessage } from ${JSON.stringify(protocolPath)};
import { requestAuthMessage } from ${JSON.stringify(backendAuth)};
const f = ${JSON.stringify(fields)};
console.log(JSON.stringify({ web: slotRequestMessage(f, ${ts}), backend: requestAuthMessage(f, ${ts}).toString('utf8') }));
`)
  assert.equal(out.web, out.backend)
  assert.equal(out.web, [
    'ares1-slot-request-v1',
    `field=${fields.field_id}`,
    'slot=9',
    `wallet=${fields.wallet}`,
    `payment=${fields.payment_signature}`,
    `ts=${ts}`,
  ].join('\n'))
})

test('slot request message: free slot uses payment=- on both sides', () => {
  const fields = { field_id: 'F1', slot: 1, wallet: '2'.repeat(44), payment_signature: null }
  const out = runTs(`
import { slotRequestMessage } from ${JSON.stringify(protocolPath)};
import { requestAuthMessage } from ${JSON.stringify(backendAuth)};
const f = ${JSON.stringify(fields)};
console.log(JSON.stringify({ web: slotRequestMessage(f, 5), backend: requestAuthMessage(f, 5).toString('utf8') }));
`)
  assert.equal(out.web, out.backend)
  assert.ok(out.web.includes('\npayment=-\n'))
})

test('slot rules: 1–6 free, 7–12 paid, 12 slots in total', () => {
  const out = runTs(`
import { isPaidSlot, slotNumbers } from ${JSON.stringify(protocolPath)};
console.log(JSON.stringify({ paid: slotNumbers().map(isPaidSlot), n: slotNumbers().length }));
`)
  assert.equal(out.n, 12)
  assert.deepEqual(out.paid, [false, false, false, false, false, false, true, true, true, true, true, true])
})

test('price: only positive integer base units; SKR formatting keeps every digit', () => {
  const out = runTs(`
import { parseSlotPrice, formatSkr } from ${JSON.stringify(protocolPath)};
console.log(JSON.stringify({
  ok: parseSlotPrice('500000000')?.toString() ?? null,
  zero: parseSlotPrice('0'),
  lead0: parseSlotPrice('05'),
  dec: parseSlotPrice('1.5'),
  empty: parseSlotPrice(''),
  fmt: formatSkr(500000000n),
  fmt2: formatSkr(1234567n),
  fmt3: formatSkr(1000000n),
  fmt4: formatSkr(1n),
}));
`)
  assert.equal(out.ok, '500000000')
  assert.equal(out.zero, null)
  assert.equal(out.lead0, null)
  assert.equal(out.dec, null)
  assert.equal(out.empty, null)
  assert.equal(out.fmt, '500')
  assert.equal(out.fmt2, '1.234567')
  assert.equal(out.fmt3, '1')
  assert.equal(out.fmt4, '0.000001')
})

test('paid SKR slots stay hard-disabled in both client and backend until launch approval', () => {
  const env = readFileSync(join(webRoot, '.env.example'), 'utf8')
  assert.doesNotMatch(env, /VITE_SLOTS_ENABLED|VITE_SLOT_PRICE_UNITS|VITE_SLOT_TREASURY_OWNER/)
  const fieldsPanel = readFileSync(join(webRoot, 'src/fields/FieldsPanel.tsx'), 'utf8')
  assert.match(fieldsPanel, /slotsReady\(\) && <Suspense/)
  const cfg = readFileSync(join(webRoot, 'src/slots/config.ts'), 'utf8')
  assert.match(cfg, /export const SLOTS_ENABLED = false/)
  assert.match(cfg, /export function slotsReady\(\): boolean \{\s*return false/)
  const backend = readFileSync(join(webRoot, '../backend/src/slots/config.ts'), 'utf8')
  assert.match(backend, /!USER_SKR_SLOT_PURCHASES_ENABLED \|\| env\.SLOTS_ENABLED !== 'true'/)
})
