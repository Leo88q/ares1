/**
 * W1.1: открыть тираж офчейн-пресейла одной командой (идемпотентно).
 *
 * Запуск (из game/):
 *   GAME_OPS_DATABASE_URL=postgres://… ADMIN_API_TOKEN=<≥32 символов> \
 *   PRESALE_RUN_ID=wave1 PRESALE_PACK_ID=meadow-4 PRESALE_CURRENCY=skr \
 *   PRESALE_PRICE_UNITS=888000000 PRESALE_TREASURY=<ATA казначейства> \
 *   yarn presale:open-run
 *
 * Цены (решение владельца 2026-10-06): Фаза 1 — 888 SKR за пак, Фаза 2
 * (ончейн-модуль) — 1053 SKR. Срок выдачи покупателю — в день листинга на
 * mainnet; формулировка обязана быть видна до оплаты (Terms §7).
 *
 * Дополнительно нужны GAME_OPS_DATABASE_URL и ADMIN_API_TOKEN (≥32 символов)
 * — их читает та же loadGameOpsConfig(), что и бэкенд.
 *
 * Переменные: PRESALE_RUN_ID, PRESALE_PACK_ID, PRESALE_CURRENCY (sol|skr),
 * PRESALE_PRICE_UNITS (базовые единицы: лампорты для sol, атомы для skr),
 * PRESALE_TREASURY (для skr — ATA токена, а не кошелёк), PRESALE_CAP
 * (по умолчанию 500 — значение волны 1), PRESALE_RESERVE_MINUTES (30),
 * PRESALE_ACTOR (presale.open-run).
 *
 * Почему скрипт, а не INSERT: тираж создаёт `openRun()` — он проверяет
 * выдаваемость пака, разрядность цены, пренебрежимость пыли относительно cap и
 * формат казначейства. Ручной INSERT обходит эти проверки и однажды продаёт
 * пак, который рельса выдачи физически не может выдать.
 *
 * Идемпотентность: повтор с теми же параметрами не создаёт второй тираж и не
 * падает — печатает состояние и выходит 0. Если тираж есть, но с ДРУГИМИ
 * параметрами, это не повтор, а расхождение: цену, cap и казначейство задним
 * числом не меняют (триггер PRESALE_RUN_IMMUTABLE_FIELD), поэтому exit 1 со
 * списком отличий.
 *
 * Выход: 0 — тираж открыт (создан сейчас или уже был открыт с теми же
 *            параметрами);
 *        1 — расхождение параметров, тираж закрыт или ошибка БД;
 *        2 — некорректная конфигурация: env, нет GAME_OPS_DATABASE_URL или не
 *            развёрнута схема (сначала `yarn db:migrate`).
 */
import process from 'node:process';
import { loadGameOpsConfig } from '../apps/backend/src/gameops/env.js';
import type { GameOpsConfig } from '../apps/backend/src/gameops/env.js';
import { closePool, createPool, query } from '../apps/backend/src/gameops/pool.js';
import { GameOpsError } from '../apps/backend/src/gameops/errors.js';
import { openRun } from '../apps/backend/src/presale/orders.js';
import type { RunRow } from '../apps/backend/src/presale/orders.js';
import { PACKS, findPack } from '../apps/backend/src/presale/catalog.js';
import type { Currency } from '../apps/backend/src/presale/catalog.js';

const DEFAULT_CAP = 500;
const DEFAULT_RESERVE_MINUTES = 30;
const DEFAULT_ACTOR = 'presale.open-run';
const MAX_CAP = 100_000; // совпадает с CHECK в 0004_presale.sql
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Ошибка в env — это не «расхождение тиража»: выходим кодом 2. */
class UsageError extends Error {}

interface DesiredRun {
  runId: string;
  packId: string;
  currency: Currency;
  priceUnits: bigint;
  cap: number;
  treasury: string;
  reserveMinutes: number;
  actor: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new UsageError(`${name} не задан`);
  return value;
}

function intInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`${name} должен быть целым в диапазоне ${min}..${max}`);
  }
  return value;
}

function readDesired(env: NodeJS.ProcessEnv): DesiredRun {
  const runId = required(env, 'PRESALE_RUN_ID');
  if (runId.length > 40 || /\s/.test(runId)) {
    throw new UsageError('PRESALE_RUN_ID: 1..40 символов без пробелов (CHECK в схеме)');
  }
  const packId = required(env, 'PRESALE_PACK_ID');
  if (!findPack(packId)) {
    throw new UsageError(
      `PRESALE_PACK_ID: неизвестный пак «${packId}»; доступные: ${PACKS.map(pack => pack.id).join(', ')}`,
    );
  }
  const currency = required(env, 'PRESALE_CURRENCY');
  if (currency !== 'sol' && currency !== 'skr') {
    throw new UsageError('PRESALE_CURRENCY: только sol или skr — от валюты зависит смысл PRESALE_PRICE_UNITS');
  }
  const priceRaw = required(env, 'PRESALE_PRICE_UNITS');
  if (!/^[0-9]+$/.test(priceRaw)) {
    throw new UsageError('PRESALE_PRICE_UNITS: целое число базовых единиц (лампорты для sol, атомы для skr)');
  }
  const priceUnits = BigInt(priceRaw);
  if (priceUnits <= 0n) throw new UsageError('PRESALE_PRICE_UNITS должен быть больше 0');
  const treasury = required(env, 'PRESALE_TREASURY');
  if (!BASE58_ADDRESS.test(treasury)) {
    throw new UsageError('PRESALE_TREASURY не похож на base58-адрес (для skr — это ATA казначейства, а не кошелёк)');
  }
  const cap = intInRange(env.PRESALE_CAP, DEFAULT_CAP, 1, MAX_CAP, 'PRESALE_CAP');
  const reserveMinutes = intInRange(
    env.PRESALE_RESERVE_MINUTES, DEFAULT_RESERVE_MINUTES, 1, 1440, 'PRESALE_RESERVE_MINUTES',
  );
  const actor = env.PRESALE_ACTOR?.trim() || DEFAULT_ACTOR;
  return { runId, packId, currency, priceUnits, cap, treasury, reserveMinutes, actor };
}

function differences(run: RunRow, desired: DesiredRun): string[] {
  const lines: string[] = [];
  if (run.pack_id !== desired.packId) lines.push(`pack_id: в БД ${run.pack_id}, в env ${desired.packId}`);
  if (run.currency !== desired.currency) lines.push(`currency: в БД ${run.currency}, в env ${desired.currency}`);
  if (BigInt(run.price_units) !== desired.priceUnits) lines.push(`price_units: в БД ${run.price_units}, в env ${desired.priceUnits}`);
  if (run.cap !== desired.cap) lines.push(`cap: в БД ${run.cap}, в env ${desired.cap}`);
  if (run.treasury !== desired.treasury) lines.push(`treasury: в БД ${run.treasury}, в env ${desired.treasury}`);
  return lines;
}

function printStatus(run: RunRow): void {
  console.log(`  run_id         : ${run.run_id}`);
  console.log(`  pack_id        : ${run.pack_id}`);
  console.log(`  currency       : ${run.currency}`);
  console.log(`  price_units    : ${run.price_units}`);
  console.log(`  cap            : ${run.cap}`);
  console.log(`  reserved_count : ${run.reserved_count}`);
  console.log(`  is_open        : ${run.is_open}`);
  console.log(`  treasury       : ${run.treasury}`);
  console.log(`  started_at     : ${run.started_at}`);
  if (run.closed_at) console.log(`  closed_at      : ${run.closed_at}`);
}

/** Возвращает код выхода: тираж уже есть — 0, если параметры совпали и он открыт. */
function reportExisting(run: RunRow, desired: DesiredRun): number {
  const diff = differences(run, desired);
  if (diff.length) {
    console.error(`Тираж ${run.run_id} уже существует, но с другими параметрами:`);
    for (const line of diff) console.error(`  - ${line}`);
    console.error('Параметры тиража неизменяемы (PRESALE_RUN_IMMUTABLE_FIELD): для новых условий задайте другой PRESALE_RUN_ID.');
    return 1;
  }
  console.log(`Тираж ${run.run_id} уже открыт — повторный запуск ничего не изменил (идемпотентно).`);
  printStatus(run);
  if (!run.is_open) {
    console.error('Тираж закрыт. Повторно открыть его нельзя (PRESALE_RUN_CANNOT_REOPEN) — для новой волны нужен другой PRESALE_RUN_ID.');
    return 1;
  }
  console.log(`Мест свободно: ${run.cap - run.reserved_count} из ${run.cap}.`);
  return 0;
}

async function main(): Promise<number> {
  const desired = readDesired(process.env);
  let config: GameOpsConfig | null;
  try {
    // loadGameOpsConfig бросает на битом URL и на коротком ADMIN_API_TOKEN:
    // это ошибка конфигурации (выход 2), а не расхождение тиража.
    config = loadGameOpsConfig();
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (!config) {
    console.error('GAME_OPS_DATABASE_URL не задан — открывать тираж негде.');
    return 2;
  }

  const pool = createPool(config);
  try {
    const existing = await query<RunRow>(
      pool, 'SELECT * FROM game_ops.presale_runs WHERE run_id = $1', [desired.runId],
    );
    if (existing[0]) return reportExisting(existing[0], desired);

    let created: RunRow;
    try {
      created = await openRun(pool, {
        runId: desired.runId,
        packId: desired.packId,
        currency: desired.currency,
        priceUnits: desired.priceUnits,
        cap: desired.cap,
        treasury: desired.treasury,
        reserveMinutes: desired.reserveMinutes,
        actor: desired.actor,
      });
    } catch (error) {
      // Гонка: параллельный запуск успел создать тираж между SELECT и INSERT.
      // Это тот же «уже открыт», а не ошибка — читаем и сравниваем параметры.
      if (error instanceof GameOpsError && error.status === 409 && error.code === 'VALIDATION') {
        const again = await query<RunRow>(
          pool, 'SELECT * FROM game_ops.presale_runs WHERE run_id = $1', [desired.runId],
        );
        if (again[0]) return reportExisting(again[0], desired);
      }
      throw error;
    }

    console.log(`Тираж ${created.run_id} открыт.`);
    printStatus(created);
    console.log('');
    console.log('Дальше:');
    console.log('  1) сверка перед выдачей — yarn presale:reconcile (SOL-тиражи; для SKR — поштучный verify, см. ранбук)');
    console.log('  2) ручная выдача POTATO — docs/PRESALE_DELIVERY_RUNBOOK.md');
    console.log(`  3) статус для покупателей — GET /api/presale/runs/${created.run_id}`);
    return 0;
  } finally {
    await closePool(pool);
  }
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    if (error instanceof UsageError) {
      console.error(`Конфигурация: ${error.message}`);
      process.exit(2);
    }
    if (error instanceof GameOpsError) {
      console.error(`[presale:open-run] ${error.code}: ${error.message}`);
      process.exit(error.code === 'MIGRATIONS_MISSING' ? 2 : 1);
    }
    console.error('[presale:open-run] FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
