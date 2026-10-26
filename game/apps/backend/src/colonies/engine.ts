import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from './eventHash.js';
import { capacityForGrants, resolveColonyGrants, STARTER_COLONY_GRANTS } from './catalog.js';
import type { ColonyGrants } from './catalog.js';
import { BUILDINGS, COLONY_RULESET_VERSION, LAB_UPGRADE_BASE, RESEARCH, RESOURCE_KEYS, STARTER_INITIAL_RESOURCES, validBuildingKind, validResearchId } from './rules.js';
import type { BuildingKind, Resource, ResearchId } from './rules.js';

export interface ColonyBuilding {
  id: string;
  kind: BuildingKind;
  level: number;
  status: 'constructing' | 'upgrading' | 'active';
  targetLevel?: number;
  startedAt: string;
  completesAt: string;
}

export interface ColonyResearch {
  id: ResearchId;
  startedAt: string;
  completesAt: string;
}

export interface ColonyState {
  schemaVersion: 2;
  rulesetVersion: number;
  grants: ColonyGrants;
  coreLevel: number;
  labLevel: number;
  resources: Record<Resource, number>;
  capacities: Record<Resource, number>;
  productionRemainders: Record<Resource, number>;
  buildings: ColonyBuilding[];
  pendingResearch: ColonyResearch[];
  /** Optional for compatibility with already-persisted v3 snapshots. */
  pendingLabUpgrade?: { targetLevel: number; startedAt: string; completesAt: string } | null;
  completedResearch: ResearchId[];
  lastMaterializedAt: string;
}

export type ColonyAction =
  | { type: 'start_build'; building: unknown }
  | { type: 'start_upgrade'; buildingId: unknown }
  | { type: 'start_lab_upgrade' }
  | { type: 'start_research'; research: unknown };

export class ColonyRuleError extends Error {
  readonly preserveThroughTransaction = true;
  constructor(readonly code: 'INVALID_ACTION' | 'INSUFFICIENT_RESOURCES' | 'QUEUE_FULL' | 'ALREADY_BUILT' | 'ALREADY_RESEARCHED' | 'MAX_LEVEL' | 'BUILDING_NOT_FOUND' | 'RESEARCH_PREREQUISITE' | 'INVALID_STATE' | 'GRANTS_REDUCTION_UNSUPPORTED' | 'LAB_AT_CAP' | 'LAB_UPGRADE_PENDING') {
    super(code);
    this.name = 'ColonyRuleError';
  }
}

const DENOMINATOR = 3_600 * 10_000;
const MAX_MATERIALIZE_SECONDS = 60 * 60 * 24 * 365 * 5;

export function createInitialColonyState(now = new Date(), grants: ColonyGrants = STARTER_COLONY_GRANTS): ColonyState {
  return {
    schemaVersion: 2,
    rulesetVersion: COLONY_RULESET_VERSION,
    grants: structuredClone(grants),
    coreLevel: 1,
    labLevel: 1,
    resources: { ...STARTER_INITIAL_RESOURCES },
    capacities: { ...capacityForGrants(grants) },
    productionRemainders: { metal: 0, water: 0, power: 0, science: 0 },
    buildings: [],
    pendingResearch: [],
    pendingLabUpgrade: null,
    completedResearch: [],
    lastMaterializedAt: now.toISOString(),
  };
}

export function syncColonyGrants(input: ColonyState, grants: ColonyGrants): ColonyState {
  assertValidColonyState(input);
  const current = input.grants;
  const isAdditive = current.skuIds.every(id => grants.skuIds.includes(id));
  const addedSkuIds = grants.skuIds.filter(id => !current.skuIds.includes(id));
  if (!isAdditive && addedSkuIds.length === 0) throw new ColonyRuleError('GRANTS_REDUCTION_UNSUPPORTED');
  if (grants.fieldSlots < current.fieldSlots || grants.buildQueues < current.buildQueues
    || grants.researchQueues < current.researchQueues || grants.labLevelCap < current.labLevelCap
    || RESOURCE_KEYS.some(resource => grants.storageMultipliers[resource] < current.storageMultipliers[resource])) {
    throw new ColonyRuleError('GRANTS_REDUCTION_UNSUPPORTED');
  }
  const state = structuredClone(input);
  state.grants = structuredClone(grants);
  const capacity = capacityForGrants(grants);
  for (const resource of RESOURCE_KEYS) state.capacities[resource] = capacity[resource];
  assertValidColonyState(state);
  return state;
}

export function assertValidColonyState(value: unknown): asserts value is ColonyState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ColonyRuleError('INVALID_STATE');
  const state = value as Partial<ColonyState>;
  if (state.schemaVersion !== 2 || ![3, COLONY_RULESET_VERSION].includes(state.rulesetVersion ?? 0)
    || !state.grants || !Array.isArray(state.grants.skuIds)
    || !Number.isSafeInteger(state.coreLevel) || state.coreLevel! < 1 || state.coreLevel! > 10
    || !Number.isSafeInteger(state.labLevel) || state.labLevel! < 1 || state.labLevel! > state.grants.labLevelCap
    || typeof state.lastMaterializedAt !== 'string' || !Number.isFinite(Date.parse(state.lastMaterializedAt))
    || !Array.isArray(state.buildings) || state.buildings.length > 32
    || !Array.isArray(state.pendingResearch) || state.pendingResearch.length > state.grants.researchQueues
    || (state.pendingLabUpgrade !== undefined && state.pendingLabUpgrade !== null
      && (!Number.isSafeInteger(state.pendingLabUpgrade.targetLevel) || state.pendingLabUpgrade.targetLevel !== state.labLevel! + 1
        || state.pendingLabUpgrade.targetLevel > state.grants.labLevelCap
        || !Number.isFinite(Date.parse(state.pendingLabUpgrade.startedAt))
        || !Number.isFinite(Date.parse(state.pendingLabUpgrade.completesAt))))
    || !Array.isArray(state.completedResearch) || state.completedResearch.length > Object.keys(RESEARCH).length
    || !state.resources || !state.capacities || !state.productionRemainders) throw new ColonyRuleError('INVALID_STATE');
  let resolvedGrants: ColonyGrants;
  try {
    resolvedGrants = resolveColonyGrants(state.grants.skuIds);
  } catch {
    throw new ColonyRuleError('INVALID_STATE');
  }
  if (canonicalJson(resolvedGrants) !== canonicalJson(state.grants)) throw new ColonyRuleError('INVALID_STATE');
  const expectedCapacity = capacityForGrants(resolvedGrants);
  for (const resource of RESOURCE_KEYS) {
    const current = state.resources[resource];
    const capacity = state.capacities[resource];
    const remainder = state.productionRemainders[resource];
    if (!Number.isSafeInteger(current) || current! < 0 || !Number.isSafeInteger(capacity) || capacity !== expectedCapacity[resource] || current! > capacity!
      || !Number.isSafeInteger(remainder) || remainder! < 0 || remainder! >= DENOMINATOR) throw new ColonyRuleError('INVALID_STATE');
  }
  const buildingIds = new Set<string>();
  const buildingKinds = new Set<string>();
  let activeBuildJobs = 0;
  for (const building of state.buildings) {
    const validLevel = Number.isSafeInteger(building?.level) && building.level >= 1 && building.level <= 3;
    const validUpgrade = building?.status === 'upgrading' && Number.isSafeInteger(building.targetLevel) && building.targetLevel === building.level + 1 && building.targetLevel <= 3;
    if (!building || !validBuildingKind(building.kind) || !validLevel
      || !['active', 'constructing', 'upgrading'].includes(building.status) || (building.status === 'upgrading' ? !validUpgrade : building.targetLevel !== undefined)
      || typeof building.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(building.id)
      || buildingIds.has(building.id) || buildingKinds.has(building.kind)
      || !Number.isFinite(Date.parse(building.startedAt)) || !Number.isFinite(Date.parse(building.completesAt))) throw new ColonyRuleError('INVALID_STATE');
    if (building.status === 'constructing' || building.status === 'upgrading') activeBuildJobs++;
    buildingIds.add(building.id); buildingKinds.add(building.kind);
  }
  if (state.pendingLabUpgrade) activeBuildJobs++;
  if (activeBuildJobs > resolvedGrants.buildQueues) throw new ColonyRuleError('INVALID_STATE');
  const completed = new Set<ResearchId>();
  for (const research of state.completedResearch) {
    if (!validResearchId(research) || completed.has(research)
      || RESEARCH[research].prerequisites.some(required => !completed.has(required))) throw new ColonyRuleError('INVALID_STATE');
    completed.add(research);
  }
  const pending = new Set<ResearchId>();
  for (const research of state.pendingResearch) {
    if (!research || !validResearchId(research.id) || pending.has(research.id)
      || completed.has(research.id) || !Number.isFinite(Date.parse(research.startedAt))
      || !Number.isFinite(Date.parse(research.completesAt))
      || RESEARCH[research.id].prerequisites.some(required => !completed.has(required))) throw new ColonyRuleError('INVALID_STATE');
    pending.add(research.id);
  }
}

export function hashColonyState(state: ColonyState): string {
  return createHash('sha256').update(canonicalJson(state)).digest('hex');
}

function parseTime(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new ColonyRuleError('INVALID_STATE');
  return time;
}

function productionRates(state: ColonyState): Record<Resource, number> {
  const rates: Record<Resource, number> = { metal: 0, water: 0, power: 0, science: state.labLevel * 2 };
  for (const building of state.buildings) {
    if (building.status === 'constructing') continue;
    const yields = BUILDINGS[building.kind].production;
    for (const resource of RESOURCE_KEYS) rates[resource] += (yields[resource] ?? 0) * building.level;
  }
  return rates;
}

function productionMultiplierBps(state: ColonyState, resource: Resource): number {
  let multiplier = 10_000;
  for (const researchId of state.completedResearch) {
    const rule = RESEARCH[researchId];
    if (!rule.productionBonusResource || rule.productionBonusResource === resource) multiplier += rule.productionBonusBps;
  }
  return multiplier;
}

function accrue(state: ColonyState, seconds: number): void {
  if (seconds <= 0) return;
  const rates = productionRates(state);
  for (const resource of RESOURCE_KEYS) {
    const multiplier = productionMultiplierBps(state, resource);
    const numerator = state.productionRemainders[resource] + rates[resource] * multiplier * seconds;
    const amount = Math.floor(numerator / DENOMINATOR);
    const remainder = numerator % DENOMINATOR;
    const next = Math.min(state.capacities[resource], state.resources[resource] + amount);
    state.resources[resource] = next;
    state.productionRemainders[resource] = next === state.capacities[resource] ? 0 : remainder;
  }
}

/** Deterministic server-time materialization; segmented at job completion boundaries. */
export function materializeColony(input: ColonyState, now = new Date()): ColonyState {
  assertValidColonyState(input);
  const state = structuredClone(input);
  const from = parseTime(state.lastMaterializedAt);
  const to = now.getTime();
  if (to < from || (to - from) / 1000 > MAX_MATERIALIZE_SECONDS) throw new ColonyRuleError('INVALID_STATE');
  const completions: Array<{ at: number; kind: 'building' | 'research' | 'lab'; id: string }> = [];
  for (const building of state.buildings) if (building.status === 'constructing' || building.status === 'upgrading') completions.push({ at: parseTime(building.completesAt), kind: 'building', id: building.id });
  for (const research of state.pendingResearch) completions.push({ at: parseTime(research.completesAt), kind: 'research', id: research.id });
  if (state.pendingLabUpgrade) completions.push({ at: parseTime(state.pendingLabUpgrade.completesAt), kind: 'lab', id: 'lab' });
  completions.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
  let cursor = from;
  for (const completion of completions) {
    if (completion.at > to) break;
    accrue(state, Math.floor((completion.at - cursor) / 1000));
    cursor = completion.at;
    if (completion.kind === 'building') {
      const building = state.buildings.find(candidate => candidate.id === completion.id);
      if (building) {
        if (building.targetLevel !== undefined) {
          building.level = building.targetLevel;
          delete building.targetLevel;
        }
        building.status = 'active';
      }
    } else if (completion.kind === 'research') {
      const research = state.pendingResearch.find(candidate => candidate.id === completion.id);
      if (research) {
        state.completedResearch.push(research.id);
        state.pendingResearch = state.pendingResearch.filter(candidate => candidate.id !== completion.id);
      }
    } else if (state.pendingLabUpgrade) {
      state.labLevel = state.pendingLabUpgrade.targetLevel;
      state.pendingLabUpgrade = null;
    }
  }
  accrue(state, Math.floor((to - cursor) / 1000));
  state.lastMaterializedAt = now.toISOString();
  return state;
}

function pay(state: ColonyState, costs: Readonly<Record<Resource, number>>): void {
  for (const resource of RESOURCE_KEYS) {
    if (!Number.isSafeInteger(costs[resource]) || costs[resource] < 0) throw new ColonyRuleError('INVALID_STATE');
    if (state.resources[resource] < costs[resource]) throw new ColonyRuleError('INSUFFICIENT_RESOURCES');
  }
  for (const resource of RESOURCE_KEYS) state.resources[resource] -= costs[resource];
}

export function applyColonyAction(input: ColonyState, action: ColonyAction, now = new Date()): { state: ColonyState; result: Record<string, unknown> } {
  const state = materializeColony(input, now);
  if (action.type === 'start_build') {
    if (!validBuildingKind(action.building)) throw new ColonyRuleError('INVALID_ACTION');
    if (state.buildings.some(building => building.kind === action.building)) throw new ColonyRuleError('ALREADY_BUILT');
    if (state.buildings.filter(building => building.status === 'constructing' || building.status === 'upgrading').length + (state.pendingLabUpgrade ? 1 : 0) >= state.grants.buildQueues) throw new ColonyRuleError('QUEUE_FULL');
    const rule = BUILDINGS[action.building];
    pay(state, rule.cost);
    const id = randomUUID();
    const startedAt = now.toISOString();
    const completesAt = new Date(now.getTime() + rule.durationSeconds * 1000).toISOString();
    state.buildings.push({ id, kind: action.building, level: 1, status: 'constructing', startedAt, completesAt });
    return { state, result: { buildingId: id, kind: action.building, status: 'constructing', completesAt, costs: rule.cost } };
  }
  if (action.type === 'start_upgrade') {
    if (typeof action.buildingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(action.buildingId)) throw new ColonyRuleError('INVALID_ACTION');
    const building = state.buildings.find(candidate => candidate.id === action.buildingId);
    if (!building || building.status !== 'active') throw new ColonyRuleError('BUILDING_NOT_FOUND');
    if (building.level >= 3) throw new ColonyRuleError('MAX_LEVEL');
    if (state.buildings.filter(candidate => candidate.status === 'constructing' || candidate.status === 'upgrading').length + (state.pendingLabUpgrade ? 1 : 0) >= state.grants.buildQueues) throw new ColonyRuleError('QUEUE_FULL');
    const rule = BUILDINGS[building.kind];
    const costs = Object.fromEntries(RESOURCE_KEYS.map(resource => [resource, rule.cost[resource] * building.level])) as Record<Resource, number>;
    pay(state, costs);
    const startedAt = now.toISOString();
    const durationSeconds = rule.durationSeconds * building.level;
    const completesAt = new Date(now.getTime() + durationSeconds * 1000).toISOString();
    building.status = 'upgrading';
    building.targetLevel = building.level + 1;
    building.startedAt = startedAt;
    building.completesAt = completesAt;
    return { state, result: { buildingId: building.id, kind: building.kind, status: 'upgrading', targetLevel: building.targetLevel, completesAt, costs } };
  }
  if (action.type === 'start_lab_upgrade') {
    if (state.rulesetVersion !== COLONY_RULESET_VERSION) throw new ColonyRuleError('INVALID_ACTION');
    if (state.pendingLabUpgrade) throw new ColonyRuleError('LAB_UPGRADE_PENDING');
    if (state.labLevel >= state.grants.labLevelCap) throw new ColonyRuleError('LAB_AT_CAP');
    if (state.buildings.filter(candidate => candidate.status === 'constructing' || candidate.status === 'upgrading').length >= state.grants.buildQueues) {
      throw new ColonyRuleError('QUEUE_FULL');
    }
    const costs = Object.fromEntries(RESOURCE_KEYS.map(resource => [resource, LAB_UPGRADE_BASE.cost[resource] * state.labLevel])) as Record<Resource, number>;
    pay(state, costs);
    const startedAt = now.toISOString();
    const completesAt = new Date(now.getTime() + LAB_UPGRADE_BASE.durationSeconds * state.labLevel * 1000).toISOString();
    state.pendingLabUpgrade = { targetLevel: state.labLevel + 1, startedAt, completesAt };
    return { state, result: { targetLevel: state.pendingLabUpgrade.targetLevel, status: 'upgrading_lab', completesAt, costs } };
  }
  if (action.type === 'start_research') {
    if (!validResearchId(action.research)) throw new ColonyRuleError('INVALID_ACTION');
    if (state.completedResearch.includes(action.research)) throw new ColonyRuleError('ALREADY_RESEARCHED');
    if (state.pendingResearch.length >= state.grants.researchQueues) throw new ColonyRuleError('QUEUE_FULL');
    if (state.pendingResearch.some(pending => pending.id === action.research)) throw new ColonyRuleError('ALREADY_RESEARCHED');
    const rule = RESEARCH[action.research];
    if (rule.prerequisites.some(required => !state.completedResearch.includes(required))) throw new ColonyRuleError('RESEARCH_PREREQUISITE');
    pay(state, rule.cost);
    const startedAt = now.toISOString();
    const completesAt = new Date(now.getTime() + rule.durationSeconds * 1000).toISOString();
    state.pendingResearch.push({ id: action.research, startedAt, completesAt });
    return { state, result: { research: action.research, status: 'researching', completesAt, queuePosition: state.pendingResearch.length, costs: rule.cost } };
  }
  throw new ColonyRuleError('INVALID_ACTION');
}
