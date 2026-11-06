import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * P2-2: легаси-рынок закрыт на запись.
 *
 * Почему страж отдельный. Одна константа в lib.rs (`false`) закрывает
 * `create_sell_order`, но сама по себе она ничего не доказывает: ценность в том,
 * что (а) гейт стоит именно в этой инструкции и до любых списаний, (б) соседние
 * `fill_order` / `cancel_order` / `close_expired_order` НЕ гейтятся — иначе
 * escrow уже созданных ордеров застрял бы, (в) ошибка `LegacyMarketClosed`
 * добавлена в конец `GameError` и в IDL, а номер инструкции не изменился.
 *
 * Источник — только код программы и клиентский IDL; комментарии перед подсчётом
 * идентификаторов вырезаются, иначе упоминания в документации выдавали бы себя
 * за вызовы.
 */

const RUST = 'programs/solana_potato/src/lib.rs'
const IDL = 'apps/web/src/idl.json'

const rust = readFileSync(RUST, 'utf8')
const rustCode = rust.replace(/\/\/.*$/gm, '')
const idl = JSON.parse(readFileSync(IDL, 'utf8'))

function rustBody(name: string): string {
  // `fill_order` объявлена с явным lifetime (`pub fn fill_order<'info>(..)`),
  // поэтому имя матчится по `(`, `<` или `>` — но не как префикс: `fill_order_v2`
  // обязан остаться другой функцией.
  const match = new RegExp(`pub fn ${name}[<(]`).exec(rust)
  assert.ok(match, `в lib.rs нет функции ${name}`)
  const start = match.index
  const next = rust.slice(start + 1).search(/\npub fn /)
  return next < 0 ? rust.slice(start) : rust.slice(start, start + 1 + next)
}

test('P2-2: константа закрытия легаси-записи равна false и читается только гейтом', () => {
  assert.match(
    rust,
    /pub const LEGACY_MARKET_WRITES_ENABLED: bool = false;/,
    'константа обязана быть false: открытие обратно меняет базу комиссии (docs/ECONOMY.md §5)',
  )
  // В коде константа обязана встречаться ровно дважды: объявление и тело
  // единственного читателя `legacy_market_writes_enabled()`. Третье чтение
  // означало бы обход гейта мимо проверяемой функции.
  const uses = [...rustCode.matchAll(/LEGACY_MARKET_WRITES_ENABLED/g)].length
  assert.equal(uses, 2, `ожидалось 2 чтения константы (объявление + гейт), найдено ${uses}`)
  assert.match(
    rustCode,
    /pub fn legacy_market_writes_enabled\(\) -> bool \{\s*LEGACY_MARKET_WRITES_ENABLED\s*\}/,
    'гейт обязан быть тонкой обёрткой над константой: тест и инструкция читают один источник',
  )
})

test('P2-2: create_sell_order гейтится после валидации и до любых списаний', () => {
  const body = rustBody('create_sell_order')
  // Раскладку задаёт rustfmt (одна строка или вертикальный блок), поэтому
  // проверяем вызов, а не конкретный перенос: иначе `cargo fmt` валит страж.
  const gateMatch = /require!\(\s*legacy_market_writes_enabled\(\),\s*GameError::LegacyMarketClosed\s*\)/.exec(body)
  assert.ok(gateMatch, 'в create_sell_order нет гейта `legacy_market_writes_enabled()`')
  const gate = gateMatch.index
  const validation = body.indexOf('GameError::OrderTotalTooSmall')
  assert.ok(validation >= 0 && validation < gate, 'гейт должен стоять после валидации аргументов')
  // До гейта не должно быть ни CPI-перевода, ни записи в профиль/статистику:
  // отказ обязан быть бесплатным (никаких «списали и вернули»).
  const before = body.slice(0, gate)
  for (const forbidden of ['token::transfer', 'profile.seller =', 'stats.bump =']) {
    assert.ok(!before.includes(forbidden), `до гейта найден побочный эффект: ${forbidden}`)
  }
})

test('P2-2: доигрывание книги не гейтится — escrow старых ордеров возвращаем', () => {
  for (const name of ['fill_order', 'cancel_order', 'close_expired_order']) {
    const body = rustBody(name)
    assert.ok(
      !body.includes('legacy_market_writes_enabled') && !body.includes('LegacyMarketClosed'),
      `${name} не должен зависеть от закрытия записи: чужие escrow не застревают`,
    )
  }
})

test('P2-2: ABI не изменился, а код 6058 дописан в конец GameError', () => {
  const names = idl.instructions.map((ix: { name: string }) => ix.name)
  assert.ok(names.includes('create_sell_order'), 'инструкция остаётся в ABI: клиенты должны получать понятный отказ')
  // P2-2 сам инструкций не менял; +1 colony_spend (2026-11-06) — осознанный diff пина.
  assert.equal(idl.instructions.length, 49, 'P2-2 не добавляет и не удаляет инструкции')

  const errors = idl.errors as { code: number; name: string }[]
  const closed = errors.find(e => e.code === 6058)
  assert.ok(closed, 'код 6058 обязан существовать')
  assert.equal(closed.name, 'LegacyMarketClosed')
  // Коды не перенумеровываются: клиенты и логи сравнивают их как числа.
  const codes = errors.map((e, i) => e.code === 6000 + i)
  assert.ok(codes.every(Boolean), 'IDL: коды обязаны идти подряд с 6000')

  // Rust-объявление — тот же порядок, что IDL: последняя ошибка в enum.
  const enumBody = rust.split('pub enum GameError {')[1].split('\n}')[0]
  const rustErrors = [...enumBody.matchAll(/^    (\w+),/gm)].map(m => m[1])
  assert.equal(rustErrors.length, errors.length, 'IDL.errors и GameError разошлись по длине')
  assert.equal(rustErrors[6058 - 6000], 'LegacyMarketClosed', 'код 6058 — ровно эта ошибка по счёту')
  assert.deepEqual(rustErrors, errors.map(e => e.name))
})
