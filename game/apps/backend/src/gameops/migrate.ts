/**
 * Ядро раннера миграций game_ops (без CLI-обвязки).
 *
 * Вынесено в сервисный код, а не оставлено в `scripts/`, по двум причинам:
 *   1) миграции должны применяться из того же образа, что и сервис (docker-compose
 *      запускает `node apps/backend/dist/gameops/migrate-cli.js` до старта бэкенда) —
 *      иначе деплой зависит от наличия tsx/dev-зависимостей на хосте;
 *   2) тесты и `yarn db:migrate` используют ровно тот же код, что и прод.
 *
 * Гарантии: порядок (лексикографический), транзакция на файл, идемпотентность,
 * реестр версий с контрольными суммами (правка применённого файла — ошибка, а не
 * «тихое обновление»), advisory-lock от двух одновременных раннеров, след в аудите.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { GameOpsError } from './errors.js';

export interface MigrationFile {
  version: number;
  fileName: string;
  sql: string;
  checksum: string;
}

export interface MigrateLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface MigrateOptions {
  url: string;
  /** Каталог с файлами миграций; по умолчанию — найденный автоматически. */
  dir?: string;
  dryRun?: boolean;
  verifyOnly?: boolean;
  /** Managed-базы: роли создаёт облако, файл с ролями не применяется. */
  skipRoles?: boolean;
  logger?: MigrateLogger;
  applicationName?: string;
}

export interface MigrateResult {
  applied: number[];
  skipped: number[];
  verified: number;
  checksumMismatches: string[];
}

const LOCK_KEY = 'ares1:game_ops:migrations';
const ROLES_FILE = /roles/i;

export const consoleMigrateLogger: MigrateLogger = {
  info: message => console.log(message),
  warn: message => console.warn(message),
  error: message => console.error(message),
};

/**
 * Каталог миграций: явный аргумент → GAME_OPS_MIGRATIONS_DIR → поиск от текущей
 * директории (локально `game/`, в контейнере `/app`). Без `import.meta`, чтобы
 * модуль одинаково работал и в ESM-сборке бэкенда, и в CommonJS-скриптах.
 */
export function resolveMigrationsDir(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const fromEnv = process.env.GAME_OPS_MIGRATIONS_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  for (const candidate of ['migrations/game_ops', 'game/migrations/game_ops']) {
    const resolved = path.resolve(process.cwd(), candidate);
    if (existsSync(resolved)) return resolved;
  }
  return path.resolve(process.cwd(), 'migrations/game_ops');
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function loadMigrations(dir: string = resolveMigrationsDir()): MigrationFile[] {
  if (!existsSync(dir)) throw new Error(`Каталог миграций не найден: ${dir}`);
  return readdirSync(dir)
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map(fileName => {
      const sql = readFileSync(path.join(dir, fileName), 'utf8');
      return { version: Number.parseInt(fileName.slice(0, 4), 10), fileName, sql, checksum: checksumOf(sql) };
    });
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const logger = options.logger ?? consoleMigrateLogger;
  const files = loadMigrations(options.dir).filter(file => !(options.skipRoles && ROLES_FILE.test(file.fileName)));
  if (!files.length) throw new Error(`Не найдено файлов миграций в ${options.dir ?? resolveMigrationsDir()}`);

  const client = new pg.Client({
    connectionString: options.url,
    application_name: options.applicationName ?? 'ares1-db-migrate',
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  const applied: number[] = [];
  const skipped: number[] = [];
  const checksumMismatches: string[] = [];

  try {
    // Advisory-lock: реестр версий всё равно защищает от повторного применения,
    // но при выкатке в нескольких репликах лок экономит время и нервы.
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]).catch(() => undefined);

    const hasRegistry = await client
      .query<{ exists: boolean }>("SELECT to_regclass('game_ops.schema_version') IS NOT NULL AS exists")
      .then(result => result.rows[0]?.exists === true);

    const registry = new Map<number, { file_name: string; checksum: string }>();
    if (hasRegistry) {
      const rows = await client.query<{ version: string | number; file_name: string; checksum: string }>(
        'SELECT version, file_name, checksum FROM game_ops.schema_version',
      );
      for (const row of rows.rows) registry.set(Number(row.version), { file_name: row.file_name, checksum: row.checksum });
    }

    for (const file of files) {
      const known = registry.get(file.version);
      if (known) {
        if (known.checksum !== file.checksum) {
          checksumMismatches.push(`${file.fileName}: применён ${known.checksum.slice(0, 12)}…, в репозитории ${file.checksum.slice(0, 12)}…`);
          logger.error(`[db:migrate] MIGRATION_CHECKSUM_MISMATCH ${file.fileName}`);
          continue;
        }
        skipped.push(file.version);
        continue;
      }
      if (options.verifyOnly) {
        logger.warn(`[db:migrate] не применено: ${file.fileName}`);
        continue;
      }
      if (options.dryRun) {
        logger.info(`[db:migrate] DRY-RUN применили бы ${file.fileName} (${file.sql.split('\n').length} строк)`);
        applied.push(file.version);
        continue;
      }
      await applyOne(client, file, logger);
      applied.push(file.version);
      registry.set(file.version, { file_name: file.fileName, checksum: file.checksum });
    }

    if (checksumMismatches.length) {
      throw new GameOpsError('MIGRATIONS_MISSING', `Правка применённых миграций запрещена: ${checksumMismatches.join('; ')}`, undefined, 409);
    }
    return { applied, skipped, verified: registry.size, checksumMismatches };
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

async function applyOne(client: pg.Client, file: MigrationFile, logger: MigrateLogger): Promise<void> {
  const started = Date.now();
  await client.query('BEGIN');
  try {
    // Актор для триггеров аудита: миграции тоже оставляют след.
    await client.query("SELECT set_config('game_ops.actor', 'cli:db-migrate', true)");
    await client.query(file.sql);
    await client.query(
      `INSERT INTO game_ops.schema_version (version, file_name, checksum, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (version) DO NOTHING`,
      [file.version, file.fileName, checksumOf(file.sql), 'applied by scripts/db-migrate.ts'],
    );
    await client.query('COMMIT');
    logger.info(`[db:migrate] применено ${file.fileName} (${Date.now() - started} мс)`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Миграция ${file.fileName} не применена: ${message}`);
  }
}
