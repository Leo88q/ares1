/**
 * Colony-specific acceptance against real PostgreSQL (the `gameops-db` CI job).
 * PGlite covers fast offline migration semantics; this catches PostgreSQL role,
 * schema and ACL behaviour which the disposable PGlite test cannot certify.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { migrate } from '../../scripts/db-migrate.js';

const url = process.env.GAME_OPS_TEST_URL ?? '';
const writerRole = process.env.GAME_OPS_TEST_ROLE ?? 'game_ops_writer';
const skip = url ? false : 'GAME_OPS_TEST_URL не задан: Colony PostgreSQL acceptance запускается в CI с PostgreSQL';
const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

test('Colony migration and least-privilege runtime role pass on PostgreSQL', { skip }, async () => {
  const migration = await migrate({ url, verifyOnly: true, logger: silentLogger });
  assert.deepEqual(migration.applied, [], 'CI must apply migrations before this acceptance test');
  assert.deepEqual(migration.checksumMismatches, []);
  assert.ok(migration.verified >= 10, `expected Colony migration 0010 in registry, got ${migration.verified}`);

  const owner = new pg.Pool({ connectionString: url, max: 1, application_name: 'ares1-colony-pg-acceptance-owner' });
  const runtime = new pg.Pool({
    connectionString: url,
    max: 1,
    options: `-c role=${writerRole}`,
    application_name: 'ares1-colony-pg-acceptance-runtime',
  });
  try {
    const actual = await runtime.query<{
      current_user: string;
      entitlement_select: boolean;
      entitlement_insert: boolean;
      entitlement_update: boolean;
      entitlement_delete: boolean;
      event_insert: boolean;
      event_update: boolean;
      event_delete: boolean;
      colony_state_update: boolean;
      colony_owner_update: boolean;
      schema_create: boolean;
      database_create: boolean;
      challenge_cleanup: boolean;
    }>(`
      SELECT current_user,
        has_table_privilege(current_user, 'game_ops.colony_entitlements', 'SELECT') AS entitlement_select,
        has_table_privilege(current_user, 'game_ops.colony_entitlements', 'INSERT') AS entitlement_insert,
        has_table_privilege(current_user, 'game_ops.colony_entitlements', 'UPDATE') AS entitlement_update,
        has_table_privilege(current_user, 'game_ops.colony_entitlements', 'DELETE') AS entitlement_delete,
        has_table_privilege(current_user, 'game_ops.colony_events', 'INSERT') AS event_insert,
        has_table_privilege(current_user, 'game_ops.colony_events', 'UPDATE') AS event_update,
        has_table_privilege(current_user, 'game_ops.colony_events', 'DELETE') AS event_delete,
        has_column_privilege(current_user, 'game_ops.colonies', 'state', 'UPDATE') AS colony_state_update,
        has_column_privilege(current_user, 'game_ops.colonies', 'owner_wallet', 'UPDATE') AS colony_owner_update,
        has_schema_privilege(current_user, 'game_ops', 'CREATE') AS schema_create,
        has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
        has_function_privilege(current_user, 'game_ops.purge_expired_colony_challenges()', 'EXECUTE') AS challenge_cleanup
    `);
    assert.deepEqual(actual.rows[0], {
      current_user: writerRole,
      entitlement_select: true,
      entitlement_insert: false,
      entitlement_update: false,
      entitlement_delete: false,
      event_insert: true,
      event_update: false,
      event_delete: false,
      colony_state_update: true,
      colony_owner_update: false,
      schema_create: false,
      database_create: false,
      challenge_cleanup: true,
    });

    await assert.rejects(
      runtime.query(`INSERT INTO game_ops.colony_entitlements
        (owner_wallet, sku_id, cluster, source)
        VALUES ('11111111111111111111111111111111', 'STARTER_COLONY_V1', 'devnet', 'internal_qa')`),
      /permission denied/i,
      'runtime role must not issue product entitlements',
    );
    await assert.rejects(
      runtime.query('CREATE TABLE game_ops.colony_acceptance_must_not_create (id integer)'),
      /permission denied/i,
      'runtime role must not alter the production schema',
    );
    await runtime.query('SELECT game_ops.purge_expired_colony_challenges()');

    const tables = await owner.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'game_ops' AND table_type = 'BASE TABLE'
    `);
    for (const required of ['colony_auth_challenges', 'colony_entitlements', 'colonies', 'colony_events']) {
      assert.ok(tables.rows.some(row => row.table_name === required), `missing PostgreSQL table ${required}`);
    }
  } finally {
    await Promise.all([runtime.end(), owner.end()]);
  }
});
