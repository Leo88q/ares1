import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * P1-3: Field обязан быть самоописывающимся аккаунтом, а адрес — проверяться.
 *
 * До layout v3 (`field_id: u64` в конце, 78 байт) аккаунт не знал своего id.
 * Из этого следовали две дыры, обе класса «доказательство подделывается
 * посторонним аккаунтом»:
 *   1. `harvest` / `repair_field` / `pay_tax` / `apply_fertilizer` /
 *      `upgrade_field` / `close_field` принимали `Account<Field>` без `seeds`:
 *      подошёл любой program-owned аккаунт с дискриминатором Field и нужным
 *      `owner` (а такой аккаунт можно было получить, пока `migrate_field` не
 *      проверял канонический PDA);
 *   2. доказательства квестов (`verify_fields`) и `batch_harvest` разбирали
 *      `remaining_accounts` вручную — там проверялся только владелец программы.
 *
 * После v3 обе проверки выразимы структурно: `seeds = [b"field", field_id]`.
 * Тест держит три вещи, которые легко потерять при следующей правке:
 *   • каждая инструкция, принимающая СУЩЕСТВУЮЩИЙ Field, объявляет seeds и bump;
 *   • создание (`init`) по-прежнему привязывает адрес к аргументу `field_id`;
 *   • ручные разборы (`verify_fields`, `batch_harvest`) сверяют адрес с id.
 */

const LIB_RS = 'programs/solana_potato/src/lib.rs'
const rust = readFileSync(LIB_RS, 'utf8')
const idl = JSON.parse(readFileSync('apps/web/src/idl.json', 'utf8')) as {
  types: Array<{ name: string; type: { fields?: Array<{ name: string; type: unknown; docs?: string[] }> } }>
}

/** Rust-тип → размер в байтах Borsh (только то, что встречается в Field). */
const SIZE: Record<string, number> = {
  u8: 1,
  i64: 8,
  u64: 8,
  bool: 1,
  Pubkey: 32,
}

/** Тело `pub struct Field { ... }` из lib.rs. */
function structBody(name: string): string {
  const start = rust.indexOf(`pub struct ${name} {`)
  assert.ok(start !== -1, `в lib.rs нет struct ${name}`)
  const open = rust.indexOf('{', start)
  let depth = 0
  for (let i = open; i < rust.length; i += 1) {
    if (rust[i] === '{') depth += 1
    else if (rust[i] === '}') {
      depth -= 1
      if (depth === 0) return rust.slice(open + 1, i)
    }
  }
  throw new Error(`незакрытое тело struct ${name}`)
}

interface RustField {
  name: string
  type: string
}

/** Поля структуры в порядке объявления (комментарии и атрибуты пропускаются). */
function rustStructFields(name: string): RustField[] {
  const fields: RustField[] = []
  for (const rawLine of structBody(name).split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('pub ')) continue
    // Хвостовой `//`-комментарий у поля (mutation_type) — не часть объявления.
    const match = /^pub (\w+): ([\w:]+),?(?:\s*\/\/.*)?$/.exec(line)
    assert.ok(match, `не разобрано поле структуры ${name}: ${line}`)
    fields.push({ name: match[1]!, type: match[2]!.split('::').pop()! })
  }
  return fields
}

/** Атрибут `#[account(...)]`, непосредственно предшествующий строке `lineIndex`. */
function accountAttributeBefore(lineIndex: number): string | null {
  let i = lineIndex - 1
  // Пропускаем doc-комментарии и пустые строки между атрибутом и полем.
  while (i >= 0 && (rust.split('\n')[i]!.trim().startsWith('///') || rust.split('\n')[i]!.trim() === '')) i -= 1
  const text = rust.split('\n').slice(0, i + 1).join('\n')
  const start = text.lastIndexOf('#[account(')
  if (start === -1) return null
  let depth = 0
  for (let k = start + '#[account('.length - 1; k < rust.length; k += 1) {
    if (rust[k] === '(') depth += 1
    else if (rust[k] === ')') {
      depth -= 1
      if (depth === 0) return rust.slice(start, k + 1)
    }
  }
  return null
}

test('Field v3: layout в Rust, IDL и клиентах совпадает побайтово', () => {
  const fields = rustStructFields('Field')
  assert.deepEqual(fields.map(f => f.name), [
    'owner',
    'level',
    'durability',
    'last_harvest',
    'tax_paid_until',
    'fertilizer_until',
    'is_active',
    'field_type',
    'bump',
    'mutation_type',
    'field_id',
  ])
  // Размер обязан совпадать с пином lib.rs и белым списком миграций.
  const size = 8 + fields.reduce((sum, f) => {
    const bytes = SIZE[f.type]
    assert.ok(bytes !== undefined, `неизвестный тип поля Field: ${f.type}`)
    return sum + bytes
  }, 0)
  assert.equal(size, 78, 'Field должен быть 78 байт: 8 дискриминатор + 62 payload v2 + field_id u64')

  const idlField = idl.types.find(t => t.name === 'Field')
  assert.ok(idlField, 'в apps/web/src/idl.json нет типа Field')
  assert.deepEqual(
    idlField.type.fields?.map(f => f.name),
    fields.map(f => f.name),
    'порядок и состав полей Field в IDL разошлись с lib.rs',
  )
  // Клиенты декодируют аккаунт вручную: их фильтр и документ обязаны знать 78.
  const consumers: Array<[string, RegExp]> = [
    ['scripts/grant-potato-core.ts', /export const FIELD_ACCOUNT_SIZE = 78$/m],
    ['scripts/grant-potato-core.ts', /export const FIELD_ACCOUNT_SIZE_V2 = 70$/m],
    ['apps/backend/src/anchorRaw.ts', /validateAccount\(data, "Field", \[70, 78\]\)/],
    ['apps/web/src/contexts/GameContext.tsx', /const FIELD_ACCOUNT_SIZES = \[78, 70\] as const/],
    ['apps/web/src/components/StatsScreen.tsx', /const FIELD_ACCOUNT_SIZES = \[78, 70\] as const/],
    ['apps/web/src/components/MainScreen.tsx', /const FIELD_ACCOUNT_DATA_BYTES = 78/],
    ['scripts/estimate-game-rent.ts', /const FIELD_ACCOUNT_BYTES = 78;/],
    ['docs/API.md', /^\| Field \| `field`, field ID u64 LE \| 78 /m],
  ]
  for (const [file, pattern] of consumers) {
    assert.match(readFileSync(file, 'utf8'), pattern, `${file}: размер Field не совпадает с layout v3`)
  }
})

test('каждая инструкция с существующим Field привязывает адрес к field_id', () => {
  const lines = rust.split('\n')
  const sites = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(site => site.line === "pub field: Account<'info, Field>,")
  assert.ok(sites.length >= 7, `ожидались все инструкции с Field, найдено ${sites.length}`)

  const problems: string[] = []
  let creations = 0
  let consumers = 0
  for (const site of sites) {
    const attribute = accountAttributeBefore(site.index)
    const line = site.index + 1
    if (!attribute) {
      problems.push(`lib.rs:${line}: у Account<Field> нет #[account(...)] — адрес не проверяется`)
      continue
    }
    const isInit = /\binit\b/.test(attribute)
    if (isInit) {
      creations += 1
      // Создание: id приходит аргументом инструкции.
      if (!/seeds = \[b"field", field_id\.to_le_bytes\(\)\.as_ref\(\)\]/.test(attribute)) {
        problems.push(`lib.rs:${line}: init-аккаунт Field должен выводиться из аргумента field_id`)
      }
      continue
    }
    consumers += 1
    if (!/seeds = \[b"field", field\.field_id\.to_le_bytes\(\)\.as_ref\(\)\]/.test(attribute)) {
      problems.push(`lib.rs:${line}: существующий Field без seeds = [b"field", field.field_id]`)
    }
    if (!/bump = field\.bump/.test(attribute)) {
      problems.push(`lib.rs:${line}: существующий Field без bump = field.bump`)
    }
  }
  assert.equal(creations, 3, 'создателей Field должно быть ровно три: create_field, buy_field_sol, buy_field_skr')
  assert.deepEqual(problems, [], problems.join('\n'))
  assert.ok(consumers >= 4, `потребителей Field меньше ожидаемого: ${consumers}`)
})

test('ручные разборы remaining_accounts сверяют адрес с field_id', () => {
  // verify_fields (доказательства квестов) и batch_harvest не проходят через
  // Anchor-констрейнты, поэтому каноничность адреса проверяется в коде.
  const checks = rust.match(/find_program_address\(\s*&\[b"field", &f\.field_id\.to_le_bytes\(\)\]/g) ?? []
  assert.ok(
    checks.length >= 2,
    `ожидались проверки в verify_fields и batch_harvest, найдено ${checks.length}`,
  )
  // Миграция — единственное место, где id приходит снаружи, и она обязана
  // принимать ровно три раскладки: 69 (v1), 70 (v2) и 78 (v3).
  assert.match(
    readFileSync('programs/solana_potato/src/migrations.rs', 'utf8'),
    /check_layout\(data, Field::DISCRIMINATOR, &\[69, 70, 78\]\)\?/,
    'белый список layouts для Field должен содержать 69, 70 и 78',
  )
  assert.match(
    readFileSync('scripts/migrationClient.ts', 'utf8'),
    /field: \{ name: 'Field', legacy: \[69, 70\], current: 78 \}/,
    'scripts/migrationClient.ts должен знать текущий layout Field v3',
  )
})
