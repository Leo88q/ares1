import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: parseInt(process.env.PORT || "8080", 10),
  rpcUrl: required("RPC_URL"),
  programId: required("PROGRAM_ID"),
  /** Path to the JSON keypair of a DEDICATED low-privilege wallet (NOT the
   *  program authority!). roll_epoch принимает любого signera как payer —
   *  ключу нужны только lamports на rent/fee нового epoch-аккаунта (~0.0013 SOL
   *  в эпоху). 0.1–0.2 SOL примерно на 77–154 эпохи до учёта комиссий; мониторить баланс. */
  payerKeypairJson: required("PAYER_KEYPAIR_JSON"),
  corsOrigin: (() => {
    const v = process.env.CORS_ORIGIN;
    if (!v && process.env.NODE_ENV === "production") {
      throw new Error("Missing required env var: CORS_ORIGIN (production must not use '*')");
    }
    return v || "*"; // '*' only for local dev
  })(),
  epochRollCron: process.env.EPOCH_ROLL_CRON || "*/10 * * * *",
  /** Express "trust proxy" setting. Behind exactly one reverse proxy (the usual
   *  k8s ingress / ALB setup) keep "1". Set "false"/0 when the API is exposed
   *  directly, or the rate limiter can be bypassed via a spoofed X-Forwarded-For. */
  trustProxy: (() => {
    const v = process.env.TRUST_PROXY;
    if (v === undefined) return 1;
    if (v === "true") return true;
    if (v === "false") return false;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? v : n;
  })() as boolean | number | string,
  /** Requests per minute per IP (all routes except /live). */
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || "30", 10),
  /** Checklist item 43: exposure ceiling for the online hot wallet, in
   *  lamports. The epoch payer only needs rent + fees for a few epochs, so
   *  anything above this is unnecessary exposure of a key that lives on the
   *  server. The backend warns and alerts — it does not refuse to start,
   *  because a topped-up wallet is not an emergency (an empty one is). */
  payerMaxLamports: parseInt(process.env.PAYER_MAX_LAMPORTS || "500000000", 10),
  /** F-10: optional JSON webhook (Slack/Discord/ntfy) for critical alerts —
   *  epoch-roller failure ladder (3/9/27) and fatal startup conditions.
   *  Empty string disables external alerting (console logging stays). */
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || "",
};
