/**
 * Единственный источник экономических констант для тестов.
 *
 * Зачем. Экономика программы живёт в `lib.rs` (`MAX_REWARD_MICRO`, квота
 * грантов, тарифы V2, TTL ордера, цены апкипа…). Тесты на цепи и офчейн-тесты
 * сверялись с ней двумя разными способами: Anchor-набор писал числа литералами
 * (`fee = 5_000_000n`), а офчейн-тесты парсили `lib.rs` каждый по-своему — в
 * четырёх файлах было четыре регулярки. Литерал в наборе тестов не ломается
 * при смене константы и не говорит, откуда взялось число, поэтому правка
 * экономики проходила CI молча и падала только на цепи.
 *
 * Теперь значения читаются из `lib.rs` один раз и экспортируются как bigint:
 * тест сравнивает поведение программы с её же константой, а не с копией.
 * Значение намеренно не кешируется между импортами разных процессов — файл
 * читается при загрузке модуля, как и раньше делал каждый офчейн-тест.
 *
 * Границы. Парсер понимает ровно то, что используется в `lib.rs`:
 *   * числовой литерал с `_` и необязательным `-`;
 *   * имя другой константы;
 *   * арифметику `+ - * /` и скобки (`7 * SECONDS_PER_DAY`, `6 * 3600`);
 *   * массивы чисел (`[500, 600, 700, 800]`), в том числе многострочные.
 * Всё остальное (вызовы, `pubkey!`, строки) — ошибка, а не «0»: тест обязан
 * упасть громко, если константа переехала, а не молча сверить с пустотой.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Пути, по которым `lib.rs` ищется относительно рабочей директории. */
const CANDIDATES = [
  path.join('programs', 'solana_potato', 'src', 'lib.rs'),
  path.join('game', 'programs', 'solana_potato', 'src', 'lib.rs'),
];

/**
 * Находит `lib.rs`, поднимаясь от рабочей директории вверх.
 *
 * `anchor test` запускается из `game/`, `yarn test:offchain` — тоже; часть
 * инструментов — из корня репозитория. Оба случая покрыты кандидатами выше,
 * а подъём нужен для запусков из вложенных пакетов (`apps/backend`).
 */
function findLibRs(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    for (const candidate of CANDIDATES) {
      const full = path.join(dir, candidate);
      if (fs.existsSync(full)) return full;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `rustConstants: не найден programs/solana_potato/src/lib.rs от ${process.cwd()}; ` +
      'тесты запускаются из game/ (или корня репозитория)',
  );
}

/** Абсолютный путь к `lib.rs`, из которого прочитаны константы. */
export const RUST_LIB_PATH = findLibRs();
/** Исходник программы целиком — для тестов, которым нужен не только числа. */
export const RUST_SOURCE = fs.readFileSync(RUST_LIB_PATH, 'utf8');

/**
 * Разбор объявлений. Регуляркой тип не отделить: `pub const LUNAR_TABLE:
 * [u16; 28] = …` содержит `;` внутри типа, поэтому идём посимвольно с учётом
 * вложенности скобок: `=` на нулевой глубине — начало значения, `;` на
 * нулевой глубине (в том числе после `]` массива) — его конец.
 */
const RAW = new Map<string, string>();
for (const match of RUST_SOURCE.matchAll(/pub const ([A-Z0-9_]+):/g)) {
  const name = match[1];
  if (!name) continue;
  let depth = 0;
  let valueStart = -1;
  let valueEnd = -1;
  for (let i = (match.index ?? 0) + match[0].length; i < RUST_SOURCE.length; i += 1) {
    const ch = RUST_SOURCE[i];
    if (ch === '[' || ch === '(' || ch === '{') depth += 1;
    else if (ch === ']' || ch === ')' || ch === '}') depth -= 1;
    else if (ch === '=' && depth === 0 && valueStart < 0) valueStart = i + 1;
    else if (ch === ';' && depth === 0 && valueStart >= 0) {
      valueEnd = i;
      break;
    }
  }
  if (valueStart < 0 || valueEnd < 0) {
    throw new Error(`rustConstants: не удалось разобрать объявление ${name}`);
  }
  // Первое объявление выигрывает: дубликата в программе быть не должно,
  // а молчаливая перезапись скрыла бы его от теста.
  if (!RAW.has(name)) RAW.set(name, RUST_SOURCE.slice(valueStart, valueEnd).trim());
}

const CACHE = new Map<string, bigint>();

/** Токенизация выражения: имена, целые, операторы и скобки. */
function tokenize(expression: string, name: string): string[] {
  const tokens = expression.match(/[A-Za-z_][A-Za-z0-9_]*|[0-9][0-9_]*|[+\-*/()]/g);
  if (!tokens) throw new Error(`rustConstants: пустое выражение у ${name}`);
  const leftovers = expression.replace(/[A-Za-z_][A-Za-z0-9_]*|[0-9][0-9_]*|[+\-*/()]/g, '').replace(/\s+/g, '');
  if (leftovers) {
    throw new Error(`rustConstants: ${name} содержит неоцениваемый фрагмент «${leftovers}» в «${expression.trim()}»`);
  }
  return tokens;
}

/** Рекурсивный спуск: expression := term (('+'|'-') term)*. */
function evaluate(expression: string, name: string): bigint {
  const tokens = tokenize(expression, name);
  let index = 0;

  const peek = (): string | undefined => tokens[index];
  const take = (): string => {
    const token = tokens[index];
    if (token === undefined) throw new Error(`rustConstants: неожиданный конец выражения у ${name}`);
    index += 1;
    return token;
  };

  const primary = (): bigint => {
    const token = take();
    if (token === '(') {
      const value = sum();
      if (take() !== ')') throw new Error(`rustConstants: несбалансированные скобки у ${name}`);
      return value;
    }
    if (/^[0-9]/.test(token)) return BigInt(token.replace(/_/g, ''));
    if (/^[A-Za-z_]/.test(token)) return resolve(token);
    throw new Error(`rustConstants: неожиданный токен «${token}» у ${name}`);
  };

  const product = (): bigint => {
    let value = primary();
    while (peek() === '*' || peek() === '/') {
      const operator = take();
      const right = primary();
      if (operator === '/') {
        if (right === 0n) throw new Error(`rustConstants: деление на ноль у ${name}`);
        value /= right;
      } else {
        value *= right;
      }
    }
    return value;
  };

  const sum = (): bigint => {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const operator = take();
      const right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  const result = sum();
  if (index !== tokens.length) {
    throw new Error(`rustConstants: лишние токены у ${name}: «${tokens.slice(index).join(' ')}»`);
  }
  return result;
}

function resolve(name: string): bigint {
  const cached = CACHE.get(name);
  if (cached !== undefined) return cached;
  const raw = RAW.get(name);
  if (raw === undefined) throw new Error(`rustConstants: в lib.rs нет константы ${name}`);
  if (raw.startsWith('[')) {
    throw new Error(`rustConstants: ${name} — массив; используйте rustConstArray`);
  }
  // Защита от циклов: значение кладётся в кеш только после вычисления,
  // поэтому самоссылка упрётся в лимит рекурсии, а не в вечный цикл.
  const value = evaluate(raw, name);
  CACHE.set(name, value);
  return value;
}

/** Числовое значение константы программы. Бросает, если её нет или она не число. */
export function rustConst(name: string): bigint {
  return resolve(name);
}

/** То же в `number` — для вызовов, где API требует `number` (таймстемпы, лимиты). */
export function rustConstNumber(name: string): number {
  return Number(rustConst(name));
}

/** Массив чисел: `[u16; 4] = [500, 600, 700, 800]`, в том числе многострочный. */
export function rustConstArray(name: string): bigint[] {
  const raw = RAW.get(name);
  if (raw === undefined) throw new Error(`rustConstants: в lib.rs нет константы ${name}`);
  const open = raw.indexOf('[');
  const close = raw.lastIndexOf(']');
  if (open < 0 || close <= open) throw new Error(`rustConstants: ${name} не массив: «${raw}»`);
  // Комментарии внутри массива объясняют шаг лестницы («дни 0-7 (пик)») и
  // содержат числа: без срезки они попали бы в значения.
  const body = raw.slice(open + 1, close).replace(/\/\/[^\n]*/g, '');
  const elements = [...body.matchAll(/[0-9][0-9_]*/g)].map((match) => BigInt(match[0].replace(/_/g, '')));
  if (elements.length === 0) throw new Error(`rustConstants: массив ${name} пуст`);
  return elements;
}

// ── Именованные константы, которые используют тесты ───────────────────────────
// Экспортируются значениями, а не через `rustConst('…')` на месте вызова:
// опечатка в имени — ошибка загрузки модуля, а не падение одного теста.

/** 1 🥔 в микроединицах. */
export const MICRO = rustConst('MICRO');
/** 100 % в базисных пунктах. */
export const BPS = rustConst('BPS');
export const SECONDS_PER_DAY = rustConst('SECONDS_PER_DAY');

export const MAX_DAILY_CAP_MICRO = rustConst('MAX_DAILY_CAP_MICRO');
export const MAX_REWARD_MICRO = rustConst('MAX_REWARD_MICRO');
export const GRANT_QUOTA_SHARE_BPS = rustConst('GRANT_QUOTA_SHARE_BPS');
export const MAX_REWARD_EXPIRY_SECONDS = rustConst('MAX_REWARD_EXPIRY_SECONDS');
export const DEFAULT_MAX_SUPPLY_MICRO = rustConst('DEFAULT_MAX_SUPPLY_MICRO');
export const MAX_ACCRUAL_SECONDS = rustConst('MAX_ACCRUAL_SECONDS');
export const MIN_HARVEST_INTERVAL = rustConst('MIN_HARVEST_INTERVAL');
export const DURABILITY_DECAY_INTERVAL = rustConst('DURABILITY_DECAY_INTERVAL');

export const BASE_FIELD_PRICE_MICRO = rustConst('BASE_FIELD_PRICE_MICRO');
export const BASE_TAX_MICRO = rustConst('BASE_TAX_MICRO');
export const BASE_REPAIR_MICRO = rustConst('BASE_REPAIR_MICRO');
export const BASE_FERTILIZER_MICRO = rustConst('BASE_FERTILIZER_MICRO');
export const BASE_UPGRADE_MICRO = rustConst('BASE_UPGRADE_MICRO');

export const ORDER_TTL = rustConst('ORDER_TTL');
export const CANCEL_COOLDOWN = rustConst('CANCEL_COOLDOWN');
export const MIN_ORDER_AMOUNT_MICRO = rustConst('MIN_ORDER_AMOUNT_MICRO');
export const MIN_ORDER_TOTAL_LAMPORTS = rustConst('MIN_ORDER_TOTAL_LAMPORTS');
export const FEE_BURN_PERCENT = rustConst('FEE_BURN_PERCENT');

export const EXPORT_LICENSE_PRICE_SKR_ATOMS = rustConst('EXPORT_LICENSE_PRICE_SKR_ATOMS');
export const PRESALE_PRICE_SKR_ATOMS = rustConst('PRESALE_PRICE_SKR_ATOMS');
export const SKR_DECIMALS = rustConst('SKR_DECIMALS');
export const V2_MIN_GROSS_QUOTE_ATOMS = rustConst('V2_MIN_GROSS_QUOTE_ATOMS');
export const V2_FEE_POLICY_VERSION = rustConst('V2_FEE_POLICY_VERSION');

/** Лестница ставок V2: 500/600/700/800 bps. */
export const V2_SETTLEMENT_FEE_BPS = rustConstArray('V2_SETTLEMENT_FEE_BPS');
/** Границы дневного объёма продавца, микро-POTATO. */
export const V2_SELLER_VOLUME_THRESHOLDS_MICRO = rustConstArray('V2_SELLER_VOLUME_THRESHOLDS_MICRO');

/** Ставка V2 в bps для нулевого объёма — первая ступень лестницы. */
export function v2BaseFeeBps(): bigint {
  const first = V2_SETTLEMENT_FEE_BPS[0];
  if (first === undefined) throw new Error('rustConstants: V2_SETTLEMENT_FEE_BPS пуст');
  return first;
}
