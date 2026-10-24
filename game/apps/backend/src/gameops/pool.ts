/**
 * Пул соединений и транзакции слоя game_ops.
 *
 * Ключевые решения:
 *   - `statement_timeout` и `connectionTimeoutMillis` конечны: лучше честная 503,
 *     чем процесс, зависший на блокировке;
 *   - актор пишется в GUC `game_ops.actor` внутри транзакции (`SET LOCAL`), оттуда
 *     его берут триггеры аудита — приложение не может «забыть» указать, кто
 *     выполняет действие;
 *   - ошибки никогда не логируются сырыми (safeDbError), а наружу уходят кодами.
 */
import pg from 'pg';
import { GameOpsError, mapDbError, safeDbError } from './errors.js';
import type { GameOpsConfig } from './env.js';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(config: GameOpsConfig): Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    // Роль задаётся на старте соединения (startup-параметр `role`), а не SET ROLE
    // после подключения: иначе первый запрос в пуле успел бы уйти под логином
    // суперпользователя — ровно то, от чего мы защищаемся.
    options: config.role ? `-c role=${config.role}` : undefined,
    max: config.poolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: config.statementTimeoutMs,
    application_name: 'ares1-gameops',
  });
  // Пул не должен ронять процесс из-за фоновой ошибки соединения: readiness
  // обнаружит недоступность и отдаст 503 (fail-closed), а не «зелёный» статус.
  pool.on('error', () => { /* см. readiness: DATABASE_UNAVAILABLE */ });
  return pool;
}

/** Транзакция с актором в GUC. Всё, что меняет состояние, обязано идти через неё. */
export async function withTransaction<T>(
  pool: Pool,
  actor: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  let client: Client | undefined;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new GameOpsError('DB_UNAVAILABLE', 'Не удалось получить соединение с БД', safeDbError(error), 503);
  }
  let failed = false;
  try {
    await client.query('BEGIN');
    // set_config(..., true) = SET LOCAL: действует только внутри транзакции.
    await client.query('SELECT set_config($1, $2, true)', ['game_ops.actor', actor.slice(0, 120)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    failed = true;
    await client.query('ROLLBACK').catch(() => { /* соединение уже могло умереть */ });
    throw error instanceof GameOpsError ? error : mapDbError(error);
  } finally {
    client.release(failed);
  }
}

/** Только чтение: без транзакции, чтобы не держать блокировки. */
export async function query<T extends pg.QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  } catch (error) {
    throw mapDbError(error);
  }
}

export async function ping(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(pool: Pool): Promise<void> {
  await pool.end().catch(() => { /* закрытие не должно мешать остановке */ });
}

/** Применена ли схема и на какой версии. */
export async function schemaState(pool: Pool): Promise<{ applied: number[]; latest: number | null }> {
  const rows = await query<{ version: number }>(pool, 'SELECT version FROM game_ops.schema_version ORDER BY version');
  const applied = rows.map(row => Number(row.version));
  return { applied, latest: applied.length ? applied[applied.length - 1]! : null };
}
