import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../gameops/pool.js';
import { canonicalJson, COLONY_GENESIS_HASH, hashColonyEvent, verifyColonyEventChain } from './eventHash.js';
import type { StoredColonyEvent } from './eventHash.js';
import { applyColonyAction, assertValidColonyState, createInitialColonyState, hashColonyState, materializeColony } from './engine.js';
import type { ColonyAction, ColonyState } from './engine.js';
import { COLONY_RULESET_VERSION, validBuildingKind, validResearchId } from './rules.js';

export class ColonyServiceError extends Error {
  readonly preserveThroughTransaction = true;
  constructor(readonly code: 'ENTITLEMENT_REQUIRED' | 'COLONY_NOT_FOUND' | 'FIELD_MISMATCH' | 'VERSION_CONFLICT' | 'INTEGRITY_FAILURE' | 'INVALID_REQUEST' | 'IDEMPOTENCY_CONFLICT') {
    super(code);
    this.name = 'ColonyServiceError';
  }
}

interface ColonyRow {
  id: string;
  entitlement_id: string;
  owner_wallet: string;
  field_address: string;
  ruleset_version: number;
  state: ColonyState;
  sequence: string | number;
  state_hash: string;
}

interface EventRow {
  colony_id: string;
  sequence: string | number;
  request_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  previous_hash: string;
  event_hash: string;
}

/** Rebuilds the committed colony snapshot from the immutable event snapshots. */
export function rebuildColonyFromEvents(events: readonly StoredColonyEvent[]): ColonyState {
  if (!events.length || events[0]?.eventType !== 'colony_initialized' || !verifyColonyEventChain(events)) {
    throw new ColonyServiceError('INTEGRITY_FAILURE');
  }
  const state = events.at(-1)?.payload.state;
  try {
    assertValidColonyState(state);
  } catch {
    throw new ColonyServiceError('INTEGRITY_FAILURE');
  }
  return state;
}

export interface ColonySnapshot {
  colonyId: string;
  ownerWallet: string;
  fieldAddress: string;
  rulesetVersion: number;
  sequence: number;
  stateHash: string;
  state: ColonyState;
  materializedAt: string;
  pending: boolean;
}

function isRecordPayload(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSequence(value: string | number): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ColonyServiceError('INTEGRITY_FAILURE');
  return sequence;
}

async function readColony(client: PoolClient, wallet: string, forUpdate: boolean): Promise<ColonyRow | null> {
  const result = await client.query<ColonyRow>(
    `SELECT id, entitlement_id, owner_wallet, field_address, ruleset_version, state, sequence, state_hash
       FROM game_ops.colonies WHERE owner_wallet = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [wallet],
  );
  return result.rows[0] ?? null;
}

async function verifiedEvents(client: PoolClient, row: ColonyRow): Promise<EventRow[]> {
  const events = await client.query<EventRow>(
    `SELECT colony_id, sequence, request_id, event_type, payload, previous_hash, event_hash
       FROM game_ops.colony_events WHERE colony_id = $1 ORDER BY sequence ASC`,
    [row.id],
  );
  const normalized = events.rows.map(event => ({
    colonyId: event.colony_id,
    sequence: Number(event.sequence),
    requestId: event.request_id,
    eventType: event.event_type,
    payload: event.payload,
    previousHash: event.previous_hash,
    eventHash: event.event_hash,
  }));
  try {
    assertValidColonyState(row.state);
  } catch {
    throw new ColonyServiceError('INTEGRITY_FAILURE');
  }
  let rebuilt: ColonyState;
  try {
    rebuilt = rebuildColonyFromEvents(normalized);
  } catch {
    throw new ColonyServiceError('INTEGRITY_FAILURE');
  }
  if (normalized.length !== parseSequence(row.sequence) || canonicalJson(rebuilt) !== canonicalJson(row.state)
    || hashColonyState(row.state) !== row.state_hash) {
    throw new ColonyServiceError('INTEGRITY_FAILURE');
  }
  return events.rows;
}

async function appendEvent(client: PoolClient, params: {
  row: ColonyRow;
  requestId: string;
  eventType: string;
  payload: Record<string, unknown>;
  state: ColonyState;
}): Promise<ColonySnapshot> {
  const sequence = parseSequence(params.row.sequence) + 1;
  const prior = await client.query<{ event_hash: string }>(
    `SELECT event_hash FROM game_ops.colony_events WHERE colony_id = $1 ORDER BY sequence DESC LIMIT 1`,
    [params.row.id],
  );
  const previousHash = prior.rows[0]?.event_hash;
  if (!previousHash) throw new ColonyServiceError('INTEGRITY_FAILURE');
  const event = {
    colonyId: params.row.id,
    sequence,
    requestId: params.requestId,
    eventType: params.eventType,
    payload: params.payload,
  };
  const eventHash = hashColonyEvent(previousHash, event);
  const stateHash = hashColonyState(params.state);
  await client.query(
    `INSERT INTO game_ops.colony_events
       (colony_id, sequence, request_id, event_type, payload, previous_hash, event_hash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [params.row.id, sequence, params.requestId, params.eventType, JSON.stringify(params.payload), previousHash, eventHash],
  );
  await client.query(
    `UPDATE game_ops.colonies SET state = $2::jsonb, sequence = $3, state_hash = $4, updated_at = now()
      WHERE id = $1`,
    [params.row.id, JSON.stringify(params.state), sequence, stateHash],
  );
  return {
    colonyId: params.row.id,
    ownerWallet: params.row.owner_wallet,
    fieldAddress: params.row.field_address,
    rulesetVersion: params.row.ruleset_version,
    sequence,
    stateHash,
    state: params.state,
    materializedAt: params.state.lastMaterializedAt,
    pending: Boolean(params.state.pendingResearch || params.state.buildings.some(building => building.status === 'constructing')),
  };
}

function normalizeAction(value: unknown): ColonyAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ColonyServiceError('INVALID_REQUEST');
  const action = value as Record<string, unknown>;
  if (action.type === 'start_build' && validBuildingKind(action.building)) return { type: 'start_build', building: action.building };
  if (action.type === 'start_research' && validResearchId(action.research)) return { type: 'start_research', research: action.research };
  throw new ColonyServiceError('INVALID_REQUEST');
}

function assertRequestId(requestId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new ColonyServiceError('INVALID_REQUEST');
  }
}

export class ColonyService {
  constructor(private readonly pool: Pool, private readonly cluster: 'devnet' | 'mainnet-beta') {}

  async initialize(params: {
    wallet: string;
    fieldAddress: string;
    requestId: string;
    evidence: { observedSlot: number; commitment: 'finalized'; fieldLevel: number; fieldType: number; durability: number };
  }): Promise<ColonySnapshot> {
    assertRequestId(params.requestId);
    const now = new Date();
    return withTransaction(this.pool, `colony:init:${params.wallet}`, async client => {
      const existing = await readColony(client, params.wallet, true);
      if (existing) {
        if (existing.field_address !== params.fieldAddress) throw new ColonyServiceError('FIELD_MISMATCH');
        await verifiedEvents(client, existing);
        return this.snapshot(existing, now, false);
      }
      const entitlement = await client.query<{ id: string }>(
        `SELECT id FROM game_ops.colony_entitlements
          WHERE owner_wallet = $1 AND cluster = $2 AND sku_id = 'STARTER_COLONY_V1' AND revoked_at IS NULL
          ORDER BY granted_at ASC LIMIT 1`,
        [params.wallet, this.cluster],
      );
      const entitlementId = entitlement.rows[0]?.id;
      if (!entitlementId) throw new ColonyServiceError('ENTITLEMENT_REQUIRED');
      const colonyId = randomUUID();
      const state = createInitialColonyState(now);
      const stateHash = hashColonyState(state);
      const inserted = await client.query<ColonyRow>(
        `INSERT INTO game_ops.colonies
           (id, entitlement_id, owner_wallet, field_address, ruleset_version, state, sequence, state_hash)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 1, $7)
         ON CONFLICT DO NOTHING
         RETURNING id, entitlement_id, owner_wallet, field_address, ruleset_version, state, sequence, state_hash`,
        [colonyId, entitlementId, params.wallet, params.fieldAddress, COLONY_RULESET_VERSION, JSON.stringify(state), stateHash],
      );
      const row = inserted.rows[0];
      if (!row) {
        const raced = await readColony(client, params.wallet, true);
        if (!raced || raced.field_address !== params.fieldAddress) throw new ColonyServiceError('FIELD_MISMATCH');
        await verifiedEvents(client, raced);
        return this.snapshot(raced, now, false);
      }
      const event = {
        colonyId,
        sequence: 1,
        requestId: params.requestId,
        eventType: 'colony_initialized',
        payload: {
          fieldAddress: params.fieldAddress,
          entitlementId,
          cluster: this.cluster,
          observedSlot: params.evidence.observedSlot,
          commitment: params.evidence.commitment,
          fieldLevel: params.evidence.fieldLevel,
          fieldType: params.evidence.fieldType,
          durability: params.evidence.durability,
          rulesetVersion: COLONY_RULESET_VERSION,
          state,
        },
      };
      const eventHash = hashColonyEvent(COLONY_GENESIS_HASH, event);
      await client.query(
        `INSERT INTO game_ops.colony_events
           (colony_id, sequence, request_id, event_type, payload, previous_hash, event_hash)
         VALUES ($1, 1, $2, $3, $4::jsonb, $5, $6)`,
        [colonyId, params.requestId, event.eventType, JSON.stringify(event.payload), COLONY_GENESIS_HASH, eventHash],
      );
      return this.snapshot(row, now, false);
    });
  }

  async get(wallet: string): Promise<ColonySnapshot> {
    const now = new Date();
    return withTransaction(this.pool, `colony:read:${wallet}`, async client => {
      const row = await readColony(client, wallet, false);
      if (!row) throw new ColonyServiceError('COLONY_NOT_FOUND');
      await verifiedEvents(client, row);
      return this.snapshot(row, now, true);
    });
  }

  async act(params: {
    wallet: string;
    fieldAddress: string;
    requestId: string;
    expectedSequence: number;
    action: ColonyAction;
  }): Promise<{ snapshot: ColonySnapshot; duplicate: boolean; result: Record<string, unknown> | null }> {
    assertRequestId(params.requestId);
    if (!Number.isSafeInteger(params.expectedSequence) || params.expectedSequence < 1) throw new ColonyServiceError('INVALID_REQUEST');
    const action = normalizeAction(params.action);
    return withTransaction(this.pool, `colony:action:${params.wallet}`, async client => {
      const row = await readColony(client, params.wallet, true);
      if (!row) throw new ColonyServiceError('COLONY_NOT_FOUND');
      if (row.field_address !== params.fieldAddress) throw new ColonyServiceError('FIELD_MISMATCH');
      const history = await verifiedEvents(client, row);
      const prior = history.find(event => event.request_id === params.requestId);
      if (prior) {
        if (canonicalJson(prior.payload.action) !== canonicalJson(action)) throw new ColonyServiceError('IDEMPOTENCY_CONFLICT');
        return { snapshot: this.snapshot(row, new Date(), true), duplicate: true, result: isRecordPayload(prior.payload.result) ? prior.payload.result : null };
      }
      if (parseSequence(row.sequence) !== params.expectedSequence) throw new ColonyServiceError('VERSION_CONFLICT');
      const now = new Date();
      const transition = applyColonyAction(row.state, action, now);
      const snapshot = await appendEvent(client, {
        row,
        requestId: params.requestId,
        eventType: action.type,
        payload: { action, result: transition.result, state: transition.state },
        state: transition.state,
      });
      return { snapshot, duplicate: false, result: transition.result };
    });
  }

  private snapshot(row: ColonyRow, now: Date, materialize: boolean): ColonySnapshot {
    const sequence = parseSequence(row.sequence);
    const state = materialize ? materializeColony(row.state, now) : row.state;
    return {
      colonyId: row.id,
      ownerWallet: row.owner_wallet,
      fieldAddress: row.field_address,
      rulesetVersion: row.ruleset_version,
      sequence,
      stateHash: row.state_hash,
      state,
      materializedAt: now.toISOString(),
      pending: Boolean(state.pendingResearch || state.buildings.some(building => building.status === 'constructing')),
    };
  }
}
