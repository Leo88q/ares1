/**
 * Colony-specific acceptance against real PostgreSQL (the `gameops-db` CI job).
 * PGlite covers fast offline migration semantics; this catches PostgreSQL role,
 * schema and ACL behaviour which the disposable PGlite test cannot certify.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { migrate } from '../../scripts/db-migrate.js';
import { ColonyService } from '../../apps/backend/src/colonies/service.js';

const url = process.env.GAME_OPS_TEST_URL ?? '';
const writerRole = process.env.GAME_OPS_TEST_ROLE ?? 'game_ops_writer';
const skip = url ? false : 'GAME_OPS_TEST_URL не задан: Colony PostgreSQL acceptance запускается в CI с PostgreSQL';
const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

test('Colony migration and least-privilege runtime role pass on PostgreSQL', { skip }, async () => {
  const migration = await migrate({ url, verifyOnly: true, logger: silentLogger });
  assert.deepEqual(migration.applied, [], 'CI must apply migrations before this acceptance test');
  assert.deepEqual(migration.checksumMismatches, []);
  assert.ok(migration.verified >= 15, `expected at least 14 registered migrations (through 0015_presale_refund_evidence), got ${migration.verified}`);

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
      colony_ruleset_update: boolean;
      colony_owner_update: boolean;
      schema_create: boolean;
      database_create: boolean;
      challenge_cleanup: boolean;
      field_select: boolean;
      field_insert: boolean;
      field_update: boolean;
      field_unlink_update: boolean;
      field_linked_at_update: boolean;
      field_delete: boolean;
      free_starter_claim_execute: boolean;
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
        has_column_privilege(current_user, 'game_ops.colonies', 'ruleset_version', 'UPDATE') AS colony_ruleset_update,
        has_column_privilege(current_user, 'game_ops.colonies', 'owner_wallet', 'UPDATE') AS colony_owner_update,
        has_schema_privilege(current_user, 'game_ops', 'CREATE') AS schema_create,
        has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
        has_function_privilege(current_user, 'game_ops.purge_expired_colony_challenges()', 'EXECUTE') AS challenge_cleanup,
        has_table_privilege(current_user, 'game_ops.colony_fields', 'SELECT') AS field_select,
        has_table_privilege(current_user, 'game_ops.colony_fields', 'INSERT') AS field_insert,
        has_table_privilege(current_user, 'game_ops.colony_fields', 'UPDATE') AS field_update,
        has_column_privilege(current_user, 'game_ops.colony_fields', 'unlinked_at', 'UPDATE') AS field_unlink_update,
        has_column_privilege(current_user, 'game_ops.colony_fields', 'linked_at', 'UPDATE') AS field_linked_at_update,
        has_table_privilege(current_user, 'game_ops.colony_fields', 'DELETE') AS field_delete,
        has_function_privilege(current_user, 'game_ops.claim_free_colony_starter(uuid,text,text)', 'EXECUTE') AS free_starter_claim_execute
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
      colony_ruleset_update: true,
      colony_owner_update: false,
      schema_create: false,
      database_create: false,
      challenge_cleanup: true,
      field_select: true,
      field_insert: true,
      field_update: false,
      field_unlink_update: true,
      field_linked_at_update: false,
      field_delete: false,
      free_starter_claim_execute: true,
    });

    const claimWallet = 'F'.repeat(32);
    const claimA = await runtime.query<{ claim_free_colony_starter: string }>(
      'SELECT game_ops.claim_free_colony_starter($1, $2, $3)', ['60000000-0000-4000-8000-000000000011', claimWallet, 'devnet'],
    );
    const claimB = await runtime.query<{ claim_free_colony_starter: string }>(
      'SELECT game_ops.claim_free_colony_starter($1, $2, $3)', ['60000000-0000-4000-8000-000000000012', claimWallet, 'devnet'],
    );
    assert.equal(claimB.rows[0]?.claim_free_colony_starter, claimA.rows[0]?.claim_free_colony_starter);
    const activeGrant = await runtime.query<{ source: string; sku_id: string }>(
      `SELECT source, sku_id FROM game_ops.colony_entitlements WHERE owner_wallet = $1 AND cluster = 'devnet' AND revoked_at IS NULL`, [claimWallet],
    );
    assert.deepEqual(activeGrant.rows, [{ source: 'free_onboarding', sku_id: 'STARTER_COLONY_V1' }]);

    const freeOwner = 'H'.repeat(32);
    const primaryField = 'J'.repeat(32);
    const colonyService = new ColonyService(runtime, 'devnet', true);
    const created = await colonyService.initialize({
      wallet: freeOwner,
      fieldAddress: primaryField,
      requestId: '70000000-0000-4000-8000-000000000001',
      evidence: { observedSlot: 123, commitment: 'finalized', fieldLevel: 1, fieldType: 0, durability: 10 },
    });
    assert.equal(created.sequence, 1);
    assert.deepEqual(created.linkedFields, [primaryField]);
    const restored = await colonyService.get(freeOwner);
    assert.equal(restored.colonyId, created.colonyId);
    assert.equal(restored.stateHash, created.stateHash);
    const genesisEvents = await runtime.query<{ event_type: string; count: string; entitlement_source: string | null }>(
      `SELECT event_type, count(*)::text AS count, max(payload->>'entitlementSource') AS entitlement_source
         FROM game_ops.colony_events WHERE colony_id = $1 GROUP BY event_type`, [created.colonyId],
    );
    assert.deepEqual(genesisEvents.rows, [{ event_type: 'colony_initialized', count: '1', entitlement_source: 'free_onboarding' }]);

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
    for (const required of ['colony_auth_challenges', 'colony_entitlements', 'colonies', 'colony_events', 'colony_fields']) {
      assert.ok(tables.rows.some(row => row.table_name === required), `missing PostgreSQL table ${required}`);
    }
  } finally {
    await Promise.all([runtime.end(), owner.end()]);
  }
});
