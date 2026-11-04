/**
 * Крон квест-бюджета: поддержание пула наград за ачивки.
 *
 * Проблема, которую он решает. `claim_achievement` не минтит, а переносит
 * POTATO из предфинансированного `quest_ata` (владелец — PDA `quest_treasury`).
 * Пул пополняется один раз при init (550 POTATO), а ачивки одноразовые
 * per-wallet: пул кончается после нескольких десятков игроков, и дальше
 * `claim_achievement` падает на пустом ATA. Это не «баг награды», это
 * исчерпанный бюджет, и лечится он бюджетом, а не ручной доливкой.
 *
 * Как пополняем. `grant_reward_once` с nonce = sha256("quest-budget:<UTC-день>")
 * минтит в `quest_ata`. PDA `[reward, quest_ata, nonce]` делает повтор
 * невозможным: рестарт бэкенда, гонка двух реплик и ретрай клиента не создадут
 * вторую доливку за те же сутки.
 *
 * Почему не «доливать при каждом такте». Доливка идёт только при падении ниже
 * low-water и не больше суточного капа. Иначе крон превращается в насос,
 * который вычерпывает 25 % квоты грантов и оставляет паки без выдачи.
 */
import { createHash } from "node:crypto";
import { MAX_REWARD_MICRO, MAX_REWARD_EXPIRY_SECONDS } from "../presale/catalog.js";
import { utcDay } from "./rail.js";

/** Полный пул квестов (сумма QUEST_REWARD_MICRO: 50+50+100+100+200+50). */
export const QUEST_POOL_TARGET_MICRO = 550_000_000n;
/** Ниже этого уровня считаем, что пул скоро кончится, и доливаем. */
export const QUEST_POOL_LOW_WATER_MICRO = 100_000_000n;
/** Максимум доливки за UTC-сутки — один полный пул. */
export const QUEST_DAILY_REFILL_CAP_MICRO = 550_000_000n;
/** Дедлайн подписи короче ончейн-окна 900 с, чтобы ретрай не висел вечно. */
export const QUEST_REFILL_EXPIRY_SECONDS = 300;

/**
 * Сколько долить. `0n` — не трогаем пул: он выше low-water.
 * Сумма ограничена `MAX_REWARD_MICRO` (потолок одной выдачи в программе),
 * иначе `grant_reward_once` отклонит транзакцию уже после подписи.
 */
export function questRefillAmount(
  balanceMicro: bigint,
  capMicro: bigint = QUEST_DAILY_REFILL_CAP_MICRO,
): bigint {
  if (balanceMicro < 0n) throw new Error("quest-budget: отрицательный баланс");
  if (balanceMicro >= QUEST_POOL_LOW_WATER_MICRO) return 0n;
  const need = QUEST_POOL_TARGET_MICRO - balanceMicro;
  const capped = need < capMicro ? need : capMicro;
  return capped < MAX_REWARD_MICRO ? capped : MAX_REWARD_MICRO;
}

/**
 * Одна доливка на UTC-сутки. Хеш, а не счётчик: nonce не зависит от рестарта
 * процесса, поэтому повторная попытка в тех же сутках упирается в PDA, а не
 * в память, которую можно потерять.
 */
export function questRefillNonce(nowSeconds: bigint): bigint {
  const day = utcDay(nowSeconds);
  const digest = createHash("sha256").update(`quest-budget:${day}`, "utf8").digest();
  const value = digest.readBigUInt64LE(0);
  return value === 0n ? 1n : value;
}

export function questRefillExpiry(nowSeconds: bigint): bigint {
  if (BigInt(QUEST_REFILL_EXPIRY_SECONDS) > MAX_REWARD_EXPIRY_SECONDS) {
    throw new Error("quest-budget: дедлайн подписи длиннее ончейн-окна");
  }
  return nowSeconds + BigInt(QUEST_REFILL_EXPIRY_SECONDS);
}

export interface QuestBudgetDeps {
  now: () => bigint;
  readBalance: () => Promise<bigint>;
  refill: (input: { amountMicro: bigint; nonce: bigint; expiresAt: bigint }) => Promise<string>;
  /** Мягкий суточный счётчик: живёт в памяти процесса, сбрасывается по UTC-дню. */
  budget?: { day: bigint; spentMicro: bigint };
}

export interface QuestBudgetOutcome {
  status: "skipped" | "refilled" | "failed";
  amountMicro: bigint;
  signature?: string;
  reason?: string;
}

/**
 * Один такт. Ошибки не бросаются наружу: крон не должен падать из-за одного
 * неудачного RPC-ответа, но и молчать нельзя — причина возвращается в исходе и
 * логируется вызывающим.
 */
export async function runQuestBudgetOnce(deps: QuestBudgetDeps): Promise<QuestBudgetOutcome> {
  const now = deps.now();
  const day = utcDay(now);
  const state = deps.budget ?? { day, spentMicro: 0n };
  if (state.day !== day) {
    state.day = day;
    state.spentMicro = 0n;
  }
  deps.budget = state;

  let balance: bigint;
  try {
    balance = await deps.readBalance();
  } catch (error) {
    return {
      status: "failed",
      amountMicro: 0n,
      reason: `balance: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const capLeft = QUEST_DAILY_REFILL_CAP_MICRO - state.spentMicro;
  if (capLeft <= 0n) return { status: "skipped", amountMicro: 0n, reason: "daily-cap" };
  const requested = questRefillAmount(balance, capLeft);
  if (requested <= 0n) return { status: "skipped", amountMicro: 0n, reason: "above-low-water" };

  try {
    const signature = await deps.refill({
      amountMicro: requested,
      nonce: questRefillNonce(now),
      expiresAt: questRefillExpiry(now),
    });
    state.spentMicro += requested;
    return { status: "refilled", amountMicro: requested, signature };
  } catch (error) {
    return {
      status: "failed",
      amountMicro: requested,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface QuestBudgetHandle {
  stop: () => void;
  runNow: () => Promise<QuestBudgetOutcome>;
}

/**
 * Периодический запуск. `intervalSeconds <= 0` — выключено: до запуска рельсы
 * не должно быть ни таймера, ни RPC-опроса.
 */
export function startQuestBudgetWorker(
  deps: QuestBudgetDeps,
  intervalSeconds: number,
  log: (message: string) => void = (message) => console.log(`[quest-budget] ${message}`),
): QuestBudgetHandle | null {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return null;
  let running = false;
  const runNow = async (): Promise<QuestBudgetOutcome> => {
    if (running) return { status: "skipped", amountMicro: 0n, reason: "busy" };
    running = true;
    try {
      const outcome = await runQuestBudgetOnce(deps);
      if (outcome.status === "refilled") log(`refilled ${outcome.amountMicro} micro: ${outcome.signature ?? ""}`);
      if (outcome.status === "failed") console.error(`[quest-budget] failed: ${outcome.reason ?? "unknown"}`);
      return outcome;
    } finally {
      running = false;
    }
  };
  log(`every ${intervalSeconds}s`);
  const timer = setInterval(() => { void runNow(); }, intervalSeconds * 1000);
  timer.unref?.();
  return { stop: () => clearInterval(timer), runNow };
}
