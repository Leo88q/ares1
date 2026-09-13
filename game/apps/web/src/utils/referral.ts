/**
 * Утилиты для реферальной программы.
 * Backend endpoints: /api/referral/register, /stats, /config
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

export interface ReferralConfig {
 referrerRewardMicro: string;
 invitedRewardMicro: string;
 dailyCap: number;
 ttlDays: number;
}

export interface ReferralStats {
 completed: number;
 pending: number;
 today: number;
 dailyCap: number;
 totalEarnedMicro: string;
}

/**
 * Извлекает wallet реферера из Telegram start_param.
 * Payload приходит в формате "ref_<base58wallet>" (до 64 символов).
 */
export function parseReferrerFromStartParam(startParam: string | null): string | null {
 if (!startParam) return null;
 if (!startParam.startsWith("ref_")) return null;
 const wallet = startParam.slice(4);
 // base58: 32-44 символа, только допустимые символы
 if (wallet.length < 32 || wallet.length > 44) return null;
 if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(wallet)) return null;
 return wallet;
}

/**
 * Регистрирует реферальную связь на бэкенде.
 * Вызывается один раз при первом запуске Mini App, если есть referrer.
 */
export async function registerReferral(params: {
 referrerWallet: string;
 invitedWallet: string;
 initData: string;
}): Promise<{ ok: boolean; error?: string; rewards?: { referrerMicro: string; invitedMicro: string } }> {
 if (!BACKEND_URL) return { ok: false, error: "Backend URL не настроен" };
 try {
  const res = await fetch(`${BACKEND_URL}/api/referral/register`, {
   method: "POST",
   headers: {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": params.initData,
   },
   body: JSON.stringify({
    referrerWallet: params.referrerWallet,
    invitedWallet: params.invitedWallet,
   }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
  return { ok: true, rewards: data.rewards };
 } catch (err) {
  return { ok: false, error: err instanceof Error ? err.message : "Network error" };
 }
}

/** Получает статистику рефералов для кошелька (публичный endpoint). */
export async function getReferralStats(wallet: string): Promise<ReferralStats | null> {
 if (!BACKEND_URL) return null;
 try {
  const res = await fetch(`${BACKEND_URL}/api/referral/stats?wallet=${encodeURIComponent(wallet)}`);
  if (!res.ok) return null;
  return await res.json();
 } catch {
  return null;
 }
}

/** Получает публичные параметры реферальной программы. */
export async function getReferralConfig(): Promise<ReferralConfig | null> {
 if (!BACKEND_URL) return null;
 try {
  const res = await fetch(`${BACKEND_URL}/api/referral/config`);
  if (!res.ok) return null;
  return await res.json();
 } catch {
  return null;
 }
}

/**
 * Формирует реферальную ссылку для шаринга.
 * Ссылка ведёт в Telegram-бота с payload "ref_<wallet>".
 */
export function buildReferralLink(botUsername: string, myWallet: string): string {
 const payload = `ref_${myWallet}`;
 return `https://t.me/${botUsername}?start=${payload}`;
}
