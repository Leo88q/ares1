import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { telegramAuthMiddleware } from "../telegramAuth.js";
import { env } from "../env.js";
import { alreadyClaimed, checkWalletBinding, claimedQuestIds, dailyTotalMicro, recordClaim } from "../rewardStore.js";
import { FIXED_QUESTS, isChannelVerificationEnabled, resolveQuestAmount, verifyQuest } from "../quests.js";
import { authorityKeypair, buildGrantRewardIx, configPda, connection, epochPda, fetchConfig, sendAdminTx } from "../solana.js";

export const rewardRouter = Router();

/** Quest ids this Telegram user has already claimed (drives the ✓ marks in the UI). */
rewardRouter.get("/status", telegramAuthMiddleware, (req, res) => {
  res.json({ claimed: claimedQuestIds(req.telegramUser!.id) });
});

rewardRouter.get("/quests", (_req, res) => {
  const quests: Record<string, string> = {};
  for (const [k, v] of Object.entries(FIXED_QUESTS)) {
    // social_channel без TELEGRAM_CHANNEL_ID не верифицируется — не показываем его
    if (k === "social_channel" && !isChannelVerificationEnabled()) continue;
    quests[k] = v.toString();
  }
  res.json(quests);
});

// One claim at a time per user: prevents double-spend from parallel requests.
const inFlight = new Set<number>();

rewardRouter.post("/claim", telegramAuthMiddleware, async (req, res) => {
  const { questId, walletAddress } = (req.body ?? {}) as { questId?: unknown; walletAddress?: unknown };
  const user = req.telegramUser!;

  if (typeof questId !== "string" || questId.length > 64) {
    return res.status(400).json({ error: "Invalid questId" });
  }
  if (questId === "social_channel" && !isChannelVerificationEnabled()) {
    return res.status(400).json({ error: "Квест «подписка» недоступен: верификация канала не настроена (TELEGRAM_CHANNEL_ID)" });
  }
  const amount = resolveQuestAmount(questId);
  if (amount === null) return res.status(400).json({ error: "Unknown or expired questId" });

  let owner: PublicKey;
  try {
    owner = new PublicKey(String(walletAddress));
  } catch {
    return res.status(400).json({ error: "Invalid walletAddress" });
  }

  const bindingError = checkWalletBinding(user.id, owner.toBase58());
  if (bindingError) return res.status(403).json({ error: bindingError });
  if (alreadyClaimed(user.id, questId)) return res.status(409).json({ error: "Quest already claimed" });
  if (amount > env.maxSingleRewardMicro) return res.status(400).json({ error: "Reward exceeds per-claim limit" });
  if (dailyTotalMicro(user.id) + amount > env.dailyUserRewardCapMicro) {
    return res.status(429).json({ error: "Daily reward cap reached" });
  }
  if (inFlight.has(user.id)) return res.status(429).json({ error: "Another claim is in progress" });
  inFlight.add(user.id);

  try {
    const config = await fetchConfig();
    if (config.paused) return res.status(503).json({ error: "Game is paused" });

    const verifyError = await verifyQuest(questId, owner, config.potatoMint, user.id);
    if (verifyError) return res.status(403).json({ error: verifyError });

    const userAta = await getOrCreateAssociatedTokenAccount(connection, authorityKeypair, config.potatoMint, owner, false);
    const ix = buildGrantRewardIx({
      config: configPda(),
      epoch: epochPda(config.epochId),
      authority: authorityKeypair.publicKey,
      potatoMint: config.potatoMint,
      userPotato: userAta.address,
      amountMicro: amount,
    });
    const sig = await sendAdminTx([ix]);
    recordClaim(user.id, questId, amount, owner.toBase58());
    console.log(`[reward] user=${user.id} quest=${questId} amount=${amount} wallet=${owner.toBase58()} tx=${sig}`);
    res.json({ ok: true, signature: sig, amountMicro: amount.toString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "grant_reward failed";
    console.error(`[reward] failed user=${user.id} quest=${questId}:`, message);
    res.status(500).json({ error: message });
  } finally {
    inFlight.delete(user.id);
  }
});
