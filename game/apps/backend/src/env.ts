import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function bigintEnv(name: string, fallback: string): bigint {
  return BigInt(process.env[name] || fallback);
}

export const env = {
  port: parseInt(process.env.PORT || "8080", 10),
  rpcUrl: required("RPC_URL"),
  programId: required("PROGRAM_ID"),
  /** Path to the JSON keypair of `GameConfig.authority`. Never ship it to a client. */
  authorityKeypairJson: required("AUTHORITY_KEYPAIR_JSON"),
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  /** Optional: @channel or -100… id. When set, `social_channel` is verified via getChatMember. */
  telegramChannelId: process.env.TELEGRAM_CHANNEL_ID || "",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  /** Per Telegram user, per UTC day. Default 500 🥔 (covers starter pack + daily quests). */
  dailyUserRewardCapMicro: bigintEnv("DAILY_USER_REWARD_CAP_MICRO", "500000000"),
  /** Hard ceiling for one claim. Default 200 🥔; the program itself caps at 1000. */
  maxSingleRewardMicro: bigintEnv("MAX_SINGLE_REWARD_MICRO", "200000000"),
  epochRollCron: process.env.EPOCH_ROLL_CRON || "*/10 * * * *",
  /** Requests per minute per IP on /api/reward/*. */
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || "30", 10),
  dataDir: process.env.DATA_DIR || "data",
};
