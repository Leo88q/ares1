import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../gameops/pool.js';
import { canonicalJson, COLONY_GENESIS_HASH, hashColonyEvent, verifyColonyEventChain } from './eventHash.js';
import type { StoredColonyEvent } from './eventHash.js';
import { resolveColonyGrants } from './catalog.js';
import type { FieldOwnershipEvidence } from './fieldOwnership.js';
import { applyColonyAction, assertValidColonyState, ColonyRuleError, createInitialColonyState, hashColonyState, materializeColony, syncColonyGrants } from './engine.js';
import type { ColonyAction, ColonyState } from './engine.js';
import { COLONY_RULESET_VERSION, validBuildingKind, validResearchId } from './rules.js';

export class ColonyServiceError extends Error {
  readonly preserveThroughTransaction = true;
  constructor(readonly code: 'ENTITLEMENT_REQUIRED' | 'COLONY_NOT_FOUND' | 'FIELD_MISMATCH' | 'VERSION_CONFLICT' | 'INTEGRITY_FAILURE' | 'INVALID_REQUEST' | 'IDEMPOTENCY_CONFLICT' | 'GRANT_REDUCTION_UNSUPPORTED' | 'FIELD_SLOT_LIMIT' | 'FIELD_ALREADY_LINKED' | 'FIELD_IN_USE' | 'FIELD_NOT_LINKED' | 'FIELD_PRIMARY_IMMUTABLE') {
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
  linked_fields?: string[];
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
  linkedFields: string[];
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
    `SELECT c.id, c.entitlement_id, c.owner_wallet, c.field_address, c.ruleset_version, c.state, c.sequence, c.state_hash,
            COALESCE((SELECT json_agg(f.field_address ORDER BY f.is_primary DESC, f.linked_at, f.field_address)
                        FROM game_ops.colony_fields f WHERE f.colony_id = c.id AND f.unlinked_at IS NULL), json_build_array(c.field_address)) AS linked_fields
       FROM game_ops.colonies c WHERE c.owner_wallet = $1 ${forUpdate ? 'FOR UPDATE OF c' : ''}`,
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
    || hashColonyState(row.state) !== row.state_hash || row.ruleset_version !== row.state.rulesetVersion) {
    throw new ColonyServiceError('INTEGRITY_FAILURE');
  }
  const replayedFields = new Set<string>();
  for (const event of normalized) {
    if (!['colony_initialized', 'colony_field_linked', 'colony_field_unlinked'].includes(event.eventType)) continue;
    const fieldAddress = event.payload.fieldAddress;
    if (typeof fieldAddress !== 'string') throw new ColonyServiceError('INTEGRITY_FAILURE');
    if (event.eventType === 'colony_field_unlinked') {
      if (!replayedFields.has(fieldAddress) || fieldAddress === row.field_address) throw new ColonyServiceError('INTEGRITY_FAILURE');
      replayedFields.delete(fieldAddress);
    } else {
      if (replayedFields.has(fieldAddress)) throw new ColonyServiceError('INTEGRITY_FAILURE');
      replayedFields.add(fieldAddress);
    }
  }
  const storedFields = row.linked_fields ?? [row.field_address];
  if (canonicalJson([...replayedFields].sort()) !== canonicalJson([...storedFields].sort())
    || !replayedFields.has(row.field_address)) throw new ColonyServiceError('INTEGRITY_FAILURE');
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
    `UPDATE game_ops.colonies SET state = $2::jsonb, sequence = $3, state_hash = $4, ruleset_version = $5, updated_at = now()
      WHERE id = $1`,
    [params.row.id, JSON.stringify(params.state), sequence, stateHash, params.state.rulesetVersion],
  );
  return {
    colonyId: params.row.id,
    ownerWallet: params.row.owner_wallet,
    fieldAddress: params.row.field_address,
    rulesetVersion: params.state.rulesetVersion,
    sequence,
    stateHash,
    state: params.state,
    linkedFields: params.row.linked_fields ?? [params.row.field_address],
    materializedAt: params.state.lastMaterializedAt,
    pending: Boolean(params.state.pendingResearch.length || params.state.pendingLabUpgrade || params.state.buildings.some(building => building.status === 'constructing' || building.status === 'upgrading')),
  };
}

function normalizeAction(value: unknown): ColonyAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ColonyServiceError('INVALID_REQUEST');
  const action = value as Record<string, unknown>;
  if (action.type === 'start_build' && validBuildingKind(action.building)) return { type: 'start_build', building: action.building };
  if (action.type === 'start_research' && validResearchId(action.research)) return { type: 'start_research', research: action.research };
  if (action.type === 'start_lab_upgrade') return { type: 'start_lab_upgrade' };
  throw new ColonyServiceError('INVALID_REQUEST');
}

function assertRequestId(requestId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new ColonyServiceError('INVALID_REQUEST');
  }
}

export class ColonyService {
  constructor(
    private readonly pool: Pool,
    private readonly cluster: 'devnet' | 'mainnet-beta',
    readonly freeStarterEnabled = false,
  ) {}

  private async activeGrants(client: PoolClient, wallet: string) {
    const result = await client.query<{ sku_id: string }>(
      `SELECT sku_id FROM game_ops.colony_entitlements
        WHERE owner_wallet = $1 AND cluster = $2 AND revoked_at IS NULL ORDER BY granted_at ASC`,
      [wallet, this.cluster],
    );
    try {
      return resolveColonyGrants(result.rows.map(row => row.sku_id));
    } catch (error) {
      if (error instanceof Error && error.message === 'STARTER_ENTITLEMENT_REQUIRED') throw new ColonyServiceError('ENTITLEMENT_REQUIRED');
      throw new ColonyServiceError('INTEGRITY_FAILURE');
    }
  }

  private async synchronizeGrants(client: PoolClient, row: ColonyRow): Promise<ColonyRow> {
    const grants = await this.activeGrants(client, row.owner_wallet);
    if (canonicalJson(grants) === canonicalJson(row.state.grants)) return row;
    let state: ColonyState;
    try {
      state = syncColonyGrants(row.state, grants);
    } catch (error) {
      if (error instanceof ColonyRuleError && error.code === 'GRANTS_REDUCTION_UNSUPPORTED') {
        throw new ColonyServiceError('GRANT_REDUCTION_UNSUPPORTED');
      }
      throw error;
    }
    const snapshot = await appendEvent(client, {
      row,
      requestId: randomUUID(),
      eventType: 'colony_grants_updated',
      payload: { grants, state },
      state,
    });
    return { ...row, sequence: snapshot.sequence, state, state_hash: snapshot.stateHash };
  }

  private async synchronizeRuleset(client: PoolClient, row: ColonyRow): Promise<ColonyRow> {
    if (row.state.rulesetVersion === COLONY_RULESET_VERSION) return row;
    if (row.state.rulesetVersion !== 3 || row.ruleset_version !== 3) throw new ColonyServiceError('INTEGRITY_FAILURE');
    const state = structuredClone(row.state);
    state.rulesetVersion = COLONY_RULESET_VERSION;
    state.pendingLabUpgrade ??= null;
    const snapshot = await appendEvent(client, {
      row,
      requestId: randomUUID(),
      eventType: 'colony_ruleset_migrated',
      payload: { from: row.ruleset_version, to: COLONY_RULESET_VERSION, state },
      state,
    });
    return { ...row, ruleset_version: COLONY_RULESET_VERSION, sequence: snapshot.sequence, state, state_hash: snapshot.stateHash };
  }

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
        const currentRules = await this.synchronizeRuleset(client, existing);
        const current = await this.synchronizeGrants(client, currentRules);
        return this.snapshot(current, now, false);
      }
      let entitlements = await client.query<{ id: string; sku_id: string; source: string }>(
        `SELECT id, sku_id, source FROM game_ops.colony_entitlements
          WHERE owner_wallet = $1 AND cluster = $2 AND revoked_at IS NULL
          ORDER BY granted_at ASC`,
        [params.wallet, this.cluster],
      );
      let starter = entitlements.rows.find(item => item.sku_id === 'STARTER_COLONY_V1');
      if (!starter && this.freeStarterEnabled) {
        await client.query(
          `SELECT game_ops.claim_free_colony_starter($1, $2, $3)`,
          [randomUUID(), params.wallet, this.cluster],
        );
        entitlements = await client.query<{ id: string; sku_id: string; source: string }>(
          `SELECT id, sku_id, source FROM game_ops.colony_entitlements
            WHERE owner_wallet = $1 AND cluster = $2 AND revoked_at IS NULL
            ORDER BY granted_at ASC`,
          [params.wallet, this.cluster],
        );
        starter = entitlements.rows.find(item => item.sku_id === 'STARTER_COLONY_V1');
      }
      if (!starter) throw new ColonyServiceError('ENTITLEMENT_REQUIRED');
      let grants;
      try {
        grants = resolveColonyGrants(entitlements.rows.map(item => item.sku_id));
      } catch {
        throw new ColonyServiceError('INTEGRITY_FAILURE');
      }
      const entitlementId = starter.id;
      const colonyId = randomUUID();
      const state = createInitialColonyState(now, grants);
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
      const primaryLinkId = randomUUID();
      await client.query(
        `INSERT INTO game_ops.colony_fields (id, colony_id, field_address, is_primary) VALUES ($1, $2, $3, true)`,
        [primaryLinkId, colonyId, params.fieldAddress],
      );
      row.linked_fields = [params.fieldAddress];
      const event = {
        colonyId,
        sequence: 1,
        requestId: params.requestId,
        eventType: 'colony_initialized',
        payload: {
          fieldAddress: params.fieldAddress,
          linkId: primaryLinkId,
          entitlementId,
          entitlementSource: starter.source,
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

  async linkField(params: {
    wallet: string;
    fieldAddress: string;
    requestId: string;
    expectedSequence: number;
    evidence: FieldOwnershipEvidence;
  }): Promise<{ snapshot: ColonySnapshot; duplicate: boolean }> {
    assertRequestId(params.requestId);
    if (!Number.isSafeInteger(params.expectedSequence) || params.expectedSequence < 1
      || params.evidence.wallet !== params.wallet || params.evidence.fieldAddress !== params.fieldAddress
      || params.evidence.cluster !== this.cluster || params.evidence.commitment !== 'finalized'
      || !Number.isSafeInteger(params.evidence.observedSlot) || params.evidence.observedSlot < 0) {
      throw new ColonyServiceError('INVALID_REQUEST');
    }
    try {
      return await withTransaction(this.pool, `colony:field-link:${params.wallet}`, async client => {
        let row = await readColony(client, params.wallet, true);
        if (!row) throw new ColonyServiceError('COLONY_NOT_FOUND');
        const history = await verifiedEvents(client, row);
        const prior = history.find(event => event.request_id === params.requestId);
        if (prior) {
          if (prior.event_type !== 'colony_field_linked' || prior.payload.fieldAddress !== params.fieldAddress) {
            throw new ColonyServiceError('IDEMPOTENCY_CONFLICT');
          }
          return { snapshot: this.snapshot(row, new Date(), true), duplicate: true };
        }
        row = await this.synchronizeRuleset(client, row);
        row = await this.synchronizeGrants(client, row);
        if (parseSequence(row.sequence) !== params.expectedSequence) throw new ColonyServiceError('VERSION_CONFLICT');
        const linkedFields = row.linked_fields ?? [row.field_address];
        if (linkedFields.includes(params.fieldAddress)) throw new ColonyServiceError('FIELD_ALREADY_LINKED');
        if (linkedFields.length >= row.state.grants.fieldSlots) throw new ColonyServiceError('FIELD_SLOT_LIMIT');
        const collision = await client.query<{ colony_id: string }>(
          `SELECT colony_id FROM game_ops.colony_fields WHERE field_address = $1 AND unlinked_at IS NULL`, [params.fieldAddress],
        );
        if (collision.rows.length) throw new ColonyServiceError('FIELD_IN_USE');
        const linkId = randomUUID();
        await client.query(
          `INSERT INTO game_ops.colony_fields (id, colony_id, field_address, is_primary) VALUES ($1, $2, $3, false)`,
          [linkId, row.id, params.fieldAddress],
        );
        row.linked_fields = [...linkedFields, params.fieldAddress];
        const snapshot = await appendEvent(client, {
          row,
          requestId: params.requestId,
          eventType: 'colony_field_linked',
          payload: {
            fieldAddress: params.fieldAddress,
            linkId,
            cluster: params.evidence.cluster,
            commitment: params.evidence.commitment,
            observedSlot: params.evidence.observedSlot,
            fieldLevel: params.evidence.fieldLevel,
            fieldType: params.evidence.fieldType,
            durability: params.evidence.durability,
            state: row.state,
          },
          state: row.state,
        });
        return { snapshot, duplicate: false };
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505'
        && 'constraint' in error && error.constraint === 'colony_fields_one_active_address_idx') {
        throw new ColonyServiceError('FIELD_IN_USE');
      }
      throw error;
    }
  }

  async unlinkField(params: {
    wallet: string;
    fieldAddress: string;
    requestId: string;
    expectedSequence: number;
  }): Promise<{ snapshot: ColonySnapshot; duplicate: boolean }> {
    assertRequestId(params.requestId);
    if (!Number.isSafeInteger(params.expectedSequence) || params.expectedSequence < 1
      || typeof params.fieldAddress !== 'string' || params.fieldAddress.length < 32 || params.fieldAddress.length > 44) {
      throw new ColonyServiceError('INVALID_REQUEST');
    }
    return withTransaction(this.pool, `colony:field-unlink:${params.wallet}`, async client => {
      let row = await readColony(client, params.wallet, true);
      if (!row) throw new ColonyServiceError('COLONY_NOT_FOUND');
      const history = await verifiedEvents(client, row);
      const prior = history.find(event => event.request_id === params.requestId);
      if (prior) {
        if (prior.event_type !== 'colony_field_unlinked' || prior.payload.fieldAddress !== params.fieldAddress) {
          throw new ColonyServiceError('IDEMPOTENCY_CONFLICT');
        }
        return { snapshot: this.snapshot(row, new Date(), true), duplicate: true };
      }
      row = await this.synchronizeRuleset(client, row);
      row = await this.synchronizeGrants(client, row);
      if (parseSequence(row.sequence) !== params.expectedSequence) throw new ColonyServiceError('VERSION_CONFLICT');
      if (params.fieldAddress === row.field_address) throw new ColonyServiceError('FIELD_PRIMARY_IMMUTABLE');
      const active = row.linked_fields ?? [row.field_address];
      if (!active.includes(params.fieldAddress)) throw new ColonyServiceError('FIELD_NOT_LINKED');
      const link = await client.query<{ id: string }>(
        `SELECT id FROM game_ops.colony_fields
          WHERE colony_id = $1 AND field_address = $2 AND unlinked_at IS NULL
          FOR UPDATE`,
        [row.id, params.fieldAddress],
      );
      const linkId = link.rows[0]?.id;
      if (!linkId) throw new ColonyServiceError('INTEGRITY_FAILURE');
      row.linked_fields = active.filter(address => address !== params.fieldAddress);
      const snapshot = await appendEvent(client, {
        row,
        requestId: params.requestId,
        eventType: 'colony_field_unlinked',
        payload: { fieldAddress: params.fieldAddress, linkId, state: row.state },
        state: row.state,
      });
      const updated = await client.query(
        `UPDATE game_ops.colony_fields SET unlinked_at = now()
          WHERE id = $1 AND unlinked_at IS NULL`,
        [linkId],
      );
      if (updated.rowCount !== 1) throw new ColonyServiceError('INTEGRITY_FAILURE');
      return { snapshot, duplicate: false };
    });
  }

  async get(wallet: string): Promise<ColonySnapshot> {
    const now = new Date();
    return withTransaction(this.pool, `colony:read:${wallet}`, async client => {
      const row = await readColony(client, wallet, true);
      if (!row) throw new ColonyServiceError('COLONY_NOT_FOUND');
      await verifiedEvents(client, row);
      const currentRules = await this.synchronizeRuleset(client, row);
      const current = await this.synchronizeGrants(client, currentRules);
      return this.snapshot(current, now, true);
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
      let row = await readColony(client, params.wallet, true);
      if (!row) throw new ColonyServiceError('COLONY_NOT_FOUND');
      if (row.field_address !== params.fieldAddress) throw new ColonyServiceError('FIELD_MISMATCH');
      const history = await verifiedEvents(client, row);
      const prior = history.find(event => event.request_id === params.requestId);
      if (prior) {
        if (canonicalJson(prior.payload.action) !== canonicalJson(action)) throw new ColonyServiceError('IDEMPOTENCY_CONFLICT');
        return { snapshot: this.snapshot(row, new Date(), true), duplicate: true, result: isRecordPayload(prior.payload.result) ? prior.payload.result : null };
      }
      row = await this.synchronizeRuleset(client, row);
      row = await this.synchronizeGrants(client, row);
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
      linkedFields: row.linked_fields ?? [row.field_address],
      materializedAt: now.toISOString(),
      pending: Boolean(state.pendingResearch.length || state.pendingLabUpgrade || state.buildings.some(building => building.status === 'constructing' || building.status === 'upgrading')),
    };
  }
}
