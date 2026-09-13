import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { env } from "./env.js";
import { rewardRouter } from "./routes/reward.js";
import { referralRouter } from "./routes/referral.js";
import { configRouter } from "./routes/config.js";
import { startEpochRoller } from "./epochRoller.js";
import { startReferralChecker } from "./referralChecker.js";
import { authorityKeypair, connection, fetchConfig, programId } from "./solana.js";

/** Minimal fixed-window rate limiter per IP (no extra dependency). */
function rateLimit(perMinute: number) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now - entry.windowStart > 60_000) {
      hits.set(ip, { count: 1, windowStart: now });
      return next();
    }
    entry.count += 1;
    if (entry.count > perMinute) return res.status(429).json({ error: "Too many requests" });
    next();
  };
}

async function main() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(cors({ origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", async (_req, res) => {
    try {
      const [slot, config] = await Promise.all([connection.getSlot(), fetchConfig()]);
      res.json({ ok: true, slot, epochId: config.epochId.toString(), paused: config.paused });
    } catch (err) {
      res.status(503).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.use("/api/config", configRouter);
  app.use("/api/reward", rateLimit(env.rateLimitPerMinute), rewardRouter);
  app.use("/api/referral", rateLimit(env.rateLimitPerMinute), referralRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[http] unhandled error:", err);
    res.status(500).json({ error: "Internal error" });
  });

  const config = await fetchConfig();
  if (!config.authority.equals(authorityKeypair.publicKey)) {
    console.warn(
      `[startup] WARNING: keypair ${authorityKeypair.publicKey.toBase58()} is not GameConfig.authority (${config.authority.toBase58()}). grant_reward will fail.`,
    );
  }

  startEpochRoller();
  startReferralChecker();
  app.listen(env.port, () => {
    console.log(`[startup] Solana Potato backend on :${env.port}`);
    console.log(`[startup] program=${programId.toBase58()} rpc=${env.rpcUrl}`);
    console.log(`[startup] authority=${authorityKeypair.publicKey.toBase58()} epoch=${config.epochId}`);
  });
}

main().catch((err) => {
  console.error("[startup] fatal:", err);
  process.exit(1);
});
