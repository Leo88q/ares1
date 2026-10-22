import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { createInitialColonyState, hashColonyState } from '../src/colonies/engine.js';
import { ColonyService, ColonyServiceError, rebuildColonyFromEvents } from '../src/colonies/service.js';
import { COLONY_GENESIS_HASH } from '../src/colonies/eventHash.js';

interface FakeRow {
  id: string; entitlement_id: string; owner_wallet: string; field_address: string;
  ruleset_version: number; state: ReturnType<typeof createInitialColonyState>;
  sequence: number; state_hash: string;
}
interface FakeEvent {
  colony_id: string; sequence: number; request_id: string; event_type: string;
  payload: Record<string, unknown>; previous_hash: string; event_hash: string;
}

function fakePool(wallet: string, fieldAddress: string) {
  const entitlements = [{ id: randomUUID() }];
  const colonies = new Map<string, FakeRow>();
  const events = new Map<string, FakeEvent[]>();
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SELECT set_config')) return { rows: [], rowCount: 0 } as unknown as QueryResult;
      if (sql.includes('SELECT id FROM game_ops.colony_entitlements')) return { rows: entitlements, rowCount: entitlements.length } as unknown as QueryResult;
      if (sql.includes('FROM game_ops.colonies WHERE owner_wallet')) {
        const row = colonies.get(String(params[0]));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 } as unknown as QueryResult;
      }
      if (sql.includes('INSERT INTO game_ops.colonies')) {
        const [id, entitlement_id, owner_wallet, field_address, ruleset_version, rawState, state_hash] = params as [string, string, string, string, number, string, string];
        if (colonies.has(owner_wallet)) return { rows: [], rowCount: 0 } as unknown as QueryResult;
        const row: FakeRow = { id, entitlement_id, owner_wallet, field_address, ruleset_version, state: JSON.parse(rawState), sequence: 1, state_hash };
        colonies.set(owner_wallet, row); events.set(id, []);
        return { rows: [row], rowCount: 1 } as unknown as QueryResult;
      }
      if (sql.includes('SELECT colony_id, sequence, request_id, event_type')) {
        const list = events.get(String(params[0])) ?? [];
        return { rows: [...list], rowCount: list.length } as unknown as QueryResult;
      }
      if (sql.includes('SELECT event_hash FROM game_ops.colony_events')) {
        const list = events.get(String(params[0])) ?? [];
        const last = list.at(-1);
        return { rows: last ? [{ event_hash: last.event_hash }] : [], rowCount: last ? 1 : 0 } as unknown as QueryResult;
      }
      if (sql.includes('INSERT INTO game_ops.colony_events')) {
        let event: FakeEvent;
        if (sql.includes('VALUES ($1, 1,')) {
          const [colony_id, request_id, event_type, rawPayload, previous_hash, event_hash] = params as [string, string, string, string, string, string];
          event = { colony_id, sequence: 1, request_id, event_type, payload: JSON.parse(rawPayload), previous_hash, event_hash };
        } else {
          const [colony_id, sequence, request_id, event_type, rawPayload, previous_hash, event_hash] = params as [string, number, string, string, string, string, string];
          event = { colony_id, sequence, request_id, event_type, payload: JSON.parse(rawPayload), previous_hash, event_hash };
        }
        const list = events.get(event.colony_id) ?? [];
        list.push(event); events.set(event.colony_id, list);
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      if (sql.includes('UPDATE game_ops.colonies SET state')) {
        const [id, rawState, sequence, state_hash] = params as [string, string, number, string];
        const row = [...colonies.values()].find(candidate => candidate.id === id);
        if (!row) return { rows: [], rowCount: 0 } as unknown as QueryResult;
        row.state = JSON.parse(rawState); row.sequence = sequence; row.state_hash = state_hash;
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      throw new Error(`Unexpected fake SQL: ${sql}`);
    },
    release() {},
  } as unknown as PoolClient;
  return {
    pool: { connect: async () => client } as unknown as Pool,
    colonies, events, entitlements, wallet, fieldAddress,
  };
}

const WALLET = '11111111111111111111111111111111';
const FIELD = '22222222222222222222222222222222';
const evidence = { observedSlot: 42, commitment: 'finalized' as const, fieldLevel: 1, fieldType: 0, durability: 10 };

test('initialize requires an entitlement and atomically writes the colony genesis event', async () => {
  const fake = fakePool(WALLET, FIELD);
  const service = new ColonyService(fake.pool, 'devnet');
  const entitlement = fake.entitlements.pop()!;
  await assert.rejects(service.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence }), (error: unknown) => error instanceof ColonyServiceError && error.code === 'ENTITLEMENT_REQUIRED');
  fake.entitlements.push(entitlement);
  const result = await service.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence });
  assert.equal(result.sequence, 1);
  assert.equal(result.stateHash, hashColonyState(result.state));
  const history = fake.events.get(result.colonyId)!;
  assert.equal(history.length, 1);
  assert.equal(history[0]?.previous_hash, COLONY_GENESIS_HASH);
  const rebuilt = rebuildColonyFromEvents(history.map(event => ({ colonyId: event.colony_id, sequence: event.sequence, requestId: event.request_id, eventType: event.event_type, payload: event.payload, previousHash: event.previous_hash, eventHash: event.event_hash })));
  assert.deepEqual(rebuilt, result.state);
  assert.equal((await service.get(WALLET)).colonyId, result.colonyId);
});

test('actions are versioned, replay-safe, and conflicting request-id reuse is refused', async () => {
  const fake = fakePool(WALLET, FIELD);
  const service = new ColonyService(fake.pool, 'devnet');
  await service.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence });
  const requestId = randomUUID();
  const first = await service.act({ wallet: WALLET, fieldAddress: FIELD, requestId, expectedSequence: 1, action: { type: 'start_build', building: 'solar_array' } });
  assert.equal(first.snapshot.sequence, 2);
  assert.equal(first.snapshot.state.resources.metal, 400);
  const duplicate = await service.act({ wallet: WALLET, fieldAddress: FIELD, requestId, expectedSequence: 1, action: { type: 'start_build', building: 'solar_array', cost: 0 } as never });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.snapshot.state.resources.metal, 400);
  await assert.rejects(service.act({ wallet: WALLET, fieldAddress: FIELD, requestId, expectedSequence: 1, action: { type: 'start_research', research: 'resource_efficiency' } }), (error: unknown) => error instanceof ColonyServiceError && error.code === 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(service.act({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), expectedSequence: 1, action: { type: 'start_research', research: 'resource_efficiency' } }), (error: unknown) => error instanceof ColonyServiceError && error.code === 'VERSION_CONFLICT');
  const final = await service.get(WALLET);
  assert.equal(final.sequence, 2);
  assert.equal(fake.events.get(final.colonyId)?.length, 2);
});

test('event-chain or state tampering fails closed before returning persisted state', async () => {
  const fake = fakePool(WALLET, FIELD);
  const service = new ColonyService(fake.pool, 'devnet');
  const created = await service.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence });
  fake.events.get(created.colonyId)![0]!.payload.fieldAddress = 'tampered';
  await assert.rejects(service.get(WALLET), (error: unknown) => error instanceof ColonyServiceError && error.code === 'INTEGRITY_FAILURE');
});
