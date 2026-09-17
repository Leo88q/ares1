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
   *  в эпоху). 0.1–0.2 SOL хватит на годы. AUDIT B4. */
  payerKeypairJson: required("PAYER_KEYPAIR_JSON"),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  epochRollCron: process.env.EPOCH_ROLL_CRON || "*/10 * * * *",
  /** Requests per minute per IP on /api/*. */
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || "30", 10),
};
