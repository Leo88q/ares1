// Локальный «настоящий Postgres» без Docker/apt: PGlite (WASM) + wire-протокол.
// Зависимости НЕ в package.json (item 66/79 — не расширять supply chain):
//   npm i --no-save @electric-sql/pglite@0.5.8 @electric-sql/pglite-socket@0.2.11
// См. docs/local-postgres-without-docker.md.
//
// PGlite — одиночный бэкенд, но сокет-сервер мультиплексирует соединения
// (QueryQueueManager): PG_MAX_CONNECTIONS задаёт предел (по умолчанию 8), иначе
// сервер принимает ровно одно соединение и нагрузочные прогоны невозможны.
//
// PG_APPLY_GAME_OPS=1 дополнительно применяет миграции game_ops из
// game/migrations/game_ops (в лексикографическом порядке) — это удобный способ
// поднять схему для интеграционных тестов `yarn workspace backend test`.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const maxConnections = Number(process.env.PG_MAX_CONNECTIONS ?? 8);
const port = Number(process.env.PG_PORT ?? 55432);

const db = await PGlite.create();
await db.exec('DROP SCHEMA IF EXISTS watchtower CASCADE');
await db.exec(readFileSync(new URL('../migrations/watchtower-read-model.sql', import.meta.url), 'utf8'));

if (process.env.PG_APPLY_GAME_OPS === '1') {
  const dir = new URL('../../game/migrations/game_ops/', import.meta.url);
  const files = readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
  await db.exec('DROP SCHEMA IF EXISTS game_ops CASCADE');
  for (const file of files) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    await db.exec(sql);
    // Реестр версий заполняем тем же способом, что и раннер миграций
    // (sha256 содержимого файла): иначе стенд отличается от продового — тесты и
    // `yarn db:verify` справедливо сообщали бы «миграции не применены».
    const version = Number.parseInt(file.slice(0, 4), 10);
    const checksum = createHash('sha256').update(sql).digest('hex');
    await db.query(
      `INSERT INTO game_ops.schema_version (version, file_name, checksum, note)
       VALUES ($1, $2, $3, 'applied by scripts/local-pg-pglite.mjs')`,
      [version, file, checksum],
    );
    console.log(`applied ${file} (registry v${version})`);
  }
}

const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections });
await server.start();
console.log(`pglite socket ready on 127.0.0.1:${port} (watchtower schema v1 applied, game_ops=${process.env.PG_APPLY_GAME_OPS === '1' ? 'on' : 'off'}, max_connections=${maxConnections})`);
process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
