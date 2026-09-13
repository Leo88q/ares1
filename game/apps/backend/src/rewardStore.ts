import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";

/**
 * Tiny JSON-file store: idempotent claims, per-day totals, 1:1 binding
 * between a Telegram user and a wallet, and referral tracking.
 * Good for a single instance; swap for SQLite/Postgres before running several replicas.
 */
const DATA_DIR = path.resolve(env.dataDir);
const DATA_FILE = path.join(DATA_DIR, "rewards.json");

interface ReferralRecord {
  referrerWallet: string;
  referrerUserId: number;
  invitedWallet: string;
  invitedUserId: number;
  status: "pending" | "completed" | "expired";
  createdAt: number;
  firstHarvestAt?: number;
  referrerRewardTx?: string;
  invitedRewardTx?: string;
  expiredAt?: number;
}

interface StoreShape {
  claims: Record<string, { amountMicro: string; ts: number; wallet: string }>;
  dailyTotals: Record<string, string>;
  /** telegram user id -> wallet */
  userWallet: Record<string, string>;
  /** wallet -> telegram user id */
  walletUser: Record<string, string>;
  /** invited wallet -> referral record */
  referrals: Record<string, ReferralRecord>;
  /** referrer wallet -> count of referrals completed today (YYYY-MM-DD) */
  referralDailyCounts: Record<string, string>;
}

const EMPTY: StoreShape = {
  claims: {},
  dailyTotals: {},
  userWallet: {},
  walletUser: {},
  referrals: {},
  referralDailyCounts: {},
};

function load(): StoreShape {
  if (!fs.existsSync(DATA_FILE)) return structuredClone(EMPTY);
  try {
    return {
      ...structuredClone(EMPTY),
      ...(JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Partial<StoreShape>),
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

let store = load();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store), "utf-8");
  fs.renameSync(tmp, DATA_FILE);
}

const todayUtc = () => new Date().toISOString().slice(0, 10);
const dayKey = (userId: number) => `${userId}:${todayUtc()}`;

export function alreadyClaimed(userId: number, questId: string): boolean {
  return `${userId}:${questId}` in store.claims;
}

export function claimedQuestIds(userId: number): string[] {
  const prefix = `${userId}:`;
  return Object.keys(store.claims)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

export function dailyTotalMicro(userId: number): bigint {
  const v = store.dailyTotals[dayKey(userId)];
  return v ? BigInt(v) : 0n;
}

/**
 * Enforces one wallet per Telegram account and one Telegram account per wallet.
 * Returns an error message or null when the pair is acceptable.
 */
export function checkWalletBinding(userId: number, wallet: string): string | null {
  const boundWallet = store.userWallet[String(userId)];
  if (boundWallet && boundWallet !== wallet) {
    return `Этот Telegram-аккаунт уже привязан к кошельку ${boundWallet.slice(0, 6)}…`;
  }
  const boundUser = store.walletUser[wallet];
  if (boundUser && boundUser !== String(userId)) {
    return "Этот кошелёк уже привязан к другому Telegram-аккаунту";
  }
  return null;
}

export function recordClaim(userId: number, questId: string, amountMicro: bigint, wallet: string) {
  store.claims[`${userId}:${questId}`] = { amountMicro: amountMicro.toString(), ts: Date.now(), wallet };
  const k = dayKey(userId);
  const prev = store.dailyTotals[k] ? BigInt(store.dailyTotals[k]) : 0n;
  store.dailyTotals[k] = (prev + amountMicro).toString();
  store.userWallet[String(userId)] = wallet;
  store.walletUser[wallet] = String(userId);
  persist();
}

/* ==========================================================================
   REFERRALS
   ========================================================================== */

export const REFERRAL_CONFIG = {
  /** 20 🥔 рефереру */
  referrerRewardMicro: 20_000_000n,
  /** 10 🥔 приглашённому */
  invitedRewardMicro: 10_000_000n,
  /** Максимум 20 завершённых рефералов в день на одного реферера */
  dailyCapPerReferrer: 20,
  /** Реферал действителен 30 дней */
  ttlMs: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Регистрирует реферальную связь. Возвращает null при успехе или причину отказа.
 * Отклоняет само-реферал, повторную регистрацию и уже завершённые рефералы.
 * Сибил-защита (AUDIT I9): реферер обязан быть известным игроком (его кошелёк
 * уже привязан к какому-либо Telegram-аккаунту) — иначе приглашённый мог бы
 * подменить реферера на свой же второй кошелёк и фармить бонус 30 🥔.
 */
export function registerReferral(
  referrerWallet: string,
  referrerUserId: number,
  invitedWallet: string,
  invitedUserId: number
): string | null {
  if (referrerWallet === invitedWallet) return "Само-реферал запрещён";
  if (referrerUserId === invitedUserId) return "Само-реферал запрещён";
  const referrerBoundUser = store.walletUser[referrerWallet];
  if (!referrerBoundUser || referrerBoundUser === String(invitedUserId)) {
    return "Реферер не найден: поделитесь ссылкой только с игроками";
  }

  const existing = store.referrals[invitedWallet];
  if (existing) {
    if (existing.status === "completed") return "Этот кошелёк уже получил реферальный бонус";
    if (existing.status === "pending") return "Реферал уже зарегистрирован";
  }

  store.referrals[invitedWallet] = {
    referrerWallet,
    referrerUserId,
    invitedWallet,
    invitedUserId,
    status: "pending",
    createdAt: Date.now(),
  };
  persist();
  return null;
}

export function getReferralByInvited(invitedWallet: string): ReferralRecord | undefined {
  return store.referrals[invitedWallet];
}

/** Возвращает все pending-рефералы, не истёкшие по TTL. */
export function listPendingReferrals(): ReferralRecord[] {
  const now = Date.now();
  return Object.values(store.referrals).filter(
    (r) => r.status === "pending" && now - r.createdAt < REFERRAL_CONFIG.ttlMs
  );
}

/** Сколько рефералов реферер уже завершил сегодня. */
export function referrerDailyCompleted(referrerWallet: string): number {
  const k = `${referrerWallet}:${todayUtc()}`;
  return store.referralDailyCounts[k] ? Number(store.referralDailyCounts[k]) : 0;
}

/** Помечает реферал как завершённый, увеличивает дневной счётчик реферера. */
export function completeReferral(
  invitedWallet: string,
  firstHarvestAt: number,
  referrerRewardTx: string,
  invitedRewardTx: string
) {
  const r = store.referrals[invitedWallet];
  if (!r) return;
  r.status = "completed";
  r.firstHarvestAt = firstHarvestAt;
  r.referrerRewardTx = referrerRewardTx;
  r.invitedRewardTx = invitedRewardTx;

  const k = `${r.referrerWallet}:${todayUtc()}`;
  const prev = store.referralDailyCounts[k] ? Number(store.referralDailyCounts[k]) : 0;
  store.referralDailyCounts[k] = String(prev + 1);
  persist();
}

/** Помечает реферал как истёкший (если приглашённый так и не собрал урожай за TTL). */
export function expireReferral(invitedWallet: string) {
  const r = store.referrals[invitedWallet];
  if (!r) return;
  r.status = "expired";
  r.expiredAt = Date.now();
  persist();
}

/** Статистика рефералов для UI. */
export function referralStats(referrerWallet: string) {
  const records = Object.values(store.referrals).filter((r) => r.referrerWallet === referrerWallet);
  const completed = records.filter((r) => r.status === "completed");
  const pending = records.filter((r) => r.status === "pending");
  const totalEarned = BigInt(completed.length) * REFERRAL_CONFIG.referrerRewardMicro;
  return {
    completed: completed.length,
    pending: pending.length,
    today: referrerDailyCompleted(referrerWallet),
    dailyCap: REFERRAL_CONFIG.dailyCapPerReferrer,
    totalEarnedMicro: totalEarned.toString(),
  };
}
