import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { telegramAuthMiddleware } from "../telegramAuth.js";
import {
  REFERRAL_CONFIG,
  checkWalletBinding,
  referralStats,
  registerReferral,
} from "../rewardStore.js";

export const referralRouter = Router();

/**
 * POST /api/referral/register
 * Вызывается Mini App при первом запуске, если в Telegram.WebApp.initDataUnsafe.start_param
 * есть payload вида "ref_<referrerWallet>".
 *
 * Body: { referrerWallet: string, invitedWallet: string }
 */
referralRouter.post("/register", telegramAuthMiddleware, async (req, res) => {
  const user = req.telegramUser!;
  const { referrerWallet, invitedWallet } = (req.body ?? {}) as {
    referrerWallet?: unknown;
    invitedWallet?: unknown;
  };

  if (typeof referrerWallet !== "string" || typeof invitedWallet !== "string") {
    return res.status(400).json({ error: "Invalid payload" });
  }

  // Валидируем оба адреса
  let referrerPk: PublicKey;
  let invitedPk: PublicKey;
  try {
    referrerPk = new PublicKey(referrerWallet);
    invitedPk = new PublicKey(invitedWallet);
  } catch {
    return res.status(400).json({ error: "Invalid wallet address" });
  }

  // invitedWallet должен быть привязан к этому Telegram-аккаунту (или ещё не привязан)
  const bindingError = checkWalletBinding(user.id, invitedPk.toBase58());
  if (bindingError) return res.status(403).json({ error: bindingError });

  const referrerUserId = Number(user.id); // если реферер сам был приглашён, у нас может не быть его TG id — используем invited id как placeholder
  // На самом деле у нас нет Telegram-аккаунта реферера — используем только wallet как идентификатор.
  // referrerUserId используется только для счётчика dailyTotals; здесь он не критичен.
  const error = registerReferral(
    referrerPk.toBase58(),
    0, // реферер может быть не Telegram-пользователем в нашей БД
    invitedPk.toBase58(),
    referrerUserId
  );
  if (error) return res.status(409).json({ error });

  console.log(
    `[referral] registered: referrer=${referrerPk.toBase58()} invited=${invitedPk.toBase58()} user=${user.id}`
  );
  res.json({ ok: true, rewards: {
    referrerMicro: REFERRAL_CONFIG.referrerRewardMicro.toString(),
    invitedMicro: REFERRAL_CONFIG.invitedRewardMicro.toString(),
  }});
});

/**
 * GET /api/referral/stats?wallet=<wallet>
 * Возвращает статистику рефералов для UI (количество приглашённых, заработано и т.д.)
 */
referralRouter.get("/stats", async (req, res) => {
  const wallet = String(req.query.wallet ?? "");
  try {
    new PublicKey(wallet); // валидация
  } catch {
    return res.status(400).json({ error: "Invalid wallet" });
  }
  res.json(referralStats(wallet));
});

/**
 * GET /api/referral/config
 * Публичные параметры рефералки для UI.
 */
referralRouter.get("/config", (_req, res) => {
  res.json({
    referrerRewardMicro: REFERRAL_CONFIG.referrerRewardMicro.toString(),
    invitedRewardMicro: REFERRAL_CONFIG.invitedRewardMicro.toString(),
    dailyCap: REFERRAL_CONFIG.dailyCapPerReferrer,
    ttlDays: REFERRAL_CONFIG.ttlMs / (24 * 60 * 60 * 1000),
  });
});
