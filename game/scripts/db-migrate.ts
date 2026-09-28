/**
 * CLI миграций game_ops (локальный/операторский запуск).
 *
 * Ядро — `apps/backend/src/gameops/migrate.ts`: тот же код применяется из
 * контейнера (`node apps/backend/dist/db-migrate.js`) и в тестах, поэтому
 * «локально работает, в образе нет» здесь невозможно.
 *
 * Использование:
 *   yarn db:migrate --dry-run            # план без изменений
 *   yarn db:migrate --url=postgres://…   # применить
 *   yarn db:migrate --verify             # только сверить контрольные суммы
 *   yarn db:migrate --skip-roles         # managed-база без прав на CREATE ROLE
 */
import { migrate } from '../apps/backend/src/gameops/migrate.js';
import { isEntry, parseArgs, resolveDatabaseUrl, MIGRATIONS_DIR } from './db-common.js';

export { migrate } from '../apps/backend/src/gameops/migrate.js';
export type { MigrateOptions, MigrateResult, MigrationFile } from '../apps/backend/src/gameops/migrate.js';

async function main(): Promise<void> {
  const { flags, options } = parseArgs(process.argv.slice(2));
  const result = await migrate({
    url: resolveDatabaseUrl(options),
    dir: options.get('dir') ?? MIGRATIONS_DIR,
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

if (isEntry('db-migrate')) {
  main().catch(error => {
    console.error('[db:migrate] FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
