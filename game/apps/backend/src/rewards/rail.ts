/**
 * Стартовый набор и дейлик — единственный вход в игру для нового кошелька.
 *
 * Проблема, которую закрывает модуль: первое поле покупается за POTATO
 * (100 / 250 / 500), публичного крана нет, а бэкенд-подписант по политике
 * имеет право только на roll_epoch/init_epoch. Значит новый игрок физически
 * не может начать, пока оператор не выдаст ему токены вручную. Это и есть
 * разрыв «полного пути игры».
 *
 * Рельса — существующая on-chain инструкция `grant_reward_once`: каждый грант
 * привязан к PDA [b"reward", user_potato_ata, nonce], поэтому повторная выдача
 * с тем же nonce отклоняется рантаймом, а не нашей бухгалтерией. Nonce здесь
 * детерминированный:
 *
 *   starter: keccak/sha256("starter" ‖ wallet)  — один раз на кошелёк;
 *   daily:   sha256("daily"   ‖ wallet ‖ utc_day) — один раз в сутки на кошелёк.
 *
 * Детерминированность важна: при рестарте процесса и при гонке двух запросов
 * повторная транзакция упадёт на init PDA, а не выдаст второй грант.
 *
 * Модуль намеренно чистый (без сети, БД и RPC): лимиты, суммы и nonce
 * проверяются юнит-тестами, роутер только передаёт их в подписант.
 */
import { createHash } from 'node:crypto';

/** Зеркало lib.rs:68 — потолок одной выдачи `grant_reward_once`. */
export const MAX_REWARD_MICRO = 1_000_000_000n;
/** Зеркало lib.rs:158 — цена эталонного поля (Луг, 1.0×). */
export const BASE_FIELD_PRICE_MICRO = 250_000_000n;
/** lib.rs:76 — окно клейма 15 минут; берём половину, чтобы подпись не жила долго. */
export const MAX_REWARD_EXPIRY_SECONDS = 900n;
export const GRANT_EXPIRY_SECONDS = 300n;

/**
 * Стартовый набор = ровно одно поле-луг, ни POTATO сверху.
 *
 * Почему ровно цена поля, а не «щедрее»: грант должен закрывать ровно
 * отсутствующий вход, а не давать фору перед платящими. 250 POTATO — это
 * первое поле и первый урожай через сутки; дальше игрок либо играет, либо
 * покупает пак.
 */
export const STARTER_GRANT_MICRO = BASE_FIELD_PRICE_MICRO;

/**
 * Дейлик 7 POTATO. Это ~0.5 % стартового набора в день и ~2/3 дневного
 * урожая луга после налога — достаточно, чтобы вернуться на следующий день, и
 * мало, чтобы превратиться в источник дохода.
 */
export const DAILY_BONUS_MICRO = 7_000_000n;

/**
 * Мягкие суточные бюджеты процесса. Ончейн-квота (GRANT_QUOTA_SHARE_BPS от капа
 * эпохи) — жёсткий предел; эти числа нужны, чтобы при утечке ключа или боте
 * рельса остановилась раньше, чем вычерпает всю квоту.
 *
 * 20 000 POTATO = 80 стартовых наборов или 2 857 дейликов в сутки.
 */
export const STARTER_DAILY_BUDGET_MICRO = 20_000_000_000n;
export const DAILY_BONUS_DAILY_BUDGET_MICRO = 20_000_000_000n;

/** Сколько запросов от одного кошелька принимаем за период (анти-спам до цепи). */
export const WALLET_COOLDOWN_SECONDS = 15n;

export type GrantKind = 'starter' | 'daily';

export const GRANT_AMOUNTS_MICRO: Readonly<Record<GrantKind, bigint>> = {
  starter: STARTER_GRANT_MICRO,
  daily: DAILY_BONUS_MICRO,
};

/** UTC-сутки как u64-счётчик: nonce дейлика меняется ровно на границе суток. */
export function utcDay(nowSeconds: bigint): bigint {
  if (nowSeconds < 0n) throw new RangeError('now must be non-negative');
  return nowSeconds / 86_400n;
}

function firstU64(hash: Buffer): bigint {
  // LE, как `u64` в инструкции; 0 запрещён как «пустой» nonce.
  let value = 0n;
  for (let i = 0; i < 8; i += 1) value |= BigInt(hash[i]!) << BigInt(8 * i);
  return value === 0n ? 1n : value;
}

/**
 * Детерминированный nonce гранта.
 *
 * Домен отделяет стартовый набор от дейлика, чтобы они не делили один PDA.
 * Для дейлика в хэш входит номер UTC-суток: один кошелёк — один дейлик в день.
 */
export function grantNonce(kind: GrantKind, wallet: string, nowSeconds: bigint): bigint {
  if (!wallet) throw new RangeError('wallet is required');
  const domain = kind === 'starter' ? 'starter' : `daily:${utcDay(nowSeconds)}`;
  return firstU64(createHash('sha256').update(`${domain}:${wallet}`).digest());
}

/** Дедлайн подписи: сейчас + окно, но не дальше ончейн-лимита. */
export function grantExpiry(nowSeconds: bigint): bigint {
  const expiry = nowSeconds + GRANT_EXPIRY_SECONDS;
  return expiry;
}

/** Базовый формат Solana-адреса (base58, 32–44 символа). */
export function isWalletAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export interface GrantBudgetState {
  /** Сколько уже выдали за текущие UTC-сутки, микро-POTATO. */
  spentMicro: bigint;
  day: bigint;
}

export interface BudgetCheck {
  ok: boolean;
  reason?: 'budget-exhausted';
  state: GrantBudgetState;
}

/**
 * Учёт мягкого бюджета. Состояние живёт в памяти процесса: после рестарта
 * счётчик обнуляется, поэтому бюджет — это тормоз, а не гарантия. Гарантию
 * даёт ончейн-квота `charge_epoch_grant`, которую нельзя обойти ни рестартом,
 * ни второй репликой.
 */
export function chargeBudget(
  state: GrantBudgetState,
  kind: GrantKind,
  nowSeconds: bigint,
): BudgetCheck {
  const day = utcDay(nowSeconds);
  const rolled = state.day === day ? state : { day, spentMicro: 0n };
  const amount = GRANT_AMOUNTS_MICRO[kind];
  const limit = kind === 'starter' ? STARTER_DAILY_BUDGET_MICRO : DAILY_BONUS_DAILY_BUDGET_MICRO;
  const next = rolled.spentMicro + amount;
  if (next > limit) return { ok: false, reason: 'budget-exhausted', state: rolled };
  return { ok: true, state: { day, spentMicro: next } };
}

/**
 * Бюджет больше ончейн-квоты бессмысленен: транзакция всё равно упадёт.
 * Проверка нужна на старте, чтобы конфигурация не выглядела рабочей, пока
 * цепь отказывает в выдаче.
 */
export function budgetFitsGrantQuota(
  epochCapMicro: bigint,
  quotaShareBps: bigint,
  starterBudgetMicro: bigint = STARTER_DAILY_BUDGET_MICRO,
  dailyBudgetMicro: bigint = DAILY_BONUS_DAILY_BUDGET_MICRO,
): boolean {
  if (epochCapMicro <= 0n) return false;
  const quota = (epochCapMicro * quotaShareBps) / 10_000n;
  return starterBudgetMicro + dailyBudgetMicro <= quota;
}
