import pg from 'pg';
import { assertValidColonyState, hashColonyState } from '../apps/backend/src/colonies/engine.js';
import { canonicalJson } from '../apps/backend/src/colonies/eventHash.js';
import { rebuildColonyFromEvents } from '../apps/backend/src/colonies/service.js';
import type { StoredColonyEvent } from '../apps/backend/src/colonies/eventHash.js';

interface ColonyAuditRow {
  id: string;
  state: unknown;
  sequence: string | number;
  state_hash: string;
}
interface EventAuditRow {
  colony_id: string;
  sequence: string | number;
  request_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  previous_hash: string;
  event_hash: string;
}

async function main(): Promise<void> {
  const connectionString = process.env.GAME_OPS_DATABASE_URL;
  if (!connectionString) throw new Error('GAME_OPS_DATABASE_URL is required');
  const role = process.env.COLONY_AUDIT_DB_ROLE || 'game_ops_reader';
  if (!/^[a-z_][a-z0-9_]{2,62}$/.test(role)) throw new Error('Invalid GAME_OPS_DB_ROLE');
  const pool = new pg.Pool({ connectionString, options: `-c role=${role}`, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 60_000, application_name: 'ares1-colony-audit' });
  try {
    const colonies = await pool.query<ColonyAuditRow>('SELECT id, state, sequence, state_hash FROM game_ops.colonies ORDER BY id');
    let eventsVerified = 0;
    for (const colony of colonies.rows) {
      const events = await pool.query<EventAuditRow>(
        `SELECT colony_id, sequence, request_id, event_type, payload, previous_hash, event_hash
           FROM game_ops.colony_events WHERE colony_id = $1 ORDER BY sequence ASC`,
        [colony.id],
      );
      const normalized: StoredColonyEvent[] = events.rows.map(event => ({
        colonyId: event.colony_id,
        sequence: Number(event.sequence),
        requestId: event.request_id,
        eventType: event.event_type,
        payload: event.payload,
        previousHash: event.previous_hash,
        eventHash: event.event_hash,
      }));
      const rebuilt = rebuildColonyFromEvents(normalized);
      assertValidColonyState(colony.state);
      if (normalized.length !== Number(colony.sequence) || hashColonyState(rebuilt) !== colony.state_hash
        || hashColonyState(colony.state) !== colony.state_hash || canonicalJson(rebuilt) !== canonicalJson(colony.state)) {
        throw new Error(`Colony integrity check failed for ${colony.id}`);
      }
      eventsVerified += normalized.length;
    }
    console.log(JSON.stringify({ ok: true, colonies: colonies.rowCount, eventsVerified, role }));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`[colony-audit] ${error instanceof Error ? error.message : 'integrity failure'}`);
  process.exitCode = 1;
});
