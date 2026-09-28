/**
 * Общие утилиты DB-скриптов слоя game_ops (миграции, роли, проверки, стенд).
 *
 * Здесь нет «магии»: скрипты — обычные CLI, которые читают строку подключения из
 * аргумента или окружения, логируют в stdout и завершаются ненулевым кодом при
 * провале. Так их можно ставить в CI и в runbook без адаптеров.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { checksumOf, loadMigrations as loadMigrationsCore, type MigrationFile } from '../apps/backend/src/gameops/migrate.js';

/**
 * Каталог миграций ищется от рабочей директории (все команды запускаются из
 * корня `game/`) с явным переопределением через GAME_OPS_MIGRATIONS_DIR.
 * Так скрипты и тесты находят файлы одинаково и без `import.meta`
 * (корневой tsconfig — CommonJS).
 */
function detectMigrationsDir(): string {
  const override = process.env.GAME_OPS_MIGRATIONS_DIR;
  if (override) return path.resolve(override);
  for (const candidate of ['migrations/game_ops', 'game/migrations/game_ops']) {
    const resolved = path.resolve(process.cwd(), candidate);
    if (existsSync(resolved)) return resolved;
  }
  return path.resolve(process.cwd(), 'migrations/game_ops');
}

export const MIGRATIONS_DIR = detectMigrationsDir();


/**
 * Запущен ли файл как CLI (tsx/node), а не импортирован тестом.
 *
 * Без `import.meta` намеренно: корневой tsconfig проекта — CommonJS
 * (`module: commonjs`), и `import.meta` в нём не компилируется. Проверка по
 * argv[1] работает и под tsx, и под node, и не мешает импорту из тестов.
 */
export function isEntry(name: string): boolean {
  const arg = process.argv[1] ?? '';
  const pattern = new RegExp('(^|[\\\\/])' + name.replace(/\./g, '\\.') + '\\.(ts|tsx|js|mjs|cjs|mts|cts)$');
  return pattern.test(arg);
}

export function parseArgs(argv: readonly string[]): { flags: Set<string>; options: Map<string, string> } {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [name, value] = arg.slice(2).split('=');
    if (value === undefined) flags.add(name!);
    else options.set(name!, value);
  }
  return { flags, options };
}

export function resolveDatabaseUrl(options: Map<string, string>, env: NodeJS.ProcessEnv = process.env): string {
  const url = options.get('url') ?? env.GAME_OPS_DATABASE_URL ?? env.GAME_OPS_TEST_URL ?? env.DATABASE_URL;
  if (!url) {
    throw new Error('Укажите строку подключения: --url=postgres://… или GAME_OPS_DATABASE_URL');
  }
  return url;
}

/**
 * Контрольная сумма и загрузка миграций делегируются ядру
 * (apps/backend/src/gameops/migrate.ts), чтобы скрипты, тесты и контейнерный
 * раннер применяли одни и те же файлы одним и тем же кодом.
 */
export { checksumOf };
export type { MigrationFile };

export function loadMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return loadMigrationsCore(dir);
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Детерминированная base58-строка: схемы проверяют формат адресов (32..44) и
 * подписей (64..88), поэтому стенд и тесты обязаны генерировать валидные
 * значения, а не «примерно похожие».
 */
export function base58(seed: string | number, length: number): string {
  const key = String(seed);
  let out = '';
  let counter = 0;
  while (out.length < length) {
    const digest = createHash('sha256').update(`${key}#${counter}`).digest();
    for (const byte of digest) {
      out += BASE58[byte % BASE58.length];
      if (out.length === length) break;
    }
    counter += 1;
  }
  return out;
}

export const ataLike = (seed: string | number): string => base58(`ata:${seed}`, 44);
export const signatureLike = (seed: string | number): string => base58(`sig:${seed}`, 88);

export function createClient(url: string, applicationName: string): pg.Client {
  return new pg.Client({ connectionString: url, application_name: applicationName, connectionTimeoutMillis: 10_000 });
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  info: message => console.log(message),
  warn: message => console.warn(message),
  error: message => console.error(message),
};

/** Экранирование строкового литерала для DDL, где параметры недоступны. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
