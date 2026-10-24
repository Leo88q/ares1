import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/game_ops/', import.meta.url));
const testWallet = 'A'.repeat(32);
const testField = 'B'.repeat(32);

async function migrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDirectory)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
}

async function applyAllMigrations(db: PGlite): Promise<string[]> {
  const files = await migrationFiles();
  for (const file of files) await db.exec(await readFile(path.join(migrationsDirectory, file), 'utf8'));
  return files;
}

test('all game_ops migrations, including Colony, pass the disposable PGlite acceptance checks', async () => {
  const db = await PGlite.create();
  try {
    const files = await applyAllMigrations(db);
    assert.equal(files.length, 13);
    assert.equal(files.at(-1), '0013_colony_free_starter_claim.sql');

    const schema = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'game_ops' AND table_type = 'BASE TABLE'");
    const tableNames = new Set(schema.rows.map(row => row.table_name));
    const requiredTables = ['schema_version', 'reward_intents', 'reward_ledger', 'ledger_chain_head', 'admin_audit', 'chain_reconciliation', 'service_cursors', 'colony_auth_challenges', 'colony_entitlements', 'colonies', 'colony_events', 'colony_fields'];
    for (const name of requiredTables) assert.ok(tableNames.has(name), `required table ${name} must exist`);
    assert.equal(tableNames.size, 17);
    const entitlementIndex = await db.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE schemaname = 'game_ops' AND indexname = 'colony_entitlements_one_active_sku_idx'");
    assert.match(entitlementIndex.rows[0]?.indexdef ?? '', /UNIQUE/i);
    assert.match(entitlementIndex.rows[0]?.indexdef ?? '', /WHERE \(revoked_at IS NULL\)/i);
    const primaryFieldIndex = await db.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE schemaname = 'game_ops' AND indexname = 'colony_fields_one_primary_idx'");
    assert.match(primaryFieldIndex.rows[0]?.indexdef ?? '', /UNIQUE/i);
    assert.match(primaryFieldIndex.rows[0]?.indexdef ?? '', /WHERE.*is_primary.*unlinked_at IS NULL/i);
    const activeFieldIndex = await db.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE schemaname = 'game_ops' AND indexname = 'colony_fields_one_active_address_idx'");
    assert.match(activeFieldIndex.rows[0]?.indexdef ?? '', /UNIQUE/i);
    assert.match(activeFieldIndex.rows[0]?.indexdef ?? '', /WHERE \(unlinked_at IS NULL\)/i);
    const triggers = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'game_ops' AND NOT t.tgisinternal`);
    assert.equal(triggers.rows[0]?.count, 28);

    const freeStarterFunction = await db.query<{ function_name: string | null }>("SELECT to_regprocedure('game_ops.claim_free_colony_starter(uuid,text,text)')::text AS function_name");
    assert.match(freeStarterFunction.rows[0]?.function_name ?? '', /game_ops\.claim_free_colony_starter\(uuid, ?text, ?text\)/);

    const grants = await db.query<Record<string, boolean>>(`
      SELECT has_table_privilege('game_ops_writer', 'game_ops.colony_entitlements', 'SELECT') AS entitlement_read,
             NOT has_table_privilege('game_ops_writer', 'game_ops.colony_entitlements', 'INSERT') AS entitlement_no_insert,
             NOT has_table_privilege('game_ops_writer', 'game_ops.colony_events', 'UPDATE') AS event_no_update,
             has_column_privilege('game_ops_writer', 'game_ops.colonies', 'state', 'UPDATE') AS colony_state_update,
             has_column_privilege('game_ops_writer', 'game_ops.colonies', 'ruleset_version', 'UPDATE') AS colony_ruleset_update,
             NOT has_column_privilege('game_ops_writer', 'game_ops.colonies', 'owner_wallet', 'UPDATE') AS colony_owner_immutable,
             has_function_privilege('game_ops_writer', 'game_ops.purge_expired_colony_challenges()', 'EXECUTE') AS scoped_cleanup,
             has_table_privilege('game_ops_writer', 'game_ops.colony_fields', 'SELECT, INSERT') AS field_link_write,
             has_column_privilege('game_ops_writer', 'game_ops.colony_fields', 'unlinked_at', 'UPDATE') AS field_unlink_update,
             NOT has_column_privilege('game_ops_writer', 'game_ops.colony_fields', 'linked_at', 'UPDATE') AS field_link_immutable,
             has_function_privilege('game_ops_writer', 'game_ops.claim_free_colony_starter(uuid,text,text)', 'EXECUTE') AS free_starter_claim
    `);
    assert.deepEqual(grants.rows[0], {
      entitlement_read: true,
      entitlement_no_insert: true,
      event_no_update: true,
      colony_state_update: true,
      colony_ruleset_update: true,
      colony_owner_immutable: true,
      scoped_cleanup: true,
      field_link_write: true,
      field_unlink_update: true,
      field_link_immutable: true,
      free_starter_claim: true,
    });

    const entitlementId = '10000000-0000-4000-8000-000000000001';
    const colonyId = '20000000-0000-4000-8000-000000000001';
    await db.query(`INSERT INTO game_ops.colony_entitlements
      (id, owner_wallet, sku_id, cluster, source, source_reference)
      VALUES ($1, $2, 'STARTER_COLONY_V1', 'devnet', 'internal_qa', 'pglite-colony-test')`, [entitlementId, testWallet]);
    await assert.rejects(
      db.query(`INSERT INTO game_ops.colony_entitlements
        (id, owner_wallet, sku_id, cluster, source, source_reference)
        VALUES ('10000000-0000-4000-8000-000000000099', $1, 'STARTER_COLONY_V1', 'devnet', 'internal_qa', 'pglite-colony-duplicate')`, [testWallet]),
      /unique|duplicate key/i,
      'a wallet cannot hold two active copies of the same SKU',
    );
    await db.query(`INSERT INTO game_ops.colonies
      (id, entitlement_id, owner_wallet, field_address, ruleset_version, state, sequence, state_hash)
      VALUES ($1, $2, $3, $4, 3, '{}', 0, $5)`, [colonyId, entitlementId, testWallet, testField, '0'.repeat(64)]);
    const primaryLinkId = '50000000-0000-4000-8000-000000000001';
    const secondaryLinkId = '50000000-0000-4000-8000-000000000002';
    const secondaryField = 'C'.repeat(32);
    await db.query(`INSERT INTO game_ops.colony_fields (id, colony_id, field_address, is_primary) VALUES ($1, $2, $3, true)`, [primaryLinkId, colonyId, testField]);
    await db.query(`INSERT INTO game_ops.colony_fields (id, colony_id, field_address, is_primary) VALUES ($1, $2, $3, false)`, [secondaryLinkId, colonyId, secondaryField]);
    await assert.rejects(
      db.query(`INSERT INTO game_ops.colony_fields (id, colony_id, field_address, is_primary) VALUES ($1, $2, $3, true)`, ['50000000-0000-4000-8000-000000000005', colonyId, 'D'.repeat(32)]),
      /duplicate key|unique/i,
      'a Colony may have at most one primary Field',
    );
    const otherEntitlementId = '10000000-0000-4000-8000-000000000002';
    const otherColonyId = '20000000-0000-4000-8000-000000000002';
    await db.query(`INSERT INTO game_ops.colony_entitlements
      (id, owner_wallet, sku_id, cluster, source, source_reference)
      VALUES ($1, $2, 'STARTER_COLONY_V1', 'devnet', 'internal_qa', 'pglite-colony-other')`, [otherEntitlementId, 'C'.repeat(32)]);
    await db.query(`INSERT INTO game_ops.colonies
      (id, entitlement_id, owner_wallet, field_address, ruleset_version, state, sequence, state_hash)
      VALUES ($1, $2, $3, $4, 3, '{}', 0, $5)`, [otherColonyId, otherEntitlementId, 'C'.repeat(32), 'D'.repeat(32), '1'.repeat(64)]);
    await db.query(`INSERT INTO game_ops.colony_fields (id, colony_id, field_address, is_primary) VALUES ($1, $2, $3, true)`, ['50000000-0000-4000-8000-000000000003', otherColonyId, 'D'.repeat(32)]);
    await assert.rejects(
      db.query(`INSERT INTO game_ops.colony_fields (id, colony_id, field_address, is_primary) VALUES ($1, $2, $3, false)`, ['50000000-0000-4000-8000-000000000006', otherColonyId, testField]),
      /duplicate key|unique/i,
      'a Field address cannot be linked to two Colonies',
    );
    await db.query(`INSERT INTO game_ops.colony_events
      (colony_id, sequence, request_id, event_type, payload, previous_hash, event_hash)
      VALUES ($1, 1, $2, 'colony_created', '{}', $3, $4)`, [colonyId, '30000000-0000-4000-8000-000000000001', '0'.repeat(64), '1'.repeat(64)]);

    await assert.rejects(
      db.query('UPDATE game_ops.colony_fields SET linked_at = now() WHERE id = $1', [secondaryLinkId]),
      /COLONY_FIELD_LINK_IMMUTABLE/i,
    );
    await assert.rejects(
      db.query('DELETE FROM game_ops.colony_fields WHERE id = $1', [secondaryLinkId]),
      /APPEND_ONLY_DELETE|append.only|deny_mutation/i,
    );
    await db.query(`INSERT INTO game_ops.colony_events
      (colony_id, sequence, request_id, event_type, payload, previous_hash, event_hash)
      VALUES ($1, 2, $2, 'colony_field_unlinked', $3, $4, $5)`, [
      colonyId,
      '30000000-0000-4000-8000-000000000002',
      JSON.stringify({ linkId: secondaryLinkId, fieldAddress: secondaryField }),
      '1'.repeat(64),
      '2'.repeat(64),
    ]);
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
    const unlinked = await db.query(`UPDATE game_ops.colony_fields SET unlinked_at = now() WHERE id = $1`, [secondaryLinkId]);
    assert.equal(unlinked.rowCount, 1, 'the append-only unlink event permits exactly the unlink projection update');
    await db.query(`INSERT INTO game_ops.colony_fields (id, colony_id, field_address, is_primary)
      VALUES ($1, $2, $3, false)`, ['50000000-0000-4000-8000-000000000004', colonyId, secondaryField]);
    await db.query(`INSERT INTO game_ops.colony_events
      (colony_id, sequence, request_id, event_type, payload, previous_hash, event_hash)
      VALUES ($1, 3, $2, 'colony_action', '{}', $3, $4)`, [colonyId, '30000000-0000-4000-8000-000000000003', '2'.repeat(64), '3'.repeat(64)]);
    await assert.rejects(
      db.query('DELETE FROM game_ops.colony_events WHERE colony_id = $1', [colonyId]),
      /permission denied/i,
    );
    const freeWallet = 'E'.repeat(32);
    const firstFreeClaim = await db.query<{ claim_free_colony_starter: string }>(
      'SELECT game_ops.claim_free_colony_starter($1, $2, $3)', ['60000000-0000-4000-8000-000000000001', freeWallet, 'devnet'],
    );
    const repeatedFreeClaim = await db.query<{ claim_free_colony_starter: string }>(
      'SELECT game_ops.claim_free_colony_starter($1, $2, $3)', ['60000000-0000-4000-8000-000000000002', freeWallet, 'devnet'],
    );
    assert.equal(repeatedFreeClaim.rows[0]?.claim_free_colony_starter, firstFreeClaim.rows[0]?.claim_free_colony_starter);
    const freeGrant = await db.query<{ source: string; sku_id: string }>(
      `SELECT source, sku_id FROM game_ops.colony_entitlements WHERE owner_wallet = $1 AND cluster = 'devnet' AND revoked_at IS NULL`, [freeWallet],
    );
    assert.deepEqual(freeGrant.rows, [{ source: 'free_onboarding', sku_id: 'STARTER_COLONY_V1' }]);
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

test('0012 backfills existing primary Fields into the append-only association table', async () => {
  const db = await PGlite.create();
  try {
    const files = await migrationFiles();
    const linkMigration = files.find(file => file === '0012_colony_field_links.sql');
    assert.ok(linkMigration);
    for (const file of files.slice(0, -1)) await db.exec(await readFile(path.join(migrationsDirectory, file), 'utf8'));
    const entitlementId = '10000000-0000-4000-8000-000000000011';
    const colonyId = '20000000-0000-4000-8000-000000000011';
    await db.query(`INSERT INTO game_ops.colony_entitlements
      (id, owner_wallet, sku_id, cluster, source, source_reference)
      VALUES ($1, $2, 'STARTER_COLONY_V1', 'devnet', 'internal_qa', 'pglite-backfill-test')`, [entitlementId, testWallet]);
    await db.query(`INSERT INTO game_ops.colonies
      (id, entitlement_id, owner_wallet, field_address, ruleset_version, state, sequence, state_hash)
      VALUES ($1, $2, $3, $4, 3, '{}', 0, $5)`, [colonyId, entitlementId, testWallet, testField, '0'.repeat(64)]);

    await db.exec(await readFile(path.join(migrationsDirectory, linkMigration), 'utf8'));
    const backfilled = await db.query<{ field_address: string; is_primary: boolean }>(
      'SELECT field_address, is_primary FROM game_ops.colony_fields WHERE colony_id = $1', [colonyId],
    );
    assert.deepEqual(backfilled.rows, [{ field_address: testField, is_primary: true }]);
  } finally {
    await db.close();
  }
});
