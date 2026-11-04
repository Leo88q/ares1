import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * P2-2-следствие: реферальная программа закрыта на регистрацию.
 *
 * Награда рефереру и скидка покупателю существовали только в легаси
 * `fill_order`. Легаси-рынок закрыт на запись, поэтому регистрация обещала бы
 * выплаты, которых не будет. Страж держит три вещи, которые легко «починить»
 * по отдельности и разойтись:
 *   1. программа отвечает `ReferralProgramRetired` (6059) до любых эффектов;
 *   2. инструкция остаётся в ABI (клиенты получают понятный отказ), а код
 *      ошибки — последний, чтобы не перенумеровать существующие;
 *   3. UI не обещает выплат и не собирает регистрацию.
 */

const RUST = 'programs/solana_potato/src/lib.rs'
const UI = 'apps/web/src/components/ReferralSection.tsx'
const IDL = 'apps/web/src/idl.json'

const rust = readFileSync(RUST, 'utf8')
const idl = JSON.parse(readFileSync(IDL, 'utf8'))

function rustBody(name: string): string {
  const match = new RegExp(`pub fn ${name}[<(]`).exec(rust)
  assert.ok(match, `в lib.rs нет функции ${name}`)
  const start = match.index
  const next = rust.slice(start + 1).search(/\npub fn /)
  return next < 0 ? rust.slice(start) : rust.slice(start, start + 1 + next)
}

test('регистрация закрыта константой и гейтом до эффектов', () => {
  assert.match(rust, /pub const REFERRAL_PROGRAM_ENABLED: bool = false;/)
  assert.match(
    rust,
    /pub fn referral_program_enabled\(\) -> bool \{\s*REFERRAL_PROGRAM_ENABLED\s*\}/,
    'гейт обязан быть тонкой обёрткой: тест и инструкция читают один источник',
  )
  const body = rustBody('register_referrer')
  const gate = /require!\(\s*referral_program_enabled\(\),\s*GameError::ReferralProgramRetired\s*\)/.exec(body)
  assert.ok(gate, 'register_referrer не гейтит закрытие программы')
  const before = body.slice(0, gate.index)
  for (const effect of ['token::burn', 'ctx.accounts.referral.referrer =', 'emit!(ReferrerRegistered']) {
    assert.ok(!before.includes(effect), `до гейта найден эффект: ${effect}`)
  }
})

test('инструкция остаётся в ABI, код 6059 — последний', () => {
  const names = idl.instructions.map((ix: { name: string }) => ix.name)
  assert.ok(names.includes('register_referrer'), 'клиенты должны получать отказ программы, а не «unknown instruction»')
  assert.equal(idl.instructions.length, 48)
  const errors = idl.errors as { code: number; name: string }[]
  const last = errors[errors.length - 1]
  assert.equal(last.name, 'ReferralProgramRetired')
  assert.equal(last.code, 6059)
  assert.ok(errors.every((e, i) => e.code === 6000 + i), 'коды идут подряд с 6000')
})

test('UI не обещает реферальных выплат и не собирает регистрацию', () => {
  const ui = readFileSync(UI, 'utf8')
  assert.match(ui, /Реферальная программа закрыта/)
  assert.doesNotMatch(ui, /buildRefLink|clipboard|useState/, 'у закрытой программы нет ссылки и кнопок')
  assert.doesNotMatch(ui, /\d\s?%/, 'никаких процентов: их некому платить')

  // Авторегистрации по ?ref= в приложении больше нет: хук удалён вместе с
  // обещанием, а не отключён флагом внутри — иначе он остался бы вызываемым.
  const app = readFileSync('apps/web/src/App.tsx', 'utf8')
  assert.ok(!app.includes('useReferralRegistration'))
  const hooks = readFileSync(UI, 'utf8')
  assert.ok(!hooks.includes('ixRegisterReferrer'))
})
