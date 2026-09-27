// Локальный «настоящий Postgres» без Docker/apt: PGlite (WASM) + wire-протокол.
// Зависимости НЕ в package.json (item 66/79 — не расширять supply chain):
//   npm i --no-save @electric-sql/pglite@0.5.8 @electric-sql/pglite-socket@0.2.11
// См. docs/local-postgres-without-docker.md.
// Схема применяется здесь же (PGlite — один бэкенд, лишние соединения мешают).
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const db = await PGlite.create();
await db.exec('DROP SCHEMA IF EXISTS watchtower CASCADE');
await db.exec(readFileSync(new URL('../migrations/watchtower-read-model.sql', import.meta.url), 'utf8'));
const server = new PGLiteSocketServer({ db, port: 55432, host: '127.0.0.1' });
await server.start();
console.log('pglite socket ready on 127.0.0.1:55432 (schema v1 applied)');
process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
