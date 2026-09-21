import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { PgStore } from '../src/store.js';
try {
  const config = loadConfig();
  const store = new PgStore(config);
  try { await store.pool.query(readFileSync(new URL('../migrations/watchtower-read-model.sql', import.meta.url), 'utf8')); }
  finally { await store.close(); }
  console.log('Watchtower schema v1 installed. No blockchain calls made.');
} catch { console.error('WATCHTOWER_MIGRATION_FAILED'); process.exitCode = 1; }
