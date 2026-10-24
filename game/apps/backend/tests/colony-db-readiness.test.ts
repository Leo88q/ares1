import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkColonyDatabaseRole } from '../src/colonies/dbReadiness.js';
import type { Pool } from '../src/gameops/pool.js';

const securePrivileges = {
  current_user: 'game_ops_writer',
  challenge_read: true, challenge_insert: true, challenge_consume: true,
  challenge_wallet_immutable: true, challenge_no_delete: true,
  entitlement_read: true, entitlement_no_insert: true, entitlement_no_update: true, entitlement_no_delete: true,
  colony_read: true, colony_insert: true, colony_state_update: true,
  colony_owner_immutable: true, colony_field_immutable: true, colony_ruleset_update: true,
  event_read: true, event_insert: true, event_no_update: true, event_no_delete: true,
  field_link_read: true, field_link_insert: true, field_link_no_update: true,
  field_link_unlink_update: true, field_link_linked_at_immutable: true, field_link_no_delete: true,
  cleanup_execute: true, free_starter_claim_execute: true, no_schema_create: true,
};

function poolReturning(row: Record<string, unknown>): Pool {
  return { query: async () => ({ rows: [row] }) } as unknown as Pool;
}

test('Colony startup requires the exact least-privilege runtime role and grants', async () => {
  const result = await checkColonyDatabaseRole(poolReturning(securePrivileges));
  assert.deepEqual(result, { ready: true, role: 'game_ops_writer', failures: [] });
});

test('Colony startup refuses elevated identity or entitlement/event mutation grants', async () => {
  const elevated = await checkColonyDatabaseRole(poolReturning({
    ...securePrivileges,
    current_user: 'postgres',
    entitlement_no_insert: false,
    event_no_update: false,
  }));
  assert.equal(elevated.ready, false);
  assert.equal(elevated.role, 'postgres');
  assert.equal(elevated.failures.length, 3);
  assert.ok(elevated.failures.some(failure => failure.includes('current_user')));
  assert.ok(elevated.failures.some(failure => failure.includes('entitlement_no_insert')));
  assert.ok(elevated.failures.some(failure => failure.includes('event_no_update')));
});
