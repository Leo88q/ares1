import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  GRANT_QUOTA_SHARE_BPS,
  MAX_ACCRUAL_SECONDS,
  MAX_REWARD_MICRO,
  ORDER_TTL,
  RUST_LIB_PATH,
  SECONDS_PER_DAY,
  V2_TRADE_VOLUME_THRESHOLDS_MICRO,
  V2_SETTLEMENT_FEE_BPS,
  rustConst,
  rustConstArray,
} from '../rustConstants.js'

/**
 * Самопроверка общего парсера констант (`tests/rustConstants.ts`).
 *
 * Зачем отдельный тест. Модуль — единственный вход тестов к экономике
 * программы: если он начнёт возвращать не то (или тихо вернёт 0 на
 * неразобранном выражении), сверки в остальных наборах станут бессмысленными,
 * но останутся зелёными. Поэтому проверяются и значения на реальном `lib.rs`,
 * и громкие отказы на том, чего в программе нет.
 */

test('парсер читает тот же lib.rs, что и программа', () => {
  assert.match(RUST_LIB_PATH, /programs\/solana_potato\/src\/lib\.rs$/)
  assert.ok(fs.existsSync(RUST_LIB_PATH), `нет файла ${RUST_LIB_PATH}`)
})

test('числовые константы совпадают с объявлениями в lib.rs', () => {
  // Золотые значения — независимая от парсера точка опоры: если сломается и
  // парсер, и сверка, эти числа всё равно обязаны быть.
  assert.equal(MAX_REWARD_MICRO, 1_000_000_000n)
  assert.equal(GRANT_QUOTA_SHARE_BPS, 2_500n)
  assert.equal(ORDER_TTL, 7n * SECONDS_PER_DAY)
  assert.equal(rustConst('MICRO'), 1_000_000n)
  assert.equal(rustConst('BPS'), 10_000n)
})

test('выражения из других констант вычисляются, а не читаются как текст', () => {
  // В lib.rs это `7 * SECONDS_PER_DAY`, `6 * 3600`, `3 * 3600` — регулярка
  // «число после =» вернула бы здесь 7, 6 и 3.
  assert.equal(MAX_ACCRUAL_SECONDS, 7n * 86_400n)
  assert.equal(rustConst('DURABILITY_DECAY_INTERVAL'), 6n * 3_600n)
  assert.equal(rustConst('CANCEL_COOLDOWN'), 3n * 3_600n)
  assert.equal(rustConst('TAX_PERIOD'), 7n * 86_400n)
  assert.equal(rustConst('EPOCH_DURATION'), 86_400n)
})

test('массивы читаются целиком, включая многострочные и с типом [T; N]', () => {
  assert.deepEqual(V2_SETTLEMENT_FEE_BPS, [500n, 600n, 700n, 800n])
  assert.equal(V2_TRADE_VOLUME_THRESHOLDS_MICRO.length, 3)
  // Лестница обязана расти: иначе «прогрессивная» комиссия перестала бы быть
  // прогрессивной, а маржинальный расчёт в V2 — монотонным.
  for (let i = 1; i < V2_SETTLEMENT_FEE_BPS.length; i += 1) {
    assert.ok(V2_SETTLEMENT_FEE_BPS[i]! > V2_SETTLEMENT_FEE_BPS[i - 1]!, 'ставки V2 должны возрастать')
  }
  for (let i = 1; i < V2_TRADE_VOLUME_THRESHOLDS_MICRO.length; i += 1) {
    assert.ok(
      V2_TRADE_VOLUME_THRESHOLDS_MICRO[i]! > V2_TRADE_VOLUME_THRESHOLDS_MICRO[i - 1]!,
      'границы объёма V2 должны возрастать',
    )
  }
  // Многострочная таблица: тип `[u16; 28]` содержит `;`, поэтому проверяется
  // и разбор типа, и разбор значения.
  assert.equal(rustConstArray('LUNAR_TABLE').length, 28)
})

test('отсутствие константы и путаница массив/число — это ошибка, а не ноль', () => {
  assert.throws(() => rustConst('NO_SUCH_CONSTANT'), /нет константы NO_SUCH_CONSTANT/)
  assert.throws(() => rustConst('V2_SETTLEMENT_FEE_BPS'), /массив/)
  assert.throws(() => rustConstArray('MAX_REWARD_MICRO'), /не массив/)
  // Опечатка в имени не должна «находиться» по префиксу.
  assert.throws(() => rustConst('MAX_REWARD'), /нет константы MAX_REWARD/)
})

test('Anchor-набор берёт границы из программы, а не из литералов', () => {
  const suite = fs.readFileSync('tests/solana_potato.ts', 'utf8')
  // Импорт обязан быть: без него константы снова расползутся по тесту.
  assert.match(suite, /from "\.\/rustConstants"/, 'tests/solana_potato.ts должен импортировать rustConstants')
  // Литералы, которые уже убраны: их возврат означает рассинхрон с lib.rs.
  for (const literal of ['1_000_000_001', 'muln(25)', '2_000_000_000']) {
    assert.equal(
      suite.includes(literal),
      false,
      `литерал ${literal} вернулся в набор: сверяйте с константой программы, а не с копией`,
    )
  }
  // Квота грантов и потолок одной выплаты приходят из модуля.
  assert.match(suite, /GRANT_QUOTA_SHARE_BPS/)
  assert.match(suite, /MAX_REWARD_MICRO/)
})
