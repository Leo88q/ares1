import { assertDedicatedPayer, safeError } from "./security.js";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { env } from "./env.js";
import { configRouter } from "./routes/config.js";
import { gameOpsRouter } from "./routes/gameops.js";
import { presaleRouter } from "./routes/presale.js";
import { loadGameOpsConfig } from "./gameops/env.js";
import { closePool, createPool } from "./gameops/pool.js";
import { checkReadiness, httpStatusFor } from "./gameops/readiness.js";
import { startEpochRoller } from "./epochRoller.js";
import { connection, fetchConfig, payerKeypair, programId } from "./solana.js";
import { buildAlert, sendAlert } from "./alert.js";

/** Minimal fixed-window rate limiter per IP with TTL pruning. */
function rateLimit(perMinute: number) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    // Прунинг каждую минуту или при >5k записей — предотвращает утечку памяти (AUDIT I5)
    if (hits.size > 5000 || now % 60000 < 100) {
      for (const [k, v] of hits) if (now - v.windowStart > 120_000) hits.delete(k);
    }
    const entry = hits.get(ip);
    if (!entry || now - entry.windowStart > 60_000) {
      hits.set(ip, { count: 1, windowStart: now });
      return next();
    }
    entry.count += 1;
    if (entry.count > perMinute) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "Too many requests" });
    }
    next();
  };
}

// Security headers middleware (lightweight helmet alternative)
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // CSP for API: no inline needed
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
}

async function main() {
  const app = express();
  // Env-driven (TRUST_PROXY): a hard-coded hop count mis-prices req.ip both
  // behind deeper proxy chains and when the API is exposed without a proxy.
  app.set("trust proxy", env.trustProxy);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(cors({ origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/live", (_req, res) => res.json({ live: true }));

  // Health with detailed checks
  app.get("/health", async (_req, res) => {
    try {
      const [slot, config, payerBal] = await Promise.all([
        connection.getSlot(),
        fetchConfig(),
        connection.getBalance(payerKeypair.publicKey),
      ]);
      res.json({
        ok: true,
        slot,
        epochId: config.epochId.toString(),
        paused: config.paused,
        payer: payerKeypair.publicKey.toBase58(),
        payerSol: payerBal / 1e9,
        gameOps: gameOpsPool ? "on" : "off",
        uptime: process.uptime(),
      });
    } catch (err) {
      res.status(503).json({ ok: false, error: "Dependency check failed" });
    }
  });

  // Слой game_ops подключается ТОЛЬКО если задан GAME_OPS_DATABASE_URL. Без него
  // бэкенд работает как раньше (read-only API + крон эпохи), а платёжные
  // эндпоинты отвечают 503 NOT_CONFIGURED — fail-closed, а не «работает
  // наполовину». Монтируется НИЖЕ, после лимитера (см. комментарий у /ready).
  const gameOpsConfig = loadGameOpsConfig();
  const gameOpsPool = gameOpsConfig ? createPool(gameOpsConfig) : null;
  if (gameOpsConfig && gameOpsPool) {
    console.log(
      `[startup] game_ops on: chain=${gameOpsConfig.chainId} pool=${gameOpsConfig.poolMax} role=${gameOpsConfig.role ?? "connection-default"}`,
    );
  }

  // Readiness probe (k8s): цепь и слой данных проверяются вместе. Если хотя бы
  // одна проверка слоя данных провалена — 503: под может быть жив, но награды
  // выдавать нельзя (расхождение журнала/сверки).
  app.get("/ready", async (_req, res) => {
    try {
      await fetchConfig();
    } catch {
      res.status(503).json({ ready: false, error: "CHAIN_UNAVAILABLE" });
      return;
    }
    if (!gameOpsConfig || !gameOpsPool) {
      res.json({ ready: true, gameOps: "off" });
      return;
    }
    const report = await checkReadiness(gameOpsPool, gameOpsConfig);
    res.status(httpStatusFor(report)).json({ ready: report.ready, gameOps: "on", checks: report.checks });
  });

  // 2026-10-02 (audit): the per-IP rate limit applies to the DATA surface only.
  // /live, /health and /ready are exempt on purpose: a 429 on a k8s probe makes
  // an orchestrator think the process is dead and restart it. The three probes
  // are read-only, cheap and bounded (one config read / one readiness report).
  // Note the limiter is per-process memory; with more than one replica the
  // effective limit is N× — use a shared store when you scale horizontally.
  app.use(rateLimit(env.rateLimitPerMinute));

  if (gameOpsConfig && gameOpsPool) {
    app.use("/api/gameops", gameOpsRouter(gameOpsPool, gameOpsConfig));
  }
  // Пресейл монтируется только при включённом game_ops и доступной цепи: без БД
  // нет учёта заказов, без цепи — нет верификации платежа. Fail-closed.
  if (gameOpsConfig && gameOpsPool) {
    try {
      const chainCfg = await fetchConfig();
      app.use(
        "/api/presale",
        rateLimit(env.rateLimitPerMinute),
        presaleRouter(gameOpsPool, gameOpsConfig, {
          connection,
          potatoMint: chainCfg.potatoMint.toBase58(),
        }),
      );
      console.log("[startup] presale router on");
    } catch (err) {
      console.log("[startup] presale router not mounted: chain config unavailable");
    }
  }
  app.use("/api/config", configRouter);

  // 404
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[http] unhandled error:", safeError(err));
    res.status(500).json({ error: "Internal error" });
  });

  const config = await fetchConfig();
  assertDedicatedPayer(payerKeypair.publicKey, config);
  // Fail-fast: payer без баланса роллить эпохи не сможет (rent + fee ~0.01 SOL/эпоху с запасом)
  const payerBal = await connection.getBalance(payerKeypair.publicKey);
  if (payerBal < 10_000_000) {
    console.error(
      `[startup] FATAL: PAYER_KEYPAIR_JSON (${payerKeypair.publicKey.toBase58()}) ` +
      `баланс ${(payerBal / 1e9).toFixed(4)} SOL < 0.01 — нечем платить rent/fee за epoch. Бэкенд не запускается.`,
    );
    await sendAlert(
      env.alertWebhookUrl,
      buildAlert(
        "payer_balance_fatal",
        `dedicated payer balance ${(payerBal / 1e9).toFixed(4)} SOL < 0.01 — epoch roller cannot pay rent/fee; backend refusing to start`,
      ),
    );
    process.exit(1);
  }
  // Checklist item 43: a hot wallet holding more than the operating ceiling is
  // unnecessary blast radius. Alert (not fatal) — the operator tops up in small
  // tranches and keeps the rest of the float in the treasury multisig.
  if (payerBal > env.payerMaxLamports) {
    const solBalance = (payerBal / 1e9).toFixed(4);
    const solCeiling = (env.payerMaxLamports / 1e9).toFixed(4);
    console.warn(
      `[startup] WARNING: epoch payer holds ${solBalance} SOL > PAYER_MAX_LAMPORTS ceiling ${solCeiling} SOL — ` +
      `sweep the surplus back to the treasury (checklist item 43: hot-wallet exposure).`,
    );
    await sendAlert(
      env.alertWebhookUrl,
      buildAlert(
        "payer_balance_above_ceiling",
        `epoch payer ${payerKeypair.publicKey.toBase58()} holds ${solBalance} SOL, above the ${solCeiling} SOL hot-wallet ceiling; sweep the surplus`,
      ),
    );
  }
  if (env.corsOrigin === "*" && process.env.NODE_ENV === "production") {
    console.warn("[startup] WARNING: CORS_ORIGIN='*' in production — restrict to your dApp domain!");
  }

  // Остановка: сначала перестаём принимать запросы, затем закрываем пул, чтобы
  // «полуоткрытая» транзакция выплаты не осталась в соединении с ролью-писателем.
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal}: закрываю пул game_ops`);
    if (gameOpsPool) await closePool(gameOpsPool);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  startEpochRoller();
  app.listen(env.port, "0.0.0.0", () => {
    console.log(`[startup] Solana Potato backend on :${env.port}`);
    console.log(`[startup] program=${programId.toBase58()}`);
    console.log(`[startup] epoch-payer=${payerKeypair.publicKey.toBase58()} epoch=${config.epochId}`);
  });
}

main().catch((err) => {
  console.error("[startup] fatal:", safeError(err));
  process.exit(1);
});
