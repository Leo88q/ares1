import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { env } from "./env.js";
import { configRouter } from "./routes/config.js";
import { startEpochRoller } from "./epochRoller.js";
import { connection, fetchConfig, payerKeypair, programId } from "./solana.js";

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
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(cors({ origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "16kb" }));

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
        uptime: process.uptime(),
      });
    } catch (err) {
      res.status(503).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Readiness probe (k8s)
  app.get("/ready", async (_req, res) => {
    try {
      await fetchConfig();
      res.json({ ready: true });
    } catch {
      res.status(503).json({ ready: false });
    }
  });

  app.use("/api/config", rateLimit(env.rateLimitPerMinute), configRouter);

  // 404
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[http] unhandled error:", err);
    res.status(500).json({ error: "Internal error" });
  });

  const config = await fetchConfig();
  // Fail-fast: payer без баланса роллить эпохи не сможет (rent + fee ~0.01 SOL/эпоху с запасом)
  const payerBal = await connection.getBalance(payerKeypair.publicKey);
  if (payerBal < 10_000_000) {
    console.error(
      `[startup] FATAL: PAYER_KEYPAIR_JSON (${payerKeypair.publicKey.toBase58()}) ` +
      `баланс ${(payerBal / 1e9).toFixed(4)} SOL < 0.01 — нечем платить rent/fee за epoch. Бэкенд не запускается.`,
    );
    process.exit(1);
  }
  if (env.corsOrigin === "*" && process.env.NODE_ENV === "production") {
    console.warn("[startup] WARNING: CORS_ORIGIN='*' in production — restrict to your dApp domain!");
  }

  startEpochRoller();
  app.listen(env.port, () => {
    console.log(`[startup] Solana Potato backend on :${env.port}`);
    console.log(`[startup] program=${programId.toBase58()} rpc=${env.rpcUrl}`);
    console.log(`[startup] epoch-payer=${payerKeypair.publicKey.toBase58()} epoch=${config.epochId}`);
  });
}

main().catch((err) => {
  console.error("[startup] fatal:", err);
  process.exit(1);
});
