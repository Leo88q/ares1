import { loadConfig } from '../src/config.js';
import { PgStore } from '../src/store.js';
import { initialCursor } from '../src/model.js';
try {
  const config = loadConfig();
  if (process.env.WATCHTOWER_REPLAY_CONFIRM !== 'ares1') throw new Error('confirmation required');
  const store = new PgStore(config);
  try {
    await store.initialize();
    // Stop the exporter first. Preserve events/projections; rescan reconciles
    // identical transactions and rejects changed finalized fingerprints.
    await store.pool.query('UPDATE watchtower.cursors SET state=$2,version=version+1,updated_at=now() WHERE stream_id=$1',
      [store.streamId, initialCursor()]);
  } finally { await store.close(); }
  console.log('Replay scheduled in the local read-model. No events deleted; no blockchain writes.');
} catch { console.error('WATCHTOWER_REPLAY_FAILED'); process.exitCode = 1; }
