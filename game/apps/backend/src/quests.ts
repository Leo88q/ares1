import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection, programId } from "./solana.js";
import { env } from "./env.js";

/** Reward amounts in micro 🥔. Ids must match apps/web/src/components/ProfileScreen.tsx. */
export const FIXED_QUESTS: Record<string, bigint> = {
  starter_pack: 100_000_000n, // enough for the cheapest field
  social_channel: 10_000_000n,
  a1: 50_000_000n, // first field
  a2: 50_000_000n, // 100 🥔
  a3: 100_000_000n, // 1 000 🥔
  a4: 100_000_000n, // 5 fields
  a5: 200_000_000n, // 10 000 🥔
  a6: 50_000_000n, // player level 3 (6 fields)
};
const DAILY_CHECKIN_MICRO = 5_000_000n;
const AD_BONUS_MICRO = 25_000_000n;

const FIELD_ACCOUNT_SIZE = 8 + 32 + 1 + 1 + 8 + 8 + 8 + 1 + 1 + 1 + 1; // 70: +mutation_type (v2)
const MICRO = 1_000_000n;

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Resolves a quest id to its reward, or null when unknown / not claimable today. */
export function resolveQuestAmount(questId: string): bigint | null {
  if (questId in FIXED_QUESTS) return FIXED_QUESTS[questId];
  const [kind, datePart] = questId.split(":");
  if (datePart !== todayUtc()) return null;
  if (kind === "daily_checkin") return DAILY_CHECKIN_MICRO;
  if (kind === "ad_bonus") return AD_BONUS_MICRO;
  return null;
}

async function countFields(owner: PublicKey): Promise<number> {
  const accounts = await connection.getProgramAccounts(programId, {
    dataSlice: { offset: 0, length: 0 },
    filters: [{ dataSize: FIELD_ACCOUNT_SIZE }, { memcmp: { offset: 8, bytes: owner.toBase58() } }],
  });
  return accounts.length;
}

async function potatoBalanceMicro(owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner, false);
    const bal = await connection.getTokenAccountBalance(ata);
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}

async function isChannelMember(telegramUserId: number): Promise<boolean> {
  if (!env.telegramChannelId) return true; // verification disabled
  const url = `https://api.telegram.org/bot${env.telegramBotToken}/getChatMember?chat_id=${encodeURIComponent(env.telegramChannelId)}&user_id=${telegramUserId}`;
  const res = await fetch(url);
  if (!res.ok) return false;
  const json = (await res.json()) as { ok: boolean; result?: { status: string } };
  return json.ok && ["member", "administrator", "creator"].includes(json.result?.status ?? "");
}

/**
 * Server-side verification of quest progress so a client cannot claim an
 * achievement it has not earned. Returns an error string or null when OK.
 */
export async function verifyQuest(
  questId: string,
  owner: PublicKey,
  potatoMint: PublicKey,
  telegramUserId: number,
): Promise<string | null> {
  switch (questId) {
    case "a1":
      return (await countFields(owner)) >= 1 ? null : "Сначала создай поле";
    case "a4":
      return (await countFields(owner)) >= 5 ? null : "Нужно 5 полей";
    case "a6":
      return (await countFields(owner)) >= 6 ? null : "Нужен 3-й уровень (6 полей)";
    case "a2":
      return (await potatoBalanceMicro(owner, potatoMint)) >= 100n * MICRO ? null : "Накопи 100 🥔";
    case "a3":
      return (await potatoBalanceMicro(owner, potatoMint)) >= 1_000n * MICRO ? null : "Накопи 1 000 🥔";
    case "a5":
      return (await potatoBalanceMicro(owner, potatoMint)) >= 10_000n * MICRO ? null : "Накопи 10 000 🥔";
    case "social_channel":
      return (await isChannelMember(telegramUserId)) ? null : "Подписка на канал не найдена";
    default:
      return null; // starter_pack, daily_checkin, ad_bonus: idempotency is the only rule
  }
}
