import "dotenv/config";
import type { SolanaCluster } from './cluster.js';
export type { SolanaCluster } from './cluster.js';
export { DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH, expectedGenesisHash } from './cluster.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function configuredCluster(): SolanaCluster {
  const raw = process.env.SOLANA_CLUSTER;
  if (!raw && process.env.NODE_ENV !== 'production') return 'devnet';
  if (raw === 'devnet' || raw === 'mainnet-beta') return raw;
  throw new Error('SOLANA_CLUSTER обязателен и должен быть devnet или mainnet-beta');
}

function configuredBoolean(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new Error(`${name} должен быть true или false`);
}

export const env = {
  port: parseInt(process.env.PORT || "8080", 10),
  cluster: configuredCluster(),
  mainnetPresaleApproved: configuredBoolean('PRESALE_MAINNET_LIVE_APPROVED'),
  devnetPresaleTestEnabled: configuredBoolean('PRESALE_DEVNET_TEST_ENABLED'),
  coloniesEnabled: configuredBoolean('COLONIES_ENABLED'),
  // Колонийные траты POTATO (вариант B): выключено по умолчанию; mainnet блокируется в index.ts.
  colonyPotatoSpendEnabled: configuredBoolean('COLONY_POTATO_SPEND_ENABLED'),
  // Серверная симуляция колонии (docs/COLONY_SERVER_SIM_PLAN.md). Выключена по умолчанию.
  colonySimEnabled: configuredBoolean('COLONY_SIM_ENABLED'),
  colonyFreeStarterEnabled: process.env.COLONY_FREE_STARTER_ENABLED === undefined
    ? configuredCluster() === 'devnet' && process.env.NODE_ENV !== 'production'
    : configuredBoolean('COLONY_FREE_STARTER_ENABLED'),
  colonySessionSecret: process.env.COLONY_SESSION_SECRET || '',
  rpcUrl: required("RPC_URL"),
  programId: required("PROGRAM_ID"),
  /** Keypair of a DEDICATED low-privilege wallet (NOT the program authority!).
   *  roll_epoch принимает любого signera как payer — ключу нужны только
   *  lamports на rent/fee нового epoch-аккаунта (~0.0013 SOL в эпоху).
   *  0.1–0.2 SOL примерно на 77–154 эпохи до учёта комиссий; мониторить баланс.
   *  Допустимые формы: путь к JSON-файлу (формат solana-keygen) либо inline-JSON
   *  того же массива — для платформ без файловых секретов (см. payerKey.ts). */
  payerKeypairJson: required("PAYER_KEYPAIR_JSON"),
  corsOrigin: (() => {
    const v = process.env.CORS_ORIGIN;
    if (!v && process.env.NODE_ENV === "production") {
      throw new Error("Missing required env var: CORS_ORIGIN (production must not use '*')");
    }
    return v || "*"; // '*' only for local dev
  })(),
  epochRollCron: process.env.EPOCH_ROLL_CRON || "*/10 * * * *",

  /** Такт авто-доставки reward_intents, в секундах. 0 = выключено (до
   *  включения рельсы наград): никакого таймера и никаких тлеющих RPC-вызовов. */
  rewardDeliveryIntervalSeconds: parseInt(process.env.REWARD_DELIVERY_INTERVAL_SECONDS || "0", 10),

  /**
   * Такт крона квест-бюджета (доливка пула ачивок), в секундах.
   *
   * Раньше здесь стоял `|| "0"`: при включённой рельсе пул ачивок (550 POTATO,
   * заправлен один раз при init) молча вычерпывался навсегда, и после
   * нескольких десятков игроков `claim_achievement` падал с `QuestPoolEmpty`.
   * Теперь умолчание — 15 минут: крон сам работает только при живой рельсе, а
   * доливка ограничена low-water и суточным капом, так что «включён по
   * умолчанию» не превращает его в насос. Явный `0` по-прежнему выключает
   * (и это видно в логе старта).
   */
  questBudgetIntervalSeconds: parseInt(process.env.QUEST_BUDGET_INTERVAL_SECONDS || "900", 10),
  /**
   * Секрет подписи приглашений на стартовый набор.
   *
   * Пустое значение — приглашения не настроены, и `/api/rewards/starter`
   * отвечает 503: открытая выдача 250 POTATO любому адресу была Sybil-краном.
   */
  rewardInviteSecret: process.env.REWARD_INVITE_SECRET || '',
  /** Express "trust proxy" setting.
   *
   *  Раньше по умолчанию возвращалось 1 — и прямой доступ к API позволял
   *  подставить `X-Forwarded-For` и обойти per-IP лимит (Express читает
   *  левый адрес из заголовка, если доверяет прокси). Теперь умолчание —
   *  «не доверять никому», а в production значение обязательно и задаётся
   *  явно: молчание здесь означает либо обход лимита, либо (если прокси есть,
   *  а доверия нет) один общий IP у всех клиентов и мгновенный 429 для всех.
   *  Обе ошибки тихие, поэтому выбор должен быть осознанным.
   *
   *  Значения: "false" — прямой доступ; число N — доверять N хопам
   *  (обычно 1 за одним ingress/ALB); "true" — доверять любому (не для прода). */
  trustProxy: (() => {
    const raw = process.env.TRUST_PROXY;
    const v = raw?.trim();
    if (v === undefined || v === "") {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "Missing required env var: TRUST_PROXY (set \"1\" behind one reverse proxy, \"false\" when the API is exposed directly)",
        );
      }
      return false;
    }
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
  /** Checklist item 103 (audit 2026-09-28): an INDEPENDENT second RPC provider
   *  used to cross-check every fact the signing bot acts on (config/epoch).
   *  Must be a different provider than RPC_URL — same-vendor backup endpoints
   *  do not count as independence (one poisoned vendor would poison both). */
  secondaryRpcUrl: process.env.RPC_URL_SECONDARY || "",
  /**
   * Эндпоинт, который ОБСЛУЖИВАЕТ `getProgramAccounts` (некоторые mainnet-
   * провайдеры его закрывают: 403/410). Нужен только проверке дейлика
   * («у кошелька есть активное поле»): без неё рельса отвечает 503
   * ACTIVITY_CHECK_UNAVAILABLE и дейлик не выдаётся вовсе. Пусто — резервного
   * источника нет, поведение прежнее (fail-closed, причина видна в логе).
   *
   * Это НЕ второй источник правды для подписей: ключи/конфиг сверяются только
   * через `RPC_URL` / `RPC_URL_SECONDARY`.
   */
  rewardsActivityRpcUrl: process.env.REWARDS_ACTIVITY_RPC_URL || "",
  /** Fail closed by default when NODE_ENV=production: the epoch roller refuses
   *  to sign without a verified second data source. Set REQUIRE_SECONDARY_RPC=0
   *  to consciously downgrade (documented decision, never silence). */
  requireSecondaryRpc: (() => {
    if (process.env.REQUIRE_SECONDARY_RPC === "1") return true;
    if (process.env.REQUIRE_SECONDARY_RPC === "0") return false;
    return process.env.NODE_ENV === "production";
  })(),
};
