/**
 * Публичные эндпоинты стартового набора и дейлика.
 *
 * Контракт:
 *   GET  /api/rewards/status        — что доступно и почему (без секретов);
 *   POST /api/rewards/starter       — { wallet } → один грант 250 POTATO на кошелёк;
 *   POST /api/rewards/daily         — { wallet } → 7 POTATO, один раз в UTC-сутки.
 *
 * Всё, что можно проверить без сети, проверяется здесь: формат адреса, гейт,
 * бюджет, кулдаун. Ончейн-PDA `[reward, ata, nonce]` — последняя линия: повтор
 * того же nonce отклоняет рантайм, поэтому гонка двух запросов не выдаёт два
 * гранта.
 *
 * Зависимости инжектируются: тесты не ходят ни в RPC, ни в сеть.
 */
import express, { Router } from "express";
import type { PublicKey } from "@solana/web3.js";
import {
  DAILY_BONUS_MICRO,
  GRANT_AMOUNTS_MICRO,
  STARTER_GRANT_MICRO,
  WALLET_COOLDOWN_SECONDS,
  chargeBudget,
  grantExpiry,
  grantNonce,
  isWalletAddress,
  refundBudget,
  type GrantBudgetState,
  type GrantKind,
} from "./rail.js";

export interface RewardsRouterDeps {
  /** Итоговый гейт: флаг запуска + наличие ключа + кластер. */
  enabled: boolean;
  /** Причина, если выключено — отдаётся наружу как есть (без внутренних путей). */
  disabledReason?: string;
  /** Адрес подписанта (не секрет) — нужен клиенту, чтобы показать «рельса жива». */
  rewardSigner: PublicKey | null;
  now: () => bigint;
  /** Отправка гранта. Бросает при отказе цепи/симуляции. */
  sendGrant: (input: { wallet: string; amountMicro: bigint; nonce: bigint; expiresAt: bigint }) => Promise<string>;
}

interface WalletState {
  lastRequestAt: bigint;
}

export function rewardsRouter(deps: RewardsRouterDeps): Router {
  const router = Router();
  const budgets: Record<GrantKind, GrantBudgetState> = {
    starter: { day: -1n, spentMicro: 0n },
    daily: { day: -1n, spentMicro: 0n },
  };
  const wallets = new Map<string, WalletState>();

  const claimBudget = (kind: GrantKind): boolean => {
    const result = chargeBudget(budgets[kind], kind, deps.now());
    if (!result.ok) return false;
    budgets[kind] = result.state;
    return true;
  };

  const coinCooledDown = (wallet: string): boolean => {
    const now = deps.now();
    const previous = wallets.get(wallet);
    if (previous && now - previous.lastRequestAt < WALLET_COOLDOWN_SECONDS) return false;
    wallets.set(wallet, { lastRequestAt: now });
    // Простая защита от роста карты: держим не больше 10k адресов.
    if (wallets.size > 10_000) {
      const oldest = wallets.keys().next().value;
      if (oldest) wallets.delete(oldest);
    }
    return true;
  };

  router.get("/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      enabled: deps.enabled,
      reason: deps.enabled ? null : deps.disabledReason ?? "disabled",
      rewardSigner: deps.rewardSigner?.toBase58() ?? null,
      starter: {
        amountMicro: STARTER_GRANT_MICRO.toString(),
        amountPotato: "250",
        scope: "one-per-wallet",
      },
      daily: {
        amountMicro: DAILY_BONUS_MICRO.toString(),
        amountPotato: "7",
        scope: "one-per-wallet-per-utc-day",
      },
    });
  });

  const grant = (kind: GrantKind) => async (req: express.Request, res: express.Response) => {
    if (!deps.enabled) {
      res.status(503).json({ error: "NOT_ENABLED", message: deps.disabledReason ?? "disabled" });
      return;
    }
    const wallet = typeof req.body?.wallet === "string" ? req.body.wallet.trim() : "";
    if (!isWalletAddress(wallet)) {
      res.status(400).json({ error: "BAD_WALLET", message: "wallet must be a base58 address" });
      return;
    }
    if (!coinCooledDown(wallet)) {
      res.status(429).json({ error: "COOLDOWN", message: "one request per wallet per 15 s" });
      return;
    }
    if (!claimBudget(kind)) {
      // 503, а не 429: это наша квота, клиенту нечего «повторять с задержкой».
      res.status(503).json({ error: "BUDGET_EXHAUSTED", message: "daily reward budget is exhausted" });
      return;
    }
    const now = deps.now();
    const amountMicro = GRANT_AMOUNTS_MICRO[kind];
    const nonce = grantNonce(kind, wallet, now);
    try {
      const signature = await deps.sendGrant({
        wallet,
        amountMicro,
        nonce,
        expiresAt: grantExpiry(now),
      });
      res.status(201).json({
        ok: true,
        kind,
        wallet,
        amountMicro: amountMicro.toString(),
        signature,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      // Уже выданный грант — не ошибка сервера: PDA существует, деньги на месте.
      // Бюджет в этом случае НЕ возвращаем: грант выдан, деньги ушли получателю.
      if (/already in use|custom program error: 0x0\b/.test(message)) {
        res.status(409).json({ error: "ALREADY_GRANTED", message: "this grant was already claimed" });
        return;
      }
      // Ничего не выдано — списание бюджета откатываем, иначе серия неудачных
      // попыток вычерпывает суточный бюджет и честные игроки получают 503.
      budgets[kind] = refundBudget(budgets[kind], kind, deps.now());
      // Наружу — только код и короткий хвост причины: полный текст ошибки RPC
      // содержит адреса аккаунтов и внутренние детали.
      res.status(502).json({ error: "GRANT_FAILED", message: message.slice(-200) });
    }
  };

  router.post("/starter", express.json({ limit: "2kb" }), grant("starter"));
  router.post("/daily", express.json({ limit: "2kb" }), grant("daily"));
  return router;
}
