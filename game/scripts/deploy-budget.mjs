#!/usr/bin/env node
/**
 * deploy-budget — честный расчёт минимального баланса деплоера (SOL).
 *
 * Модель выведена из исходников loader-v3 (Agave) и проверяется калибровкой на
 * localnet в CI; см. reports/rent-audit/. Все денежные величины — целые лампорты
 * (BigInt, R4). Ставка rent, размеры и комиссии берутся из RPC/измерений: ставка
 * задаётся ответом `getMinimumBalanceForRentExemption([0])`, а не константой (R3).
 *
 * Использование:
 *   node scripts/deploy-budget.mjs --so target/deploy/solana_potato.so
 *   node scripts/deploy-budget.mjs --so-len 971392 --mode upgrade --rpc <url> --deployer <pubkey>
 *   node scripts/deploy-budget.mjs --so-len 450000 --offline-rate <ставка>   # тесты, не боевой расчёт
 *
 * Коды выхода: 0 — баланса хватает; 3 — нехватка; 2 — ошибка RPC или формулы.
 *
 * Переменные окружения:
 *   RESERVE_SOL            десятичная строка SOL (по умолчанию 0.30, пол 0.25)
 *   FEE_SAFETY_PCT         запас на комиссии в процентах (по умолчанию 110)
 *   PRIORITY_MICROLAMPORTS цена приоритета, микролампорты за CU (по умолчанию 100000)
 *   GROWTH_HEADROOM_BYTES  запас к max_len (по умолчанию 0)
 *   SETUP_ONCHAIN_LAMPORTS измеренное значение init-onchain (переопределяет оценку)
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSION = 'deploy-budget/1.0';

/**
 * Константы loader-v3 и оценки из §5.3 отчёта. Разрешены только эти числа:
 * размеры заголовков loader-v3, минимум extend по SIMD-0431, базовая подпись и
 * консервативные оценки чанка записи и CU (с источником — комментарий).
 */
export const CONSTANTS = Object.freeze({
  /** UpgradeableLoaderState::{Buffer,Program,ProgramData} — заголовки loader-v3. */
  BUFFER_META: 37n,
  PROGRAMDATA_META: 45n,
  PROGRAM_ACC: 36n,
  /** SIMD-0431: минимальный `solana program extend`. Консервативно считаем активным. */
  MIN_EXTEND: 10240n,
  /** Базовая комиссия за подпись (Agave: 5000 лампортов). */
  SIG_FEE: 5000n,
  /** Оценка размера чанка записи программы (консервативно; уточняется калибровкой §5.7). */
  WRITE_CHUNK: 800n,
  /** Оценка CU на транзакцию записи (для priority fee). */
  CU_EST: 10000n,
  LAMPORTS_PER_SOL: 1000000000n,
  /** Rent-exempt оверхед уже включён в rent(n); отдельно НЕ прибавляем. */
  RENT_OVERHEAD: 128n,
});

/**
 * Разовые аккаунты шага init-onchain (scripts/init-onchain.ts) — размеры данных
 * из раскладок ABI, не из ставки rent. Порядок и состав — по шагам скрипта.
 */
export const SETUP_ACCOUNTS = Object.freeze([
  { key: 'potato_mint', space: 82n, note: 'MINT_SIZE (SPL Token, 6 decimals)' },
  { key: 'game_config', space: 260n, note: 'GameConfig PDA' },
  { key: 'epoch0', space: 49n, note: 'Epoch PDA' },
  { key: 'presale', space: 57n, note: 'PresaleState PDA' },
  { key: 'treasury_sol', space: 0n, note: 'PDA-хранилище (rent(0))' },
  { key: 'quest_treasury', space: 0n, note: 'PDA-хранилище (rent(0))' },
  { key: 'quest_ata', space: 165n, note: 'ATA квест-кассы (SPL Token)' },
]);
export const SETUP_SKR_ATAS = Object.freeze([
  { key: 'skr_treasury_ata', space: 165n },
  { key: 'skr_buyback_ata', space: 165n },
]);

export const ceilDiv = (a, b) => {
  if (typeof a !== 'bigint' || typeof b !== 'bigint') throw new TypeError('ceilDiv: только BigInt (R4)');
  if (b <= 0n) throw new RangeError('ceilDiv: делитель должен быть > 0');
  return (a + b - 1n) / b;
};

/** Разбор десятичной строки SOL в лампорты — строкой, без float (R4). */
export function solToLamports(text) {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(String(text).trim());
  if (!match) throw new Error(`Ожидалась десятичная строка SOL, получено: ${text}`);
  const frac = (match[2] ?? '').padEnd(9, '0');
  if (frac.length > 9) throw new Error(`SOL: больше 9 знаков после точки: ${text}`);
  return BigInt(match[1]) * CONSTANTS.LAMPORTS_PER_SOL + BigInt(frac);
}

/** Разбор целого числа лампортов (R4). */
export function parseLamports(text, label = 'lamports') {
  const match = /^\d+$/.test(String(text).trim());
  if (!match) throw new Error(`${label}: ожидалось целое число лампортов, получено: ${text}`);
  return BigInt(String(text).trim());
}

/**
 * Комиссии деплоя: запись в буфер чанками + финализация.
 * n_writes = ceil(so_len / WRITE_CHUNK); приоритет считается на транзакцию.
 */
export function computeFees(soLen, cfg = {}) {
  const writeChunk = BigInt(cfg.writeChunkBytes ?? CONSTANTS.WRITE_CHUNK);
  const cuEst = BigInt(cfg.cuEst ?? CONSTANTS.CU_EST);
  const sigFee = BigInt(cfg.sigFee ?? CONSTANTS.SIG_FEE);
  const priority = BigInt(cfg.priorityMicrolamports ?? 100000);
  const safetyPct = BigInt(cfg.feeSafetyPct ?? 110);
  const nWrites = ceilDiv(soLen, writeChunk);
  const prioPerTx = ceilDiv(priority * cuEst, 1000000n);
  const raw = sigFee * (nWrites + 4n) + (nWrites + 2n) * prioPerTx;
  return ceilDiv(raw * safetyPct, 100n);
}

/**
 * План ПЕРВОГО деплоя. Буфер и ProgramData держат один и тот же залог: `PEAK = NET`,
 * отдельной строкой буфер не добавляется (§5.2).
 */
export function planNew({ soLen, rent, fees, growthHeadroomBytes = 0n }) {
  const maxLen = soLen + growthHeadroomBytes;
  const lock = rent(CONSTANTS.PROGRAMDATA_META + maxLen) + rent(CONSTANTS.PROGRAM_ACC);
  const net = lock + fees;
  return { kind: 'new', soLen, maxLen, lock, net, peak: net, ext: 0n, netAfter: net };
}

/**
 * План апгрейда. Если SIMD-0433 не активен и программа выросла, нужен ручной
 * extend (минимум MIN_EXTEND, SIMD-0431) — консервативно.
 */
export function planUpgrade({ soLen, rent, fees, curCap, curProgramDataLamports, simd0433Active = false }) {
  let cap;
  if (simd0433Active) {
    cap = soLen;
  } else if (soLen <= curCap) {
    cap = curCap;
  } else {
    const growth = soLen - curCap;
    cap = curCap + (growth > CONSTANTS.MIN_EXTEND ? growth : CONSTANTS.MIN_EXTEND);
  }
  const required = rent(CONSTANTS.PROGRAMDATA_META + cap);
  const net = required - curProgramDataLamports + fees; // может быть < 0 — возврат излишка
  const ext = !simd0433Active && cap > curCap ? (required > curProgramDataLamports ? required - curProgramDataLamports : 0n) : 0n;
  const peak = ext + rent(CONSTANTS.PROGRAMDATA_META + soLen) + fees;
  return { kind: 'upgrade', soLen, cap, ext, required, net, peak, netAfter: net };
}

/** План «деплой пропущен»: нужны только инициализация и rent-exempt остаток. */
export function planInitOnly({ rent, feesInit }) {
  return { kind: 'init-only', soLen: 0n, net: feesInit, peak: feesInit, ext: 0n, netAfter: feesInit };
}

/** Полная сборка бюджета: NEED_BEFORE_RESERVE = PEAK + rent(0) + SETUP; NEED_TOTAL += RESERVE. */
export function budget({ step, rent, fees, setupLamports = 0n, reserveLamports = 0n, balanceLamports = null }) {
  const needBeforeReserve = step.peak + rent(0n) + setupLamports;
  const needTotal = needBeforeReserve + reserveLamports;
  const shortfall = balanceLamports === null ? null : (balanceLamports >= needTotal ? 0n : needTotal - balanceLamports);
  return { ...step, fees, setupLamports, reserveLamports, minRemaining: rent(0n), needBeforeReserve, needTotal, balanceLamports, shortfall };
}

/** Пол резерва (R: не занижать): ≥ 0.25 SOL и ≥ 2 × измеренный SETUP_ONCHAIN. */
export const RESERVE_FLOOR_SOL = '0.25';
export function checkReserveFloor(reserveLamports, setupLamports) {
  const floor = [solToLamports(RESERVE_FLOOR_SOL), setupLamports * 2n].reduce((a, b) => (a > b ? a : b));
  if (reserveLamports < floor) {
    throw new Error(
      `RESERVE_SOL ниже пола: ${reserveLamports} < ${floor} лампортов ` +
        `(пол = max(${RESERVE_FLOOR_SOL} SOL, 2 × SETUP_ONCHAIN))`,
    );
  }
  return floor;
}

// ── RPC ─────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rent-audit.config.json');

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export async function rpcCall(url, method, params, { retries = 4 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!response.ok) {
        // Публичный devnet-RPC отвечает 429 при всплесках: пауза по Retry-After.
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) : 0;
        throw new Error(`HTTP ${response.status}${wait ? ` (retry-after ${wait}s)` : ''}`, { cause: { wait } });
      }
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const hinted = Number(error?.cause?.wait) * 1000;
        const backoff = hinted > 0 ? hinted : 500 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw new Error(`RPC ${method} недоступен после ${retries + 1} попыток: ${lastError?.message ?? lastError}`);
}

/**
 * Ставка rent: rent(0) уже включает 128 байт оверхеда, rate = rent(0) / 128.
 * Инвариант §5.6(ii): rate обязан совпасть с rent(1) − rent(0), иначе модель
 * неверна и считать нельзя (детерминированная проверка — тестируется отдельно).
 */
export function deriveRate(rent0, rent1) {
  if (rent0 % CONSTANTS.RENT_OVERHEAD !== 0n) {
    throw new Error(`rent(0)=${rent0} не делится нацело на ${CONSTANTS.RENT_OVERHEAD} — модель §5 неприменима`);
  }
  const rate = rent0 / CONSTANTS.RENT_OVERHEAD;
  if (rent1 - rent0 !== rate) {
    throw new Error(`rent(1)-rent(0)=${rent1 - rent0} ≠ rate=${rate} — ставка нелинейна`);
  }
  return rate;
}

/**
 * Баланс аккаунта. В отличие от getMinimumBalanceForRentExemption, у getBalance
 * результат обёрнут в RpcResponse: {context, value} — BigInt(object) падает
 * («Cannot convert [object Object] to a BigInt»). Принимаем обе формы: заглушки
 * и часть прокси отдают голое число.
 *
 * `commitment` необязателен: без него действует умолчание RPC (finalized).
 * Калибровка передаёт 'confirmed' — иначе на localnet чтение отстаёт от
 * состояния, о котором сообщает CLI, и шаг выглядит «успехом без эффекта».
 */
export async function fetchBalance(url, address, commitment) {
  const params = commitment ? [address, { commitment }] : [address];
  const result = await rpcCall(url, 'getBalance', params);
  const value = result && typeof result === 'object' && 'value' in result ? result.value : result;
  return BigInt(value);
}

export async function fetchRate(url) {
  const rent0 = BigInt(await rpcCall(url, 'getMinimumBalanceForRentExemption', [0]));
  const rent1 = BigInt(await rpcCall(url, 'getMinimumBalanceForRentExemption', [1]));
  return { rate: deriveRate(rent0, rent1), rent0 };
}

/**
 * Функция rent размером n байт. Планировщики синхронные (все величины — BigInt),
 * поэтому онлайн-режим сначала ПРЕДЗАГРУЖАЕТ нужные размеры (prefetch), а сама
 * функция только читает кэш: async-функция вернула бы Promise и «Promise + BigInt»
 * упало бы в рантайме (это уже случалось — регрессия закрыта тестом V6).
 */
function makeRentFn(url, rate, offline) {
  const cache = new Map();
  if (offline) {
    const rent = (n) => (CONSTANTS.RENT_OVERHEAD + n) * rate;
    rent.prefetch = async () => {};
    return rent;
  }
  const rent = (n) => {
    const value = cache.get(n.toString());
    if (value === undefined) throw new Error(`rent(${n}) не предзагружен из RPC — внутренняя ошибка расчёта`);
    return value;
  };
  rent.prefetch = async (sizes) => {
    for (const size of [...new Set([...sizes].map((s) => s.toString()))]) {
      if (!cache.has(size)) {
        cache.set(size, BigInt(await rpcCall(url, 'getMinimumBalanceForRentExemption', [Number(size)])));
      }
    }
  };
  return rent;
}

/**
 * Публичный base58 (для адресов, прочитанных из данных аккаунтов).
 * Ведущие НУЛЕВЫЕ БАЙТЫ кодируются как '1' (по одному на байт) — считать все
 * нулевые байты нельзя: адрес получится короче 32 байт, и RPC ответит
 * «Invalid param: WrongSize» (регрессия Этапа 0 — закрыта тестом base58).
 */
export function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const buffer = Buffer.from(bytes);
  const firstNonZero = buffer.findIndex((byte) => byte !== 0);
  const zeros = firstNonZero === -1 ? buffer.length : firstNonZero;
  let n = BigInt(`0x${buffer.toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  return '1'.repeat(zeros) + out;
}

/**
 * Состояние программы в кластере (Program/ProgramData через RPC, без ключей).
 * `commitment` — как у fetchBalance: без него умолчание RPC (finalized),
 * калибровка просит 'confirmed'.
 */
export async function fetchProgramState(url, programId, commitment) {
  const level = commitment ? { commitment } : {};
  const info = await rpcCall(url, 'getAccountInfo', [programId, { encoding: 'base64', dataSlice: { offset: 0, length: 36 }, ...level }]);
  if (!info?.value) return null;
  const raw = Buffer.from(info.value.data[0], 'base64');
  if (raw.length < 36 || raw.readUInt32LE(0) !== 2) {
    throw new Error('Program-аккаунт не соответствует loader-v3 (tag != 2)');
  }
  const programDataAddress = base58(raw.subarray(4, 36));
  const pd = await rpcCall(url, 'getAccountInfo', [programDataAddress, { encoding: 'base64', dataSlice: { offset: 0, length: 45 }, ...level }]);
  if (!pd?.value) throw new Error('ProgramData-аккаунт не найден');
  const pdRaw = Buffer.from(pd.value.data[0], 'base64');
  if (pdRaw.readUInt32LE(0) !== 3) throw new Error('ProgramData tag != 3');
  const authority = pdRaw.length > 12 && pdRaw[12] === 1 ? base58(pdRaw.subarray(13, 45)) : null;
  const header = authority ? 45 : 13;
  return {
    programDataAddress,
    authority,
    slot: Number(pdRaw.readBigUInt64LE(4)),
    dataLen: BigInt(pd.value.space) - BigInt(header),
    lamports: BigInt(pd.value.lamports),
  };
}

/** Дискриминатор Anchor-типа: sha256("account:<Имя>")[0..8], base58 — для memcmp-фильтра. */
function accountDiscriminator(name) {
  return base58(createHash('sha256').update(`account:${name}`).digest().subarray(0, 8));
}

/** Сколько таких аккаунтов уже есть в кластере (0/1 — этих типов единичные). */
async function accountExists(url, programId, name) {
  const result = await rpcCall(url, 'getProgramAccounts', [
    programId,
    { filters: [{ memcmp: { offset: 0, bytes: accountDiscriminator(name) } }], dataSlice: { offset: 0, length: 0 }, encoding: 'base64' },
  ]);
  return Array.isArray(result) && result.length > 0;
}

/**
 * Разовые расходы init-onchain: считаются только ещё не существующие аккаунты.
 * Неизвестные (mint создаётся новым keypair'ом, PDA-хранилища, ATA) берутся по
 * худшему случаю; SETUP_ONCHAIN_LAMPORTS переопределяет результат измерением.
 */
export async function estimateSetupOnchain({ rent, url, programId }) {
  let total = 0n;
  const parts = [];
  for (const account of SETUP_ACCOUNTS) {
    const amount = rent(account.space);
    parts.push(`${account.key}=${amount}`);
    total += amount;
  }
  const skrMint = 'Fotom38ZJAYia8VGKtYjmSGuqPPDzSz7R46ydWzRA4o';
  let skrPresent = true;
  if (url && programId) {
    try {
      const [config, epoch, presale, skr] = await Promise.all([
        accountExists(url, programId, 'GameConfig'),
        accountExists(url, programId, 'Epoch'),
        accountExists(url, programId, 'PresaleState'),
        rpcCall(url, 'getAccountInfo', [skrMint, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]).then((r) => Boolean(r?.value)),
      ]);
      const discount = [
        ['GameConfig', 260n, config],
        ['Epoch', 49n, epoch],
        ['PresaleState', 57n, presale],
        ['skr_atas', 0n, skr],
      ];
      let removed = 0n;
      if (config) removed += rent(260n);
      if (epoch) removed += rent(49n);
      if (presale) removed += rent(57n);
      skrPresent = skr;
      if (skrPresent) {
        // Верхняя оценка уже включает 1 ATA; SKR добавляет ещё две.
        const extra = SETUP_SKR_ATAS.reduce((acc, a) => acc + rent(a.space), 0n);
        total += extra;
        parts.push(`skr_atas=+${extra}`);
      }
      total -= removed;
      if (removed > 0n) parts.push(`existing=-${removed}`);
      void discount;
    } catch (error) {
      parts.push(`onchain-check-failed=${error.message.slice(0, 80)}`);
    }
  } else if (skrPresent) {
    const extra = SETUP_SKR_ATAS.reduce((acc, a) => acc + rent(a.space), 0n);
    total += extra;
    parts.push(`skr_atas=+${extra}`);
  }
  return { total, parts };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { explain: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = () => argv[++i];
    switch (key) {
      case '--so': args.so = next(); break;
      case '--so-len': args.soLen = BigInt(next()); break;
      case '--rpc': args.rpc = next(); break;
      case '--deployer': args.deployer = next(); break;
      case '--mode': args.mode = next(); break;
      case '--simd0433-active': args.simd0433Active = true; break;
      case '--offline-rate': args.offlineRate = BigInt(next()); break;
      case '--cur-cap': args.curCap = BigInt(next()); break;
      case '--programdata-lamports': args.programDataLamports = BigInt(next()); break;
      case '--setup-lamports': args.setupLamports = BigInt(next()); break;
      case '--json': args.json = true; break;
      case '--explain': args.explain = true; break;
      case '--help': args.help = true; break;
      default: throw new Error(`Неизвестный аргумент: ${key} (см. --help)`);
    }
  }
  return args;
}

const HELP = `deploy-budget — расчёт минимального баланса деплоера.

  --so <путь>            .so (размер берётся из файла); по умолчанию target/deploy/solana_potato.so
  --so-len <n>           размер .so в байтах (вместо --so)
  --rpc <url>            RPC (по умолчанию из scripts/rent-audit.config.json или RPC_URL)
  --deployer <pubkey>    кошелёк деплоера (по умолчанию из конфига)
  --mode <режим>         auto|new|upgrade|init-only (auto — по состоянию кластера)
  --simd0433-active      ProgramData подгоняется под размер ELF (по умолчанию выкл.)
  --offline-rate <n>     ТОЛЬКО тесты: rent(n) = (128+n)×ставка, без RPC
  --cur-cap <n>          текущая ёмкость ProgramData (переопределение для апгрейда)
  --programdata-lamports <n>  лампорты ProgramData (переопределение для апгрейда)
  --setup-lamports <n>   измеренный SETUP_ONCHAIN
  --json                 машинный вывод
  --explain              показать формулы с подставленными числами

Коды выхода: 0 — хватает; 3 — нехватка; 2 — ошибка.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const config = loadConfig();
  const rpc = args.rpc ?? process.env.RPC_URL ?? config.rpc ?? 'https://api.devnet.solana.com';
  const deployer = args.deployer ?? config.deployer;
  const programId = process.env.PROGRAM_ID ?? config.programId;

  let soLen = args.soLen;
  if (soLen === undefined) {
    const soPath = args.so ?? 'target/deploy/solana_potato.so';
    soLen = BigInt(readFileSync(soPath).length);
  }
  const offline = args.offlineRate !== undefined;
  let rate;
  let genesisHash = null;
  let slot = null;
  if (offline) {
    rate = args.offlineRate;
    console.error('ОТКЛОНЕНИЕ: --offline-rate — тестовый режим, не для боевого расчёта');
  } else {
    ({ rate } = await fetchRate(rpc));
    genesisHash = await rpcCall(rpc, 'getGenesisHash', []);
    slot = await rpcCall(rpc, 'getSlot', []);
  }
  const rent = makeRentFn(rpc, rate, offline);

  const growthHeadroomBytes = BigInt(process.env.GROWTH_HEADROOM_BYTES ?? '0');
  const feeOptions = {
    feeSafetyPct: BigInt(process.env.FEE_SAFETY_PCT ?? '110'),
    priorityMicrolamports: BigInt(process.env.PRIORITY_MICROLAMPORTS ?? '100000'),
  };
  const fees = computeFees(soLen, feeOptions);

  let mode = args.mode ?? 'auto';
  let programState = null;
  if (!offline && programId) {
    programState = await fetchProgramState(rpc, programId).catch((error) => {
      if (mode !== 'auto' && mode !== 'upgrade') throw error;
      return null;
    });
  }
  if (mode === 'auto') mode = programState ? 'upgrade' : 'new';

  // Предзагрузка rent: планировщики синхронные, поэтому все нужные размеры
  // берутся из RPC заранее (см. makeRentFn).
  const rentSizes = new Set([
    0n,
    CONSTANTS.PROGRAM_ACC,
    ...SETUP_ACCOUNTS.map((account) => account.space),
    ...SETUP_SKR_ATAS.map((account) => account.space),
  ]);
  if (mode === 'new') {
    rentSizes.add(CONSTANTS.PROGRAMDATA_META + soLen + growthHeadroomBytes);
  } else if (mode === 'upgrade') {
    const preCap = args.curCap ?? (programState ? programState.dataLen : null);
    if (preCap === null) throw new Error('Для апгрейда нужны --cur-cap и --programdata-lamports (или доступный кластер)');
    const preGrowth = soLen - preCap;
    const cap = Boolean(args.simd0433Active)
      ? soLen
      : (soLen <= preCap ? preCap : preCap + (preGrowth > CONSTANTS.MIN_EXTEND ? preGrowth : CONSTANTS.MIN_EXTEND));
    rentSizes.add(CONSTANTS.PROGRAMDATA_META + cap);
    rentSizes.add(CONSTANTS.PROGRAMDATA_META + soLen);
  }
  await rent.prefetch(rentSizes);

  let step;
  if (mode === 'new') {
    step = planNew({ soLen, rent, fees, growthHeadroomBytes });
  } else if (mode === 'upgrade') {
    const curCap = args.curCap ?? (programState ? programState.dataLen : null);
    const curProgramDataLamports = args.programDataLamports ?? (programState ? programState.lamports : null);
    if (curCap === null || curProgramDataLamports === null) {
      throw new Error('Для апгрейда нужны --cur-cap и --programdata-lamports (или доступный кластер)');
    }
    step = planUpgrade({ soLen, rent, fees, curCap, curProgramDataLamports, simd0433Active: Boolean(args.simd0433Active) });
  } else if (mode === 'init-only') {
    step = planInitOnly({ rent, feesInit: computeFees(0n, feeOptions) });
  } else {
    throw new Error(`Неизвестный режим: ${mode}`);
  }

  let setup;
  if (args.setupLamports !== undefined) {
    setup = { total: args.setupLamports, parts: ['override'] };
  } else if (process.env.SETUP_ONCHAIN_LAMPORTS) {
    setup = { total: parseLamports(process.env.SETUP_ONCHAIN_LAMPORTS, 'SETUP_ONCHAIN_LAMPORTS'), parts: ['env'] };
  } else {
    setup = await estimateSetupOnchain({ rent, url: offline ? null : rpc, programId });
  }

  const reserveLamports = solToLamports(process.env.RESERVE_SOL ?? '0.30');
  checkReserveFloor(reserveLamports, setup.total);

  let balanceLamports = null;
  if (deployer && !offline) {
    balanceLamports = await fetchBalance(rpc, deployer);
  }
  const result = await budget({ step, rent, fees, setupLamports: setup.total, reserveLamports, balanceLamports });

  const sol = (lamports) => {
    const negative = lamports < 0n;
    const abs = negative ? -lamports : lamports;
    const whole = abs / CONSTANTS.LAMPORTS_PER_SOL;
    const frac = (abs % CONSTANTS.LAMPORTS_PER_SOL).toString().padStart(9, '0');
    return `${negative ? '-' : ''}${whole}.${frac}`;
  };
  const jsonSafe = (value) => (typeof value === 'bigint' ? value.toString() : value);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          version: VERSION,
          mode,
          rpc: offline ? null : rpc,
          offline,
          genesisHash,
          slot,
          deployer: deployer ?? null,
          rate: jsonSafe(rate),
          soLen: jsonSafe(soLen),
          maxLen: jsonSafe(result.maxLen ?? null),
          cap: jsonSafe(result.cap ?? null),
          lock: jsonSafe(result.lock ?? null),
          upgradeNet: jsonSafe(result.kind === 'upgrade' ? result.net : null),
          ext: jsonSafe(result.ext),
          peak: jsonSafe(result.peak),
          fees: jsonSafe(fees),
          minRemaining: jsonSafe(result.minRemaining),
          setupOnchain: jsonSafe(setup.total),
          setupParts: setup.parts,
          reserve: jsonSafe(reserveLamports),
          needBeforeReserve: jsonSafe(result.needBeforeReserve),
          needTotal: jsonSafe(result.needTotal),
          balance: jsonSafe(balanceLamports),
          shortfall: jsonSafe(result.shortfall),
          netAfter: jsonSafe(result.netAfter),
          sol: { needBeforeReserve: sol(result.needBeforeReserve), needTotal: sol(result.needTotal), reserve: sol(reserveLamports), minRemaining: sol(result.minRemaining) },
        },
        null,
        2,
      ),
    );
  } else {
    const rows = [
      ['MODE', mode],
      ['RPC', offline ? '(offline)' : rpc],
      ['GENESIS', genesisHash ?? '-'],
      ['SLOT', slot ?? '-'],
      ['SO_LEN', soLen.toString()],
      ['MAX_LEN', result.maxLen?.toString() ?? '-'],
      ['CAP', result.cap?.toString() ?? '-'],
      ['RATE', `${rate} lamports/byte`],
      ['LOCK', result.lock?.toString() ?? '-'],
      ['UPGRADE_NET', result.kind === 'upgrade' ? result.net.toString() : '-'],
      ['UPGRADE_EXT', result.ext.toString()],
      ['PEAK', result.peak.toString()],
      ['FEES', fees.toString()],
      ['MIN_REMAINING', result.minRemaining.toString()],
      ['SETUP_ONCHAIN', setup.total.toString()],
      ['RESERVE', reserveLamports.toString()],
      ['NEED_BEFORE_RESERVE', result.needBeforeReserve.toString()],
      ['NEED_TOTAL', result.needTotal.toString()],
      ['BALANCE', balanceLamports?.toString() ?? '-'],
      ['SHORTFALL', result.shortfall?.toString() ?? '-'],
      ['NET_AFTER', result.netAfter.toString()],
    ];
    for (const [key, value] of rows) console.log(`${key.padEnd(20)} ${value}`);
    console.log(`# SOL: NEED_BEFORE_RESERVE=${sol(result.needBeforeReserve)} NEED_TOTAL=${sol(result.needTotal)} RESERVE=${sol(reserveLamports)}`);
    console.log(`# SETUP_ONCHAIN части: ${setup.parts.join(' ')}`);
    if (args.explain) {
      console.log('# формулы:');
      console.log(`#   fees = ceil(FEE_SAFETY_PCT/100 × (5000 × (n_writes + 4) + (n_writes + 2) × ceil(PRIORITY × CU_EST / 1e6))), n_writes = ceil(${soLen} / ${CONSTANTS.WRITE_CHUNK})`);
      console.log('#   new: LOCK = rent(45 + max_len) + rent(36); PEAK = NET = LOCK + FEES');
      console.log('#   upgrade: cap = max(cur_cap, so_len) при росте; NET = rent(45+cap) − lamports(ProgramData) + FEES; PEAK = EXT + rent(45+so_len) + FEES');
      console.log('#   NEED_BEFORE_RESERVE = PEAK + rent(0) + SETUP_ONCHAIN; NEED_TOTAL = NEED_BEFORE_RESERVE + RESERVE');
    }
  }

  if (result.shortfall === null) return 0;
  return result.shortfall > 0n ? 3 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`deploy-budget: ошибка: ${error.message}`);
      process.exit(2);
    });
}
