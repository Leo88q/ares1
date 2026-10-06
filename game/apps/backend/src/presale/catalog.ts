/**
 * Каталог наборов Phase 1 и пределы рельсы выдачи.
 *
 * Модуль намеренно чистый (ни БД, ни RPC), потому что именно эти числа решают,
 * что вообще можно продать: они вытекают из ончейн-констант программы, а не из
 * маркетинговых пожеланий. Любая проверка «влезет ли пак в выдачу» должна
 * считаться здесь, а не в обработчике запроса.
 *
 * Цены в SOL здесь НЕТ намеренно. Цена — решение оператора, оно фиксируется
 * в строке тиража (game_ops.presale_runs.price_units) и потому аудируемо,
 * а не зашито в код. Каталог описывает только состав.
 */

// ── Ончейн-константы (источник правды: game/programs/solana_potato/src/lib.rs) ──
// Зеркалятся вручную. Расхождение с программой означало бы, что мы обещаем
// покупателю выдачу, которую программа отклонит, поэтому значения закреплены
// тестом presale-catalog.test.ts, сверяющим их с текстом lib.rs.
export const POTATO_DECIMALS = 6;
/** lib.rs:68 — потолок одной выдачи grant_reward/grant_reward_once. */
export const MAX_REWARD_MICRO = 1_000_000_000n;
/** lib.rs:158 — цена эталонного поля типа 1 («Луг», 1.0×). */
export const BASE_FIELD_PRICE_MICRO = 250_000_000n;
/** lib.rs:66 — кап эмиссии за эпоху. */
export const MAX_DAILY_CAP_MICRO = 250_000_000_000n;
/** lib.rs:71 — доля капа эпохи, доступная ручным грантам (10 %). */
export const GRANT_QUOTA_SHARE_BPS = 1_000n;
/** lib.rs:76 — окно клейма: 15 минут. */
export const MAX_REWARD_EXPIRY_SECONDS = 900n;
const BPS = 10_000n;

/**
 * lib.rs:2121 type_cost_bps — множитель цены по типу поля.
 *
 * Расхождение с программой НАМЕРЕННОЕ и в безопасную сторону: в Rust тип 2 —
 * это catch-all `_ => 20_000`, то есть любой field_type ≥ 2 оценивается как 2×.
 * Здесь известны только 0/1/2, остальное отклоняется: продавать «тип 7» мы не
 * собираемся, а молча оценить его как Поле — значит продать то, чего нет.
 * Закреплено тестом «множители цены по типу поля совпадают с type_cost_bps».
 */
export const TYPE_COST_BPS: Readonly<Record<number, bigint>> = {
  0: 4_000n, // Грядка 0.4×
  1: 10_000n, // Луг    1.0×
  2: 20_000n, // Поле   2.0×
};

export const FIELD_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: 'Грядка',
  1: 'Луг',
  2: 'Поле',
};

/** lib.rs:2135 scaled_cost(base, type) = base * type_cost_bps / 10000. */
export function fieldPriceMicro(fieldType: number): bigint {
  const bps = TYPE_COST_BPS[fieldType];
  if (bps === undefined) throw new Error(`Неизвестный тип поля: ${fieldType}`);
  return (BASE_FIELD_PRICE_MICRO * bps) / BPS;
}

/**
 * Дневная квота ручных грантов = 10 % капа эпохи.
 * Это ГЛАВНОЕ узкое место Phase 1: через grant_reward_once физически нельзя
 * выдать больше, даже если продали больше.
 */
export function dailyGrantQuotaMicro(epochCapMicro: bigint = MAX_DAILY_CAP_MICRO): bigint {
  return (epochCapMicro * GRANT_QUOTA_SHARE_BPS) / BPS;
}

export interface PackContents {
  /** Тип поля (0/1/2) и сколько штук. */
  fields: ReadonlyArray<{ type: number; count: number }>;
}

export interface Pack extends PackContents {
  id: string;
  titleRu: string;
  titleEn: string;
}

/**
 * Каталог. Каждый пак — ровно одна выдача, потому что у grant_reward_once окно
 * клейма всего 15 минут: дробить пак на несколько грантов — значит умножать
 * число способов не получить покупку.
 *
 * Составы подобраны под потолок выдачи 1000 POTATO: каждый пак вычерпывает
 * грант целиком, поэтому все три стоят одинаково «дорого» для рельсы.
 */
export const PACKS: readonly Pack[] = [
  {
    id: 'bed-10',
    titleRu: '10 Грядок',
    titleEn: '10 Beds',
    fields: [{ type: 0, count: 10 }], // 10 × 100 = 1000 POTATO
  },
  {
    id: 'meadow-4',
    titleRu: '4 Луга',
    titleEn: '4 Meadows',
    fields: [{ type: 1, count: 4 }], // 4 × 250 = 1000 POTATO
  },
  {
    id: 'field-2',
    titleRu: '2 Поля',
    titleEn: '2 Fields',
    fields: [{ type: 2, count: 2 }], // 2 × 500 = 1000 POTATO
  },
];

export function findPack(packId: string): Pack | null {
  return PACKS.find(p => p.id === packId) ?? null;
}

/** Сколько POTATO (в микро) нужно выдать, чтобы покупатель собрал состав пака. */
export function packPotatoMicro(pack: PackContents): bigint {
  return pack.fields.reduce(
    (sum, f) => sum + fieldPriceMicro(f.type) * BigInt(f.count),
    0n,
  );
}

export function packFieldCount(pack: PackContents): number {
  return pack.fields.reduce((sum, f) => sum + f.count, 0);
}

/**
 * Проверяет, что пак вообще выдаваем существующей рельсой.
 * Возвращает список причин — не «да/нет», потому что оператору нужно видеть
 * все несоответствия сразу, а не чинить их по одному.
 */
export function validatePackDeliverability(pack: PackContents): string[] {
  const problems: string[] = [];
  // Типы и количества проверяются ПЕРЕД расчётом суммы: fieldPriceMicro бросает
  // исключение на неизвестном типе, а валидатор обязан возвращать список причин,
  // а не падать — иначе оператор увидит 500 вместо «пак собран неверно».
  for (const f of pack.fields) {
    if (TYPE_COST_BPS[f.type] === undefined) problems.push(`неизвестный тип поля ${f.type}`);
    if (!Number.isInteger(f.count) || f.count <= 0) problems.push(`некорректное количество для типа ${f.type}`);
  }
  if (problems.length) return problems;

  const micro = packPotatoMicro(pack);
  if (micro <= 0n) problems.push('пустой состав: выдавать нечего');
  if (micro > MAX_REWARD_MICRO) {
    problems.push(
      `состав требует ${micro} микро, а потолок одной выдачи ${MAX_REWARD_MICRO} — ` +
      'нужен новый инстант программы (deploy), которого при бюджете <1 SOL нет',
    );
  }
  return problems;
}

/**
 * Сколько паков в сутки рельса способна выдать при заданном составе.
 * 25 000 POTATO/сутки ÷ 1000 POTATO на пак = 25 паков в сутки. Это не
 * маркетинговое ограничение, а физика charge_epoch_grant.
 */
export function packsPerDay(pack: PackContents, epochCapMicro: bigint = MAX_DAILY_CAP_MICRO): number {
  const micro = packPotatoMicro(pack);
  if (micro <= 0n) return 0;
  return Number(dailyGrantQuotaMicro(epochCapMicro) / micro);
}

/**
 * Сколько суток займёт выдача тиража. Округление ВВЕРХ: обещать «3 дня»
 * при 3.2 дня — это обещание, которое мы нарушим.
 */
export function deliveryDays(pack: PackContents, totalPacks: number, epochCapMicro?: bigint): number {
  const perDay = packsPerDay(pack, epochCapMicro);
  if (perDay <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(totalPacks / perDay);
}

// ─────────────────────────────────────────────────────────────────────────────
// Пыль в базовых единицах: автопривязка платежа без процессинга
// ─────────────────────────────────────────────────────────────────────────────

export type Currency = 'sol' | 'skr';

/**
 * lib.rs:159 — минт SKR, в котором программа принимает платежи.
 * lib.rs:167 — SKR_DECIMALS = 6, то есть 1 SKR = 1_000_000 атомов.
 *
 * Зачем это здесь: у SOL 9 знаков, у SKR 6. Ошибка в разрядности — это ровно
 * тот класс бага, про который в lib.rs:220 написано «иначе все SKR-цены
 * съехали бы на 10^k». Поэтому пересчёт всегда идёт через эти константы.
 */
export const SKR_MINT = 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';
export const SKR_DECIMALS = 6;
export const SOL_DECIMALS = 9;

export interface CurrencySpec {
  id: Currency;
  /** Знаков после запятой: 9 у SOL, 6 у SKR. */
  decimals: number;
  /** Сколько базовых единиц в одной «человеческой». */
  unitsPerWhole: bigint;
  label: string;
}

export const CURRENCIES: Readonly<Record<Currency, CurrencySpec>> = {
  sol: { id: 'sol', decimals: SOL_DECIMALS, unitsPerWhole: 1_000_000_000n, label: 'SOL' },
  skr: { id: 'skr', decimals: SKR_DECIMALS, unitsPerWhole: 1_000_000n, label: 'SKR' },
};

export function currencySpec(currency: Currency): CurrencySpec {
  const spec = CURRENCIES[currency];
  if (!spec) throw new Error(`Неизвестная валюта: ${String(currency)}`);
  return spec;
}

/** Перевод «человеческой» суммы в базовые единицы без плавающей точки. */
export function toUnits(currency: Currency, whole: bigint): bigint {
  return whole * currencySpec(currency).unitsPerWhole;
}

/**
 * Ожидаемая сумма перевода = база тиража + номер заказа.
 *
 * Зачем: без платёжного процессора мы видим только «пришло N базовых единиц».
 * Если у каждого заказа сумма уникальна, платёж привязывается арифметикой,
 * а не ручной сверкой. Работает одинаково для SOL и SKR, потому что order_no
 * добавляется в базовых единицах: для SOL это ≤ 0.0001 SOL пыли, для SKR —
 * ≤ 0.0001 SKR, то есть ещё незаметнее.
 *
 * Требование к базе: `basePriceUnits` должна быть заметно больше cap, иначе
 * пыль перестанет быть пылью. Проверяется в assertDustIsNegligible.
 */
export function expectedUnits(basePriceUnits: bigint, orderNo: number): bigint {
  if (basePriceUnits <= 0n) throw new Error('basePriceUnits должен быть больше 0');
  if (!Number.isInteger(orderNo) || orderNo <= 0) throw new Error('orderNo должен быть целым > 0');
  return basePriceUnits + BigInt(orderNo);
}

/** Обратная операция: какой номер заказа зашит в сумму. 0 = не похоже на наш платёж. */
export function orderNoFromUnits(basePriceUnits: bigint, receivedUnits: bigint): number {
  const diff = receivedUnits - basePriceUnits;
  if (diff <= 0n) return 0;
  const n = Number(diff);
  return Number.isSafeInteger(n) ? n : 0;
}

/**
 * Пыль обязана оставаться пренебрежимой: если cap сопоставим с ценой,
 * «пыль» становится скидкой, а два соседних заказа начинают отличаться
 * на ощутимую для покупателя сумму.
 */
export function assertDustIsNegligible(currency: Currency, basePriceUnits: bigint, cap: number): void {
  const spec = currencySpec(currency);
  // Пыль не больше 0.1 % цены: при cap до 100 000 это означает цену
  // не ниже 100 000 000 базовых единиц (0.1 SOL или 100 SKR).
  if (basePriceUnits < BigInt(cap) * 1_000n) {
    throw new Error(
      `База цены ${basePriceUnits} слишком мала для тиража в ${cap}: ` +
      `пыль в ${cap} базовых единиц ${spec.label} превысит 0.1 % цены`,
    );
  }
}
