import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  BATCH_LIMIT_BASE,
  BATCH_LIMIT_LICENSED,
  BPS,
  CANCEL_COOLDOWN_HOURS,
  EXPORT_LICENSE_PRICE_SKR_ATOMS,
  FEE_BURN_PERCENT,
  FERTILIZER_HOURS,
  FERTILIZER_YIELD_BPS,
  FIELD_TYPES,
  HARVEST_THRESHOLD_MICRO,
  LUNAR_TABLE,
  MAX_ACCRUAL_SECONDS,
  MAX_DURABILITY,
  MAX_FERTILIZER_PREPAY_DAYS,
  MAX_FIELD_LEVEL,
  MAX_TAX_PREPAY_DAYS,
  MICRO,
  MIN_HARVEST_INTERVAL,
  MIN_ORDER_AMOUNT_POTATO,
  ORDER_TTL_HOURS,
  TAX_PERIOD_DAYS,
  UNPAID_TAX_YIELD_BPS,
  durabilityMultBps,
  feeBps,
  levelMultBps,
} from '../../apps/web/src/utils/constants'

// Зеркала ончейн-констант: клиент печатает цены, комиссии и доходность по
// своей копии значений из `programs/solana_potato/src/lib.rs`. Тест держит
// две вещи одновременно:
//   1. golden-литералы — независимые от реализации значения (мутация в
//      константе или формуле обязана его сломать);
//   2. сверку с Rust-источником — расхождение зеркала с программой.
// Причина: мутационный прогон 2026-09-27 показал, что половина мутаций в
// economics-константах не ловится ни одним набором тестов — тесты сравнивали
// константу саму с собой (`expected` считался из той же константы).

const rust = fs.readFileSync('programs/solana_potato/src/lib.rs', 'utf8')

/** Подстановки для выражений Rust (только те, что встречаются в lib.rs). */
const RUST_CONSTS: Record<string, number> = { SECONDS_PER_DAY: 86_400, MICRO: 1_000_000, BPS: 10_000 }

/** Число из `pub const NAME: u64 = <expr>;` с подстановкой простых констант. */
function rustExpr(name: string): number {
  const match = new RegExp(
    `pub const ${name}\\s*:\\s*(?:u8|u16|u32|u64|u128|i64|usize)\\s*=\\s*([^;]+);`,
  ).exec(rust)
  assert(match, `в lib.rs нет константы ${name}`)
  const raw = match[1].replace(/\/\/.*/, '').trim()
  const substituted = raw.replace(/[A-Z][A-Z_]*/g, ident => {
    assert(ident in RUST_CONSTS, `неизвестный идентификатор ${ident} в ${name}`)
    return String(RUST_CONSTS[ident])
  })
  const normalized = substituted.replaceAll('_', '')
  assert.match(normalized, /^[0-9\s*+/()-]+$/, `выражение ${name} не сводится к арифметике: ${raw}`)
  const value = Number(new Function(`return (${normalized})`)())
  assert(Number.isInteger(value), `${name} не целое: ${raw}`)
  return value
}

function rustBody(name: string): string {
  const start = rust.indexOf(`pub fn ${name}(`)
  assert(start >= 0, `в lib.rs нет функции ${name}`)
  const next = rust.indexOf('\npub fn ', start + 1)
  return rust.slice(start, next < 0 ? undefined : next)
}

/** Числа, стоящие в теле функции отдельным оператором (`900`, `1_200`). */
function rustReturnedNumbers(name: string): number[] {
  return rustBody(name)
    .replace(/\/\/.*$/gm, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[0-9][0-9_]*$/.test(line))
    .map(line => Number(line.replaceAll('_', '')))
}

/** Значения из match-арм (`0 => 3_500,`), по порядку. */
function rustMatchArms(name: string): number[] {
  const values = [...rustBody(name).matchAll(/=>\s*([0-9][0-9_]*)/g)].map(m => Number(m[1].replaceAll('_', '')))
  assert(values.length >= 3, `в ${name} не найдены значения match-арм`)
  return values
}

test('зеркальные константы совпадают с Rust-источником', () => {
  assert.equal(MICRO, rustExpr('MICRO'))
  assert.equal(BPS, rustExpr('BPS'))
  assert.equal(MAX_FIELD_LEVEL, rustExpr('MAX_FIELD_LEVEL'))
  assert.equal(MIN_HARVEST_INTERVAL, rustExpr('MIN_HARVEST_INTERVAL'))
  assert.equal(MAX_DURABILITY, rustExpr('MAX_DURABILITY'))
  assert.equal(FEE_BURN_PERCENT, rustExpr('FEE_BURN_PERCENT'))
  assert.equal(EXPORT_LICENSE_PRICE_SKR_ATOMS, BigInt(rustExpr('EXPORT_LICENSE_PRICE_SKR_ATOMS')))
  assert.equal(UNPAID_TAX_YIELD_BPS, rustExpr('UNPAID_TAX_YIELD_BPS'))
  assert.equal(FERTILIZER_YIELD_BPS, rustExpr('FERTILIZER_YIELD_BPS'))
})

test('денежные/временные окна клиента совпадают с Rust', () => {
  assert.equal(MIN_ORDER_AMOUNT_POTATO, rustExpr('MIN_ORDER_AMOUNT_MICRO') / rustExpr('MICRO'))
  assert.equal(TAX_PERIOD_DAYS * 86_400, rustExpr('TAX_PERIOD'))
  assert.equal(MAX_TAX_PREPAY_DAYS * 86_400, rustExpr('MAX_TAX_PREPAY'))
  assert.equal(FERTILIZER_HOURS * 3_600, rustExpr('FERTILIZER_DURATION'))
  assert.equal(MAX_FERTILIZER_PREPAY_DAYS * 86_400, rustExpr('MAX_FERTILIZER_PREPAY'))
  assert.equal(ORDER_TTL_HOURS * 3_600, rustExpr('ORDER_TTL'))
  assert.equal(CANCEL_COOLDOWN_HOURS * 3_600, rustExpr('CANCEL_COOLDOWN'))
  assert.equal(MAX_ACCRUAL_SECONDS, rustExpr('MAX_ACCRUAL_SECONDS'))
})

test('доходность и стоимость типов полей совпадают с Rust (все три типа)', () => {
  assert.deepEqual(FIELD_TYPES.map(t => t.yieldBps), rustMatchArms('type_yield_bps'))
  assert.deepEqual(FIELD_TYPES.map(t => t.costBps), rustMatchArms('type_cost_bps'))
  // Golden-литералы: грядка 0.35×/0.4×, луг 1.0×/1.0×, поле 2.1×/2.0×.
  assert.deepEqual(FIELD_TYPES.map(t => [t.yieldBps, t.costBps]), [[3_500, 4_000], [10_000, 10_000], [21_000, 20_000]])
})

test('множитель уровня совпадает с get_level_mult и golden-таблицей', () => {
  const rustTable = rustMatchArms('get_level_mult')
  assert.deepEqual(rustTable.slice(0, 5), [10_000, 15_700, 20_400, 24_600, 28_600])
  // Rust объединяет арм `0 | 1 => 10_000`, поэтому индексы арм сдвинуты на 1.
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(levelMultBps),
    [rustTable[0], rustTable[0], rustTable[1], rustTable[2], rustTable[3], rustTable[4]],
  )
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 10, 50].map(levelMultBps),
    [10_000, 10_000, 15_700, 20_400, 24_600, 28_600, 32_600, 48_600, 208_600],
  )
  // Формула выше 5-го уровня: +4 000 bps за уровень (та же, что в Rust).
  assert.match(rustBody('get_level_mult'), /28_600 \+ \(l as u128 - 5\) \* 4_000/)
})

test('множитель целостности совпадает с Rust и golden-границами', () => {
  assert.equal(rustExpr('DURABILITY_FLOOR_BPS'), 2_000)
  assert.equal(rustExpr('DURABILITY_SLOPE_BPS_PER_POINT'), 80)
  assert.deepEqual([0, 1, 50, 99, 100, 150].map(durabilityMultBps), [2_000, 2_080, 6_000, 9_920, 10_000, 10_000])
  assert.match(rustBody('durability_mult_bps'), /DURABILITY_FLOOR_BPS \+ \(durability\.min\(MAX_DURABILITY\) as u128\) \* DURABILITY_SLOPE_BPS_PER_POINT/)
})

test('комиссия рынка совпадает с calculate_fee_bps на границах тиров', () => {
  const thresholds = [...rustBody('calculate_fee_bps').matchAll(/amount_micro < ([0-9][0-9_]*)/g)].map(m =>
    Number(m[1].replaceAll('_', '')),
  )
  assert.deepEqual(thresholds, [1_000_000_000, 10_000_000_000, 100_000_000_000])
  const rustFees = rustReturnedNumbers('calculate_fee_bps')
  assert.deepEqual(rustFees, [900, 1_000, 1_100, 1_200])
  for (const [i, threshold] of thresholds.entries()) {
    assert.equal(feeBps(threshold - 1), rustFees[i], `ниже ${threshold}`)
    assert.equal(feeBps(threshold), rustFees[i + 1], `на ${threshold}`)
  }
  // Golden-литералы по объёму ордера (9 % → 12 %).
  assert.deepEqual(
    [1_000, 999_999_999, 1_000_000_000, 9_999_999_999, 10_000_000_000, 99_999_999_999, 100_000_000_000].map(feeBps),
    [900, 900, 1_000, 1_000, 1_100, 1_100, 1_200],
  )
})

test('LUNAR_TABLE побайтово совпадает с Rust-таблицей и её экстремумами', () => {
  const start = rust.indexOf('pub const LUNAR_TABLE')
  const open = rust.indexOf('[', rust.indexOf('=', start))
  const body = rust.slice(open + 1, rust.indexOf('];', open)).replace(/\/\/.*$/gm, '')
  const rustTable = [...body.matchAll(/[0-9][0-9_]*/g)].map(m => Number(m[0].replaceAll('_', '')))
  assert.equal(rustTable.length, 28)
  assert.deepEqual([...LUNAR_TABLE], rustTable)
  assert.equal(LUNAR_TABLE.length, 28)
  assert.deepEqual(
    [LUNAR_TABLE[0], LUNAR_TABLE[7], LUNAR_TABLE[21], LUNAR_TABLE[27]],
    [10_000, 11_500, 8_500, 9_666],
  )
})

test('порог кнопки сбора и цена лицензии — golden-литералы в понятных единицах', () => {
  // 0.1 POTATO в микро-атомах; кнопка сбора активна выше этого значения.
  assert.equal(HARVEST_THRESHOLD_MICRO, 100_000)
  assert.equal(MICRO / HARVEST_THRESHOLD_MICRO, 10)
  // 500 SKR по 6 знаков.
  assert.equal(EXPORT_LICENSE_PRICE_SKR_ATOMS, 500_000_000n)
  // 60 % комиссии рынка уходит в сжигание, 40 % — в казну.
  assert.equal(FEE_BURN_PERCENT, 60)
  assert.equal(100 - FEE_BURN_PERCENT, 40)
})

test('лимиты батч-жатвы совпадают с Rust и держат премиум-тир лицензии', () => {
  // Golden-литералы: независимые от реализации значения.
  assert.equal(BATCH_LIMIT_BASE, 10)
  assert.equal(BATCH_LIMIT_LICENSED, 30)
  // Сверка с Rust-источником: зеркало не должно разъехаться с программой.
  assert.equal(BATCH_LIMIT_BASE, rustExpr('BATCH_LIMIT_BASE'))
  assert.equal(BATCH_LIMIT_LICENSED, rustExpr('BATCH_LIMIT_LICENSED'))
  // Инвариант монетизации: лицензия строго улучшает лимит, иначе перк ничего не даёт.
  assert.ok(BATCH_LIMIT_LICENSED > BATCH_LIMIT_BASE)
  // Премиум-тир обязан быть достижим: клиент режет батч по тому же лимиту,
  // что и on-chain, иначе транзакция упадёт уже после подписи.
  assert.ok(BATCH_LIMIT_LICENSED <= 30, 'лимит выше 30 полей не влезет в LUT-транзакцию')
})
