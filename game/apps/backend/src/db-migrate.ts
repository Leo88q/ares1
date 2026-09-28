/**
 * Миграции из контейнера: `node apps/backend/dist/db-migrate.js`.
 *
 * Зачем отдельная точка входа: деплой не должен зависеть от tsx и
 * dev-зависимостей на хосте. docker-compose запускает этот файл до старта
 * бэкенда (`depends_on: service_completed_successfully`), поэтому схема
 * гарантированно применена и проверена по контрольным суммам, а сам сервис
 * стартует уже с готовой БД.
 *
 * Переменные: GAME_OPS_MIGRATIONS_DIR (по умолчанию /app/migrations/game_ops в
 * образе), MIGRATION_DATABASE_URL или GAME_OPS_DATABASE_URL, флаги через argv:
 *   node dist/db-migrate.js --verify | --dry-run | --skip-roles
 */
import { migrate, resolveMigrationsDir } from './gameops/migrate.js';

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function urlFromEnv(): string {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.GAME_OPS_DATABASE_URL;
  if (!url) {
    throw new Error('Нужен MIGRATION_DATABASE_URL или GAME_OPS_DATABASE_URL');
  }
  return url;
}

async function main(): Promise<void> {
  const dir = resolveMigrationsDir();
  console.log(`[db:migrate] каталог миграций: ${dir}`);
  const result = await migrate({
    url: urlFromEnv(),
    dir,
    dryRun: hasFlag('dry-run'),
    verifyOnly: hasFlag('verify'),
    skipRoles: hasFlag('skip-roles'),
    applicationName: 'ares1-db-migrate-container',
  });
  console.log(
    `[db:migrate] итог: применено ${result.applied.length} (${result.applied.join(', ') || '—'}), ` +
    `пропущено ${result.skipped.length} (${result.skipped.join(', ') || '—'}), в реестре ${result.verified}`,
  );
}

main().catch((error: unknown) => {
  console.error('[db:migrate] FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
