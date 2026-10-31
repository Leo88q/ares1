import { assertDedicatedPayer, safeError } from "./security.js";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { env } from "./env.js";
import { expectedGenesisHash } from "./cluster.js";
import { configRouter } from "./routes/config.js";
import { healthRouter } from "./routes/health.js";
import { gameOpsRouter } from "./routes/gameops.js";
import { presaleRouter } from "./routes/presale.js";
import { fetchTokenPaymentView } from "./presale/chain.js";
import { slotsRouter } from "./routes/slots.js";
import { resolveSlotsConfig } from "./slots/config.js";
import { COLONY_V1_RELEASE_READY, USER_PRESALE_PAYMENTS_ENABLED } from "./launchGates.js";
import { colonyPackageCatalogResponse } from "./colonies/catalog.js";
import { colonyAuthRouter } from "./colonies/routes.js";
import { ColonyService } from "./colonies/service.js";
import { checkColonyDatabaseRole } from "./colonies/dbReadiness.js";
import { loadGameOpsConfig } from "./gameops/env.js";
import { closePool, createPool } from "./gameops/pool.js";
import { createPgRollLock } from "./gameops/epochLock.js";
import { bindPresaleDatabaseCluster } from "./gameops/clusterGuard.js";
import { checkReadiness, httpStatusFor } from "./gameops/readiness.js";
import { startEpochRoller } from "./epochRoller.js";
import { createShutdown } from "./shutdown.js";
import { connection, secondaryConnection, fetchConfig, payerKeypair, programId } from "./solana.js";
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
  // Refuse cross-cluster configuration before serving API or running the crank.
  // This is a hard guard against a devnet RPC accidentally paired with a mainnet
  // presale (or the reverse); the UI/API label alone is not sufficient.
  const expectedGenesis = expectedGenesisHash(env.cluster);
  const actualGenesis = await connection.getGenesisHash();
  if (actualGenesis !== expectedGenesis) {
    throw new Error(`RPC cluster mismatch: configured=${env.cluster}, genesis=${actualGenesis}`);
  }
  if (env.coloniesEnabled && env.requireSecondaryRpc && !secondaryConnection) {
    throw new Error("COLONIES_ENABLED requires RPC_URL_SECONDARY for Field ownership verification");
  }
  if (env.coloniesEnabled && secondaryConnection) {
    const secondaryGenesis = await secondaryConnection.getGenesisHash();
    if (secondaryGenesis !== expectedGenesis) throw new Error(`Secondary RPC cluster mismatch: configured=${env.cluster}, genesis=${secondaryGenesis}`);
  }
  if (env.cluster === "mainnet-beta" && env.coloniesEnabled && !COLONY_V1_RELEASE_READY) {
    throw new Error("COLONIES_ENABLED is blocked on mainnet until the Colony V1 release gate is approved");
  }
  if (env.cluster === "mainnet-beta" && env.colonyFreeStarterEnabled && !COLONY_V1_RELEASE_READY) {
    throw new Error("COLONY_FREE_STARTER_ENABLED is blocked on mainnet until the Colony V1 release gate is approved");
  }
  if (process.env.NODE_ENV === "production" && env.cluster === "mainnet-beta" && (!env.coloniesEnabled || !COLONY_V1_RELEASE_READY)) {
    throw new Error("Production mainnet backend is blocked until the complete Colony V1 acceptance suite and release review pass");
  }
  if (env.coloniesEnabled && Buffer.byteLength(env.colonySessionSecret, "utf8") < 32) {
    throw new Error("COLONY_SESSION_SECRET is required (>=32 UTF-8 bytes) when COLONIES_ENABLED=true");
  }
  if (env.coloniesEnabled && process.env.NODE_ENV === "production" && env.corsOrigin === "*") {
    throw new Error("COLONIES_ENABLED requires an explicit production CORS_ORIGIN allowlist");
  }

  const app = express();
  // Env-driven (TRUST_PROXY): a hard-coded hop count mis-prices req.ip both
  // behind deeper proxy chains and when the API is exposed without a proxy.
  app.set("trust proxy", env.trustProxy);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(cors({ origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/live", (_req, res) => res.json({ live: true }));

  // Health: состояние процесса и зависимостей, но БЕЗ идентичности плательщика.
  // Публичный (исключён из rate-limit) эндпоинт не должен сообщать адрес и баланс
  // hot-wallet: это карта для целенаправленной атаки на конкретный кошелёк.
  // Состав полей закреплён тестом tests/health.test.ts.
  app.use("/health", healthRouter({
    connection,
    fetchConfig,
    gameOpsEnabled: () => Boolean(gameOpsPool),
    cluster: env.cluster,
    uptime: () => process.uptime(),
  }));

  // Слой game_ops подключается ТОЛЬКО если задан GAME_OPS_DATABASE_URL. Без него
  // бэкенд работает как раньше (read-only API + крон эпохи), а платёжные
  // эндпоинты отвечают 503 NOT_CONFIGURED — fail-closed, а не «работает
  // наполовину». Монтируется НИЖЕ, после лимитера (см. комментарий у /ready).
  const gameOpsConfig = loadGameOpsConfig();
  if (env.coloniesEnabled && gameOpsConfig?.role !== "game_ops_writer") {
    throw new Error("COLONIES_ENABLED requires GAME_OPS_DB_ROLE=game_ops_writer; refusing a connection with implicit or elevated grants");
  }
  const gameOpsPool = gameOpsConfig ? createPool(gameOpsConfig) : null;
  if (gameOpsConfig && gameOpsPool) {
    // A DB is permanently pinned to its first presale network binding; a reused
    // devnet registry must fail startup rather than ever expose mainnet orders.
    await bindPresaleDatabaseCluster(gameOpsPool, env.cluster);
    console.log(
      `[startup] game_ops on: chain=${gameOpsConfig.chainId} pool=${gameOpsConfig.poolMax} role=${gameOpsConfig.role ?? "connection-default"}`,
    );
  } else {
    console.warn(
      "[startup] game_ops off: кросс-инстансная блокировка эпохи недоступна — держите ровно одну реплику бэкенда.",
    );
  }
  if (env.coloniesEnabled) {
    if (!gameOpsPool) throw new Error("COLONIES_ENABLED requires GAME_OPS_DATABASE_URL");
    const schema = await gameOpsPool.query<{ challenges: string | null; entitlements: string | null; colonies: string | null; events: string | null; max_version: number | null; sku_unique_index: string | null; colony_fields_table: string | null; colony_fields_primary_index: string | null; colony_fields_address_index: string | null; free_starter_claim: string | null }>(
      `SELECT to_regclass('game_ops.colony_auth_challenges')::text AS challenges,
              to_regclass('game_ops.colony_entitlements')::text AS entitlements,
              to_regclass('game_ops.colonies')::text AS colonies,
              to_regclass('game_ops.colony_events')::text AS events,
              (SELECT max(version)::int FROM game_ops.schema_version) AS max_version,
              to_regclass('game_ops.colony_entitlements_one_active_sku_idx')::text AS sku_unique_index,
            to_regclass('game_ops.colony_fields')::text AS colony_fields_table,
            to_regclass('game_ops.colony_fields_one_primary_idx')::text AS colony_fields_primary_index,
            to_regclass('game_ops.colony_fields_one_active_address_idx')::text AS colony_fields_address_index,
            to_regprocedure('game_ops.claim_free_colony_starter(uuid,text,text)')::text AS free_starter_claim`,
    );
    const row = schema.rows[0];
    if (!row?.challenges || !row.entitlements || !row.colonies || !row.events
      || row.max_version !== 13 || !row.sku_unique_index || !row.colony_fields_table || !row.colony_fields_primary_index || !row.colony_fields_address_index || !row.free_starter_claim) {
      throw new Error("COLONIES_ENABLED requires game_ops schema version 13, active SKU uniqueness, Field links and free-starter grant function; refusing partial startup");
    }
    const colonyRole = await checkColonyDatabaseRole(gameOpsPool);
    if (!colonyRole.ready) {
      throw new Error(`COLONIES_ENABLED requires least-privilege game_ops_writer grants: ${colonyRole.failures.join("; ")}`);
    }
    console.log("[startup] Colony auth + finalized Field ownership verification enabled; runtime grants verified");
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

  if (env.coloniesEnabled && gameOpsPool) {
    app.use("/api/colonies", colonyAuthRouter({
      pool: gameOpsPool,
      cluster: env.cluster,
      sessionSecret: env.colonySessionSecret,
      allowedOrigins: env.corsOrigin.split(",").map(origin => origin.trim()).filter(Boolean),
      allowLocalhostForDevelopment: process.env.NODE_ENV !== "production",
      fieldRpc: connection,
      secondaryFieldRpc: secondaryConnection,
      requireSecondaryFieldRpc: env.requireSecondaryRpc,
      programId,
      colonyService: new ColonyService(gameOpsPool, env.cluster, env.colonyFreeStarterEnabled),
    }));
  }

  // Product transparency endpoint only; this static proposal cannot create
  // payment orders or entitlements and remains explicitly closed by default.
  app.get("/api/colonies/catalog", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json(colonyPackageCatalogResponse());
  });

  if (gameOpsConfig && gameOpsPool) {
    app.use("/api/gameops", gameOpsRouter(gameOpsPool, gameOpsConfig, {
      // Доказательство возврата по слоту читается из цепи, а не из тела запроса.
      fetchTokenView: signature => fetchTokenPaymentView(connection, signature),
    }));
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
          cluster: env.cluster,
          paymentsEnabled: USER_PRESALE_PAYMENTS_ENABLED && (env.cluster === "mainnet-beta"
            ? process.env.NODE_ENV === "production" && env.mainnetPresaleApproved
            : env.devnetPresaleTestEnabled),
          potatoMint: chainCfg.potatoMint.toBase58(),
        }),
      );
      const paymentsEnabled = USER_PRESALE_PAYMENTS_ENABLED && (env.cluster === "mainnet-beta"
        ? process.env.NODE_ENV === "production" && env.mainnetPresaleApproved
        : env.devnetPresaleTestEnabled);
      console.log(`[startup] presale router on: cluster=${env.cluster} payments=${paymentsEnabled ? "enabled" : "disabled-by-default"}`);
    } catch (err) {
      console.log("[startup] presale router not mounted: chain config unavailable");
    }
  }
  // Слоты грядок (S7): маршрут есть только при SLOTS_ENABLED=true, полной конфигурации
  // и работающем game_ops. Иначе маршрута нет, причина пишется в лог (fail-closed).
  const slotsCfg = resolveSlotsConfig(process.env, env.cluster);
  if (slotsCfg.enabled && gameOpsPool) {
    app.use("/api/slots", slotsRouter(gameOpsPool, { connection, config: slotsCfg.config }));
    console.log(`[startup] slots router on: cluster=${env.cluster} key=${slotsCfg.config.keyId}`);
  } else if (slotsCfg.enabled) {
    console.log("[startup] slots router off: game_ops off");
  } else {
    console.log(`[startup] slots router off: ${slotsCfg.reason}${"detail" in slotsCfg ? ` (${slotsCfg.detail})` : ""}`);
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

  // Крон эпохи защищён общей блокировкой, когда включён game_ops: несколько
  // реплик (перекрытие при выкатке, горизонтальное масштабирование) тогда не
  // дублируют roll_epoch. Без БД блокировки нет — это режим «ровно один инстанс».
  const roller = startEpochRoller({ lock: gameOpsPool ? createPgRollLock(gameOpsPool) : null });
  const server = app.listen(env.port, "0.0.0.0", () => {
    console.log(`[startup] Solana Potato backend on :${env.port}`);
    console.log(`[startup] program=${programId.toBase58()}`);
    console.log(`[startup] epoch-payer=${payerKeypair.publicKey.toBase58()} epoch=${config.epochId}`);
  });

  // Остановка (see shutdown.ts): сначала крон эпохи и дренаж HTTP, затем
  // пул — чтобы «полуоткрытая» транзакция выплаты не осталась в соединении
  // с ролью-писателем, а roll_epoch не потерял advisory lock посреди такта.
  const shutdown = createShutdown({
    stopRoller: () => roller.stop(),
    server,
    closePool: gameOpsPool ? () => closePool(gameOpsPool) : undefined,
  });
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[startup] fatal:", safeError(err));
  process.exit(1);
});
