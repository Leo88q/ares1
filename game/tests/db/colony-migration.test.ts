import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/game_ops/', import.meta.url));
const testWallet = 'A'.repeat(32);
const testField = 'B'.repeat(32);

async function applyAllMigrations(db: PGlite): Promise<string[]> {
  const files = (await readdir(migrationsDirectory)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await db.exec(await readFile(path.join(migrationsDirectory, file), 'utf8'));
  return files;
}

test('all game_ops migrations, including Colony, pass the disposable PGlite acceptance checks', async () => {
  const db = await PGlite.create();
  try {
    const files = await applyAllMigrations(db);
    assert.equal(files.length, 10);
    assert.equal(files.at(-1), '0010_colonies.sql');

    const schema = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'game_ops' AND table_type = 'BASE TABLE'");
    const tableNames = new Set(schema.rows.map(row => row.table_name));
    const requiredTables = ['schema_version', 'reward_intents', 'reward_ledger', 'ledger_chain_head', 'admin_audit', 'chain_reconciliation', 'service_cursors', 'colony_auth_challenges', 'colony_entitlements', 'colonies', 'colony_events'];
    for (const name of requiredTables) assert.ok(tableNames.has(name), `required table ${name} must exist`);
    assert.equal(tableNames.size, 16);
    const triggers = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'game_ops' AND NOT t.tgisinternal`);
    assert.equal(triggers.rows[0]?.count, 26);

    const grants = await db.query<Record<string, boolean>>(`
      SELECT has_table_privilege('game_ops_writer', 'game_ops.colony_entitlements', 'SELECT') AS entitlement_read,
             NOT has_table_privilege('game_ops_writer', 'game_ops.colony_entitlements', 'INSERT') AS entitlement_no_insert,
             NOT has_table_privilege('game_ops_writer', 'game_ops.colony_events', 'UPDATE') AS event_no_update,
             has_column_privilege('game_ops_writer', 'game_ops.colonies', 'state', 'UPDATE') AS colony_state_update,
             NOT has_column_privilege('game_ops_writer', 'game_ops.colonies', 'owner_wallet', 'UPDATE') AS colony_owner_immutable,
             has_function_privilege('game_ops_writer', 'game_ops.purge_expired_colony_challenges()', 'EXECUTE') AS scoped_cleanup
    `);
    assert.deepEqual(grants.rows[0], {
      entitlement_read: true,
      entitlement_no_insert: true,
      event_no_update: true,
      colony_state_update: true,
      colony_owner_immutable: true,
      scoped_cleanup: true,
    });

    const entitlementId = '10000000-0000-4000-8000-000000000001';
    const colonyId = '20000000-0000-4000-8000-000000000001';
    await db.query(`INSERT INTO game_ops.colony_entitlements
      (id, owner_wallet, sku_id, cluster, source, source_reference)
      VALUES ($1, $2, 'STARTER_COLONY_V1', 'devnet', 'internal_qa', 'pglite-colony-test')`, [entitlementId, testWallet]);
    await db.query(`INSERT INTO game_ops.colonies
      (id, entitlement_id, owner_wallet, field_address, ruleset_version, state, sequence, state_hash)
      VALUES ($1, $2, $3, $4, 2, '{}', 0, $5)`, [colonyId, entitlementId, testWallet, testField, '0'.repeat(64)]);
    await db.query(`INSERT INTO game_ops.colony_events
      (colony_id, sequence, request_id, event_type, payload, previous_hash, event_hash)
      VALUES ($1, 1, $2, 'colony_created', '{}', $3, $4)`, [colonyId, '30000000-0000-4000-8000-000000000001', '0'.repeat(64), '1'.repeat(64)]);

    await assert.rejects(
      db.query(`UPDATE game_ops.colony_events SET payload = '{"altered":true}' WHERE colony_id = $1`, [colonyId]),
      /APPEND_ONLY_UPDATE|append.only|deny_mutation/i,
    );

    await db.query('SET ROLE game_ops_writer');
    await assert.rejects(
      db.query(`INSERT INTO game_ops.colony_entitlements
        (id, owner_wallet, sku_id, cluster, source) VALUES ($1, $2, 'STARTER_COLONY_V1', 'devnet', 'internal_qa')`,
      ['10000000-0000-4000-8000-000000000002', testWallet]),
      /permission denied/i,
    );
    await assert.rejects(
      db.query('UPDATE game_ops.colonies SET owner_wallet = $2 WHERE id = $1', [colonyId, 'C'.repeat(32)]),
      /permission denied/i,
    );
    await db.query(`INSERT INTO game_ops.colony_events
      (colony_id, sequence, request_id, event_type, payload, previous_hash, event_hash)
      VALUES ($1, 2, $2, 'colony_action', '{}', $3, $4)`, [colonyId, '30000000-0000-4000-8000-000000000002', '1'.repeat(64), '2'.repeat(64)]);
    await assert.rejects(
      db.query('DELETE FROM game_ops.colony_events WHERE colony_id = $1', [colonyId]),
      /permission denied/i,
    );
    await db.query('RESET ROLE');

    await db.query(`INSERT INTO game_ops.colony_auth_challenges
      (challenge_id, wallet, origin, nonce_hash, message_hash, issued_at, expires_at)
      VALUES ($1, $2, 'https://colony.example', $3, $4, now() - interval '10 minutes', now() - interval '5 minutes')`,
    ['40000000-0000-4000-8000-000000000001', testWallet, 'a'.repeat(64), 'b'.repeat(64)]);
    await db.query('SET ROLE game_ops_writer');
    await assert.rejects(db.query('DELETE FROM game_ops.colony_auth_challenges'), /permission denied/i);
    const cleanup = await db.query<{ removed: number }>('SELECT game_ops.purge_expired_colony_challenges() AS removed');
    assert.equal(cleanup.rows[0]?.removed, 1);
    await db.query('RESET ROLE');
  } finally {
    await db.close();
  }
});
