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
  /** Path to the JSON keypair of `GameConfig.authority`. Never ship it to a client.
   *  Нужен epoch-roller-у (roll_epoch) — on-chain, без Telegram. */
  authorityKeypairJson: required("AUTHORITY_KEYPAIR_JSON"),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  epochRollCron: process.env.EPOCH_ROLL_CRON || "*/10 * * * *",
  /** Requests per minute per IP on /api/*. */
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || "30", 10),
};
