/**
 * Раннер миграций game_ops.
 *
 * Что он гарантирует (именно это делает слой «продуктовым», а не «набором .sql»):
 *   1) порядок: файлы применяются лексикографически, каждый — в своей транзакции;
 *   2) идемпотентность: повторный запуск ничего не делает (версии уже в реестре);
 *   3) неизменность: если применённый файл изменился, запуск падает с
 *      MIGRATION_CHECKSUM_MISMATCH — «правка прошлого» невозможна незаметно;
 *   4) сериализация: advisory-lock не даёт двум раннерам применять одновременно
 *      (реальный сценарий: выкатка в двух репликах);
 *   5) след: каждое применение пишется в game_ops.admin_audit с актором.
 *
 * Использование:
 *   yarn db:migrate --dry-run            # план без изменений
 *   yarn db:migrate --url=postgres://…   # применить
 *   yarn db:migrate --verify             # только сверить контрольные суммы
 *   yarn db:migrate --skip-roles         # managed-база без прав на CREATE ROLE
 */
import type { Client } from 'pg';
import { GameOpsError } from '../apps/backend/src/gameops/errors.js';
import {
  checksumOf,
  createClient,
  consoleLogger,
  isEntry,
  loadMigrations,
  parseArgs,
  resolveDatabaseUrl,
  type Logger,
  type MigrationFile,
} from './db-common.js';

const LOCK_KEY = 'ares1:game_ops:migrations';
const ROLES_FILE = /roles/i;

export interface MigrateOptions {
  url: string;
  dryRun?: boolean;
  verifyOnly?: boolean;
  skipRoles?: boolean;
  dir?: string;
  logger?: Logger;
}

export interface MigrateResult {
  applied: number[];
  skipped: number[];
  verified: number;
  checksumMismatches: string[];
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const logger = options.logger ?? consoleLogger;
  const files = loadMigrations(options.dir).filter(file => !(options.skipRoles && ROLES_FILE.test(file.fileName)));
  if (!files.length) throw new Error('Не найдено файлов миграций');

  const client = createClient(options.url, 'ares1-db-migrate');
  await client.connect();
  const applied: number[] = [];
  const skipped: number[] = [];
  const checksumMismatches: string[] = [];

  try {
    // Advisory-lock: если лок недоступен (некоторые managed-конфигурации),
    // едем дальше — реестр версий всё равно защищает от повторного применения.
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
          checksumMismatches.push(`${file.fileName}: применён Checksum ${known.checksum.slice(0, 12)}…, в репозитории ${file.checksum.slice(0, 12)}…`);
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

async function applyOne(client: Client, file: MigrationFile, logger: Logger): Promise<void> {
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

async function main(): Promise<void> {
  const { flags, options } = parseArgs(process.argv.slice(2));
  const result = await migrate({
    url: resolveDatabaseUrl(options),
    dryRun: flags.has('dry-run'),
    verifyOnly: flags.has('verify'),
    skipRoles: flags.has('skip-roles'),
  });
  console.log(
    `[db:migrate] итог: применено ${result.applied.length} (${result.applied.join(', ') || '—'}), ` +
    `пропущено ${result.skipped.length} (${result.skipped.join(', ') || '—'}), в реестре ${result.verified}`,
  );
  process.exit(0);
}

// Скрипт запускается напрямую (tsx), но функции экспортируются для тестов.
if (isEntry('db-migrate')) {
  main().catch(error => {
    console.error('[db:migrate] FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
