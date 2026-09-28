/**
 * Конфигурация слоя game_ops.
 *
 * Слой **опционален**: без `GAME_OPS_DATABASE_URL` бэкенд работает как раньше
 * (read-only API + крон эпохи), а эндпоинты наград отвечают 503 NOT_CONFIGURED.
 * Это осознанный fail-closed: пока схема и роли не развёрнуты, выдача наград
 * недоступна, а не «работает наполовину».
 *
 * Секретами считаются: строка подключения и `ADMIN_API_TOKEN` (≥32 символов).
 * Токен короче 32 символов отвергается на старте — короткий секрет равносилен
 * его отсутствию (перебор тривиален), а тихая деградация недопустима.
 */
export interface GameOpsConfig {
  databaseUrl: string;
  /**
   * Роль, под которой работает приложение (GAME_OPS_DB_ROLE). Деплой создаёт
   * логин-члена `game_ops_writer`; этот параметр позволяет подключиться
   * суперпользователем (миграции) и явно понизить права до рантайм-роли, не
   * заводя второй логин. Проверка прав — `yarn db:verify`.
   */
  role: string | null;
  poolMax: number;
  statementTimeoutMs: number;
  adminToken: string;
  reconciliationMaxAgeMinutes: number;
  chainId: string;
  /** Версия схемы, которую ожидает этот код (совпадает с числом миграций). */
  expectedSchemaVersion: number;
}

const MIN_TOKEN_LENGTH = 32;

function intFromEnv(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} должен быть целым в диапазоне ${min}..${max}`);
  }
  return value;
}

export function loadGameOpsConfig(env: NodeJS.ProcessEnv = process.env): GameOpsConfig | null {
  const databaseUrl = env.GAME_OPS_DATABASE_URL;
  if (!databaseUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('GAME_OPS_DATABASE_URL не является корректным URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('GAME_OPS_DATABASE_URL должен начинаться с postgres:// или postgresql://');
  }

  const adminToken = env.ADMIN_API_TOKEN ?? '';
  if (adminToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(`ADMIN_API_TOKEN обязателен при включённом game_ops и должен быть не короче ${MIN_TOKEN_LENGTH} символов`);
  }

  const role = env.GAME_OPS_DB_ROLE && env.GAME_OPS_DB_ROLE.trim() ? env.GAME_OPS_DB_ROLE.trim() : null;
  if (role && !/^[a-z_][a-z0-9_]{2,62}$/.test(role)) {
    throw new Error('GAME_OPS_DB_ROLE должен быть именем роли (a-z, 0-9, _)');
  }

  return {
    databaseUrl,
    role,
    poolMax: intFromEnv(env.GAME_OPS_POOL_MAX, 5, 1, 50, 'GAME_OPS_POOL_MAX'),
    statementTimeoutMs: intFromEnv(env.GAME_OPS_STATEMENT_TIMEOUT_MS, 15_000, 1_000, 120_000, 'GAME_OPS_STATEMENT_TIMEOUT_MS'),
    adminToken,
    reconciliationMaxAgeMinutes: intFromEnv(env.GAME_OPS_RECONCILIATION_MAX_AGE_MINUTES, 20, 1, 1_440, 'GAME_OPS_RECONCILIATION_MAX_AGE_MINUTES'),
    chainId: env.GAME_OPS_CHAIN_ID && /^[a-z0-9_]{3,32}$/.test(env.GAME_OPS_CHAIN_ID) ? env.GAME_OPS_CHAIN_ID : 'reward',
    expectedSchemaVersion: intFromEnv(env.GAME_OPS_EXPECTED_SCHEMA_VERSION, 3, 1, 1_000, 'GAME_OPS_EXPECTED_SCHEMA_VERSION'),
  };
}
