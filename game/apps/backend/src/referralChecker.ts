/**
 * Периодически сканирует pending-рефералы и проверяет on-chain:
 * сделал ли приглашённый свой первый сбор урожая.
 *
 * Если да — выплачивает бонусы:
 *   - 20 🥔 рефереру (referrerWallet)
 *   - 10 🥔 приглашённому (invitedWallet)
 * через существующую инструкцию grant_reward.
 *
 * Защита от атак:
 *   - бонус только после РЕАЛЬНОГО on-chain harvest (не по /claim)
 *   - само-реферал отклоняется в registerReferral
 *   - идемпотентность по invitedWallet (статус completed)
 *   - лимит 20 завершённых рефералов в день на реферера
 *   - выплата идёт через grant_reward → учитывается в капе эпохи
 */

import { PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import {
  listPendingReferrals,
  completeReferral,
  expireReferral,
  referrerDailyCompleted,
  REFERRAL_CONFIG,
} from "./rewardStore.js";
import {
  authorityKeypair,
  buildGrantRewardIx,
  configPda,
  connection,
  epochPda,
  fetchConfig,
  programId,
  sendAdminTx,
} from "./solana.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 минут

/**
 * Декодирует минимум полей Field-аккаунта.
 * Layout (см. AUDIT.md): 8 discriminator + 32 owner + 1 level + 1 durability + 8 last_harvest + ...
 */
function decodeFieldOwnerAndHarvest(data: Buffer): { owner: PublicKey; lastHarvest: bigint } | null {
  if (data.length < 8 + 32 + 1 + 1 + 8) return null;
  const owner = new PublicKey(data.subarray(8, 8 + 32));
  // last_harvest — i64 LE на offset 8+32+1+1 = 42
  const lastHarvest = data.readBigInt64LE(42);
  return { owner, lastHarvest };
}

/**
 * Проверяет есть ли у wallet хотя бы одно поле с last_harvest > 0
 * (т.е. он реально собирал урожай, а не просто создал поле).
 */
async function hasEverHarvested(wallet: PublicKey): Promise<{ ok: boolean; harvestTs?: bigint }> {
  try {
    const fields = await connection.getProgramAccounts(programId, {
      dataSlice: { offset: 0, length: 8 + 32 + 1 + 1 + 8 }, // только нужные нам поля
      filters: [
        { memcmp: { offset: 8, bytes: wallet.toBase58() } }, // Field.owner == wallet
      ],
    });
    for (const { account } of fields) {
      const decoded = decodeFieldOwnerAndHarvest(account.data);
      if (decoded && decoded.lastHarvest > 0n) {
        return { ok: true, harvestTs: decoded.lastHarvest };
      }
    }
    return { ok: false };
  } catch (err) {
    console.error("[referral-checker] getProgramAccounts failed:", err);
    return { ok: false };
  }
}

async function payReferral(referral: {
  invitedWallet: string;
  referrerWallet: string;
  harvestTs: bigint;
}): Promise<{ referrerTx: string; invitedTx: string } | null> {
  try {
    const config = await fetchConfig();
    if (config.paused) {
      console.log("[referral-checker] game paused, skipping payouts");
      return null;
    }

    const referrerPk = new PublicKey(referral.referrerWallet);
    const invitedPk = new PublicKey(referral.invitedWallet);

    // ATA для обоих получателей
    const referrerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      authorityKeypair,
      config.potatoMint,
      referrerPk,
      false
    );
    const invitedAta = await getOrCreateAssociatedTokenAccount(
      connection,
      authorityKeypair,
      config.potatoMint,
      invitedPk,
      false
    );

    // 1) Бонус рефереру (20 🥔)
    const referrerIx = buildGrantRewardIx({
      config: configPda(),
      epoch: epochPda(config.epochId),
      authority: authorityKeypair.publicKey,
      potatoMint: config.potatoMint,
      userPotato: referrerAta.address,
      amountMicro: REFERRAL_CONFIG.referrerRewardMicro,
    });
    const referrerTx = await sendAdminTx([referrerIx]);

    // 2) Бонус приглашённому (10 🥔)
    const invitedIx = buildGrantRewardIx({
      config: configPda(),
      epoch: epochPda(config.epochId),
      authority: authorityKeypair.publicKey,
      potatoMint: config.potatoMint,
      userPotato: invitedAta.address,
      amountMicro: REFERRAL_CONFIG.invitedRewardMicro,
    });
    const invitedTx = await sendAdminTx([invitedIx]);

    return { referrerTx, invitedTx };
  } catch (err) {
    console.error(
      `[referral-checker] payout failed for invited=${referral.invitedWallet}:`,
      err
    );
    return null;
  }
}

async function tick() {
  const pending = listPendingReferrals();
  if (pending.length === 0) return;

  console.log(`[referral-checker] scanning ${pending.length} pending referral(s)`);

  for (const r of pending) {
    // Лимит на реферера: 20/день
    if (referrerDailyCompleted(r.referrerWallet) >= REFERRAL_CONFIG.dailyCapPerReferrer) {
      continue;
    }

    const harvest = await hasEverHarvested(new PublicKey(r.invitedWallet));
    if (!harvest.ok) continue;

    // Приглашённый собрал первый урожай — платим обеим сторонам
    const payout = await payReferral({
      invitedWallet: r.invitedWallet,
      referrerWallet: r.referrerWallet,
      harvestTs: harvest.harvestTs!,
    });
    if (!payout) continue;

    completeReferral(r.invitedWallet, Number(harvest.harvestTs), payout.referrerTx, payout.invitedTx);
    console.log(
      `[referral] completed: referrer=${r.referrerWallet} invited=${r.invitedWallet} ` +
        `tx_referrer=${payout.referrerTx} tx_invited=${payout.invitedTx}`
    );
  }

  // Помечаем как expired те, у кого истёк TTL
  const now = Date.now();
  for (const r of listPendingReferrals()) {
    if (now - r.createdAt > REFERRAL_CONFIG.ttlMs) {
      expireReferral(r.invitedWallet);
    }
  }
}

let running = false;

export function startReferralChecker() {
  if (running) return;
  running = true;
  console.log(`[referral-checker] started, interval=${CHECK_INTERVAL_MS / 1000}s`);

  // Первый тик через 30 секунд после старта (чтобы RPC успел прогреться)
  setTimeout(() => {
    tick().catch((err) => console.error("[referral-checker] tick failed:", err));
    setInterval(() => {
      tick().catch((err) => console.error("[referral-checker] tick failed:", err));
    }, CHECK_INTERVAL_MS);
  }, 30_000);
}
