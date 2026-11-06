import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { createInitialColonyState, hashColonyState } from '../src/colonies/engine.js';
import { ColonyService, ColonyServiceError, rebuildColonyFromEvents } from '../src/colonies/service.js';
import { COLONY_GENESIS_HASH, hashColonyEvent } from '../src/colonies/eventHash.js';

interface FakeRow {
  id: string; entitlement_id: string; owner_wallet: string; field_address: string;
  ruleset_version: number; state: ReturnType<typeof createInitialColonyState>;
  sequence: number; state_hash: string; linked_fields?: string[];
}
interface FakeEvent {
  colony_id: string; sequence: number; request_id: string; event_type: string;
  payload: Record<string, unknown>; previous_hash: string; event_hash: string;
}

function fakePool(wallet: string, fieldAddress: string) {
  const entitlements = [{ id: randomUUID(), sku_id: 'STARTER_COLONY_V1', source: 'internal_qa' }];
  const colonies = new Map<string, FakeRow>();
  const events = new Map<string, FakeEvent[]>();
  const links = new Map<string, { colonyId: string; fieldAddress: string; isPrimary: boolean }>();
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SELECT set_config')) return { rows: [], rowCount: 0 } as unknown as QueryResult;
      if (sql.includes('claim_free_colony_starter')) {
        const [id] = params as [string, string, string];
        let starter = entitlements.find(item => item.sku_id === 'STARTER_COLONY_V1');
        if (!starter) {
          starter = { id, sku_id: 'STARTER_COLONY_V1', source: 'free_onboarding' };
          entitlements.push(starter);
        }
        return { rows: [{ claim_free_colony_starter: starter.id }], rowCount: 1 } as unknown as QueryResult;
      }
      if (sql.includes('SELECT id, sku_id, source FROM game_ops.colony_entitlements')) return { rows: entitlements, rowCount: entitlements.length } as unknown as QueryResult;
      if (sql.includes('SELECT sku_id FROM game_ops.colony_entitlements')) return { rows: entitlements.map(({ sku_id }) => ({ sku_id })), rowCount: entitlements.length } as unknown as QueryResult;
      if (sql.includes('FROM game_ops.colonies') && sql.includes('owner_wallet = $1')) {
        const row = colonies.get(String(params[0]));
        const copy = row ? { ...row, linked_fields: [...(row.linked_fields ?? [])], state: structuredClone(row.state) } : null;
        return { rows: copy ? [copy] : [], rowCount: copy ? 1 : 0 } as unknown as QueryResult;
      }
      if (sql.includes('INSERT INTO game_ops.colonies')) {
        const [id, entitlement_id, owner_wallet, field_address, ruleset_version, rawState, state_hash] = params as [string, string, string, string, number, string, string];
        if (colonies.has(owner_wallet)) return { rows: [], rowCount: 0 } as unknown as QueryResult;
        const row: FakeRow = { id, entitlement_id, owner_wallet, field_address, ruleset_version, state: JSON.parse(rawState), sequence: 1, state_hash, linked_fields: [] };
        colonies.set(owner_wallet, row); events.set(id, []);
        return { rows: [row], rowCount: 1 } as unknown as QueryResult;
      }
      if (sql.includes('SELECT colony_id FROM game_ops.colony_fields WHERE field_address')) {
        const field = String(params[0]);
        const link = [...links.values()].find(candidate => candidate.fieldAddress === field);
        const owner = link?.colonyId ?? [...colonies.values()].find(candidate => candidate.linked_fields?.includes(field))?.id;
        return { rows: owner ? [{ colony_id: owner }] : [], rowCount: owner ? 1 : 0 } as unknown as QueryResult;
      }
      if (sql.includes('SELECT id FROM game_ops.colony_fields')) {
        const [colonyId, fieldAddress] = params as [string, string];
        const found = [...links.entries()].find(([, link]) => link.colonyId === colonyId && link.fieldAddress === fieldAddress);
        return { rows: found ? [{ id: found[0] }] : [], rowCount: found ? 1 : 0 } as unknown as QueryResult;
      }
      if (sql.includes('INSERT INTO game_ops.colony_fields')) {
        const [linkId, colonyId, fieldAddress, isPrimary] = params as [string, string, string, boolean];
        const row = [...colonies.values()].find(candidate => candidate.id === colonyId);
        if (!row) throw new Error('missing fake colony');
        for (const candidate of links.values()) {
          if (candidate.fieldAddress === fieldAddress) {
            const error = Object.assign(new Error('duplicate field address'), { code: '23505', constraint: 'colony_fields_one_active_address_idx' });
            throw error;
          }
        }
        links.set(linkId, { colonyId, fieldAddress, isPrimary });
        row.linked_fields ??= [];
        row.linked_fields.push(fieldAddress);
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      if (sql.includes('UPDATE game_ops.colony_fields SET unlinked_at')) {
        const link = links.get(String(params[0]));
        if (!link) return { rows: [], rowCount: 0 } as unknown as QueryResult;
        const row = [...colonies.values()].find(candidate => candidate.id === link.colonyId);
        if (row) row.linked_fields = (row.linked_fields ?? []).filter(address => address !== link.fieldAddress);
        links.delete(String(params[0]));
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
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
        const [id, rawState, sequence, state_hash, ruleset_version] = params as [string, string, number, string, number];
        const row = [...colonies.values()].find(candidate => candidate.id === id);
        if (!row) return { rows: [], rowCount: 0 } as unknown as QueryResult;
        row.state = JSON.parse(rawState); row.sequence = sequence; row.state_hash = state_hash; row.ruleset_version = ruleset_version;
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      throw new Error(`Unexpected fake SQL: ${sql}`);
    },
    release() {},
  } as unknown as PoolClient;
  return {
    pool: { connect: async () => client } as unknown as Pool,
    colonies, events, links, entitlements, wallet, fieldAddress,
  };
}

const WALLET = '11111111111111111111111111111111';
const FIELD = '22222222222222222222222222222222';
const evidence = { observedSlot: 42, commitment: 'finalized' as const, fieldLevel: 1, fieldType: 0, durability: 10 };
const linkedEvidence = (fieldAddress: string) => ({
  wallet: WALLET, fieldAddress, cluster: 'devnet' as const, ...evidence,
});

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

test('free Starter grant is opt-in, idempotent per wallet, and committed with Colony initialization', async () => {
  const fake = fakePool(WALLET, FIELD);
  const noGrant = fake.entitlements.pop()!;
  const disabledService = new ColonyService(fake.pool, 'devnet');
  await assert.rejects(disabledService.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence }),
    (error: unknown) => error instanceof ColonyServiceError && error.code === 'ENTITLEMENT_REQUIRED');
  assert.equal(fake.entitlements.length, 0, 'disabled free onboarding must not create an entitlement');

  const service = new ColonyService(fake.pool, 'devnet', true);
  const first = await service.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence });
  assert.equal(first.linkedFields[0], FIELD);
  assert.equal(fake.entitlements.filter(item => item.sku_id === 'STARTER_COLONY_V1').length, 1);
  assert.equal(fake.events.get(first.colonyId)?.[0]?.event_type, 'colony_initialized');
  assert.equal(fake.events.get(first.colonyId)?.[0]?.payload.entitlementSource, 'free_onboarding');
  const replay = await service.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence });
  assert.equal(replay.colonyId, first.colonyId);
  assert.equal(fake.entitlements.filter(item => item.sku_id === 'STARTER_COLONY_V1').length, 1);
  fake.entitlements.push(noGrant);
});

test('additional verified Fields are grant-limited, globally unique, versioned and replay-safe without changing production', async () => {
  const fake = fakePool(WALLET, FIELD);
  const service = new ColonyService(fake.pool, 'devnet');
  const created = await service.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence });
  assert.deepEqual(created.linkedFields, [FIELD]);
  await assert.rejects(service.linkField({
    wallet: WALLET, fieldAddress: '33333333333333333333333333333333', requestId: randomUUID(),
    expectedSequence: created.sequence, evidence: linkedEvidence('33333333333333333333333333333333'),
  }), (error: unknown) => error instanceof ColonyServiceError && error.code === 'FIELD_SLOT_LIMIT');

  const occupiedField = '66666666666666666666666666666666';
  const otherWallet = '77777777777777777777777777777777';
  const otherId = randomUUID();
  fake.colonies.set(otherWallet, {
    id: otherId, entitlement_id: randomUUID(), owner_wallet: otherWallet,
    field_address: '88888888888888888888888888888888', ruleset_version: 3,
    state: createInitialColonyState(), sequence: 1,
    state_hash: hashColonyState(createInitialColonyState()),
    linked_fields: ['88888888888888888888888888888888', occupiedField],
  });

  fake.entitlements.push({ id: randomUUID(), sku_id: 'FRONTIER_EXPANSION_V1', source: 'internal_qa' });
  const expanded = await service.get(WALLET);
  await assert.rejects(service.linkField({
    wallet: WALLET, fieldAddress: occupiedField, requestId: randomUUID(),
    expectedSequence: expanded.sequence, evidence: linkedEvidence(occupiedField),
  }), (error: unknown) => error instanceof ColonyServiceError && error.code === 'FIELD_IN_USE');
  const secondField = '33333333333333333333333333333333';
  const linkRequest = randomUUID();
  const linked = await service.linkField({
    wallet: WALLET, fieldAddress: secondField, requestId: linkRequest,
    expectedSequence: expanded.sequence, evidence: linkedEvidence(secondField),
  });
  assert.deepEqual(linked.snapshot.linkedFields, [FIELD, secondField]);
  assert.deepEqual(linked.snapshot.state.resources, expanded.state.resources);
  assert.equal(linked.snapshot.sequence, expanded.sequence + 1);
  const replay = await service.linkField({
    wallet: WALLET, fieldAddress: secondField, requestId: linkRequest,
    expectedSequence: expanded.sequence, evidence: linkedEvidence(secondField),
  });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.snapshot.sequence, linked.snapshot.sequence);
  await assert.rejects(service.linkField({
    wallet: WALLET, fieldAddress: secondField, requestId: randomUUID(),
    expectedSequence: linked.snapshot.sequence, evidence: linkedEvidence(secondField),
  }), (error: unknown) => error instanceof ColonyServiceError && error.code === 'FIELD_ALREADY_LINKED');

  const thirdField = '44444444444444444444444444444444';
  const third = await service.linkField({
    wallet: WALLET, fieldAddress: thirdField, requestId: randomUUID(),
    expectedSequence: linked.snapshot.sequence, evidence: linkedEvidence(thirdField),
  });
  assert.equal(third.snapshot.linkedFields.length, 3);
  const fourthField = '55555555555555555555555555555555';
  await assert.rejects(service.linkField({
    wallet: WALLET, fieldAddress: fourthField, requestId: randomUUID(),
    expectedSequence: third.snapshot.sequence, evidence: linkedEvidence(fourthField),
  }), (error: unknown) => error instanceof ColonyServiceError && error.code === 'FIELD_SLOT_LIMIT');
  assert.equal(fake.events.get(created.colonyId)?.filter(event => event.event_type === 'colony_field_linked').length, 2);

  const unlinkRequest = randomUUID();
  const unlinked = await service.unlinkField({
    wallet: WALLET, fieldAddress: secondField, requestId: unlinkRequest,
    expectedSequence: third.snapshot.sequence,
  });
  assert.deepEqual(unlinked.snapshot.linkedFields, [FIELD, thirdField]);
  assert.equal(unlinked.snapshot.sequence, third.snapshot.sequence + 1);
  assert.equal(unlinked.snapshot.state.resources.metal, third.snapshot.state.resources.metal);
  assert.equal([...fake.links.values()].some(link => link.fieldAddress === secondField), false);
  const unlinkReplay = await service.unlinkField({
    wallet: WALLET, fieldAddress: secondField, requestId: unlinkRequest,
    expectedSequence: third.snapshot.sequence,
  });
  assert.equal(unlinkReplay.duplicate, true);
  await assert.rejects(service.unlinkField({
    wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(),
    expectedSequence: unlinked.snapshot.sequence,
  }), (error: unknown) => error instanceof ColonyServiceError && error.code === 'FIELD_PRIMARY_IMMUTABLE');

  const relinked = await service.linkField({
    wallet: WALLET, fieldAddress: secondField, requestId: randomUUID(),
    expectedSequence: unlinked.snapshot.sequence, evidence: linkedEvidence(secondField),
  });
  assert.deepEqual(relinked.snapshot.linkedFields, [FIELD, thirdField, secondField]);
  assert.equal(relinked.snapshot.sequence, unlinked.snapshot.sequence + 1);
});

test('legacy ruleset v3 Colony state is migrated by an append-only event before serving v4 rules', async () => {
  const fake = fakePool(WALLET, FIELD);
  const service = new ColonyService(fake.pool, 'devnet');
  const created = await service.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence });
  const row = fake.colonies.get(WALLET)!;
  const legacyState = structuredClone(row.state);
  legacyState.rulesetVersion = 3;
  delete legacyState.pendingLabUpgrade;
  row.state = legacyState;
  row.ruleset_version = 3;
  row.state_hash = hashColonyState(legacyState);
  const genesis = fake.events.get(created.colonyId)![0]!;
  genesis.payload.state = legacyState;
  genesis.event_hash = hashColonyEvent(COLONY_GENESIS_HASH, {
    colonyId: genesis.colony_id, sequence: genesis.sequence, requestId: genesis.request_id,
    eventType: genesis.event_type, payload: genesis.payload,
  });

  const upgraded = await service.get(WALLET);
  assert.equal(upgraded.rulesetVersion, 4);
  assert.equal(upgraded.state.rulesetVersion, 4);
  assert.equal(upgraded.sequence, 2);
  assert.equal(fake.events.get(created.colonyId)?.at(-1)?.event_type, 'colony_ruleset_migrated');
  assert.equal(fake.colonies.get(WALLET)?.ruleset_version, 4);
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

test('a new approved expansion entitlement is synchronized into the durable event chain on read', async () => {
  const fake = fakePool(WALLET, FIELD);
  const service = new ColonyService(fake.pool, 'devnet');
  const created = await service.initialize({ wallet: WALLET, fieldAddress: FIELD, requestId: randomUUID(), evidence });
  fake.entitlements.push({ id: randomUUID(), sku_id: 'RESEARCH_WING_V1', source: 'internal_qa' });
  const expanded = await service.get(WALLET);
  assert.equal(expanded.sequence, created.sequence + 1);
  assert.equal(expanded.state.grants.researchQueues, 2);
  assert.equal(expanded.state.capacities.science, 1_000);
  const history = fake.events.get(created.colonyId)!;
  assert.equal(history.at(-1)?.event_type, 'colony_grants_updated');
  assert.equal(history.length, expanded.sequence);
});
