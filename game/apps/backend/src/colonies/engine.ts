import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from './eventHash.js';
import { BASE_CAPACITY, BUILDINGS, COLONY_RULESET_VERSION, RESEARCH, RESOURCE_KEYS, STARTER_INITIAL_RESOURCES, validBuildingKind, validResearchId } from './rules.js';
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
  schemaVersion: 1;
  rulesetVersion: number;
  coreLevel: number;
  labLevel: number;
  resources: Record<Resource, number>;
  capacities: Record<Resource, number>;
  productionRemainders: Record<Resource, number>;
  buildings: ColonyBuilding[];
  pendingResearch: ColonyResearch | null;
  completedResearch: ResearchId[];
  lastMaterializedAt: string;
}

export type ColonyAction =
  | { type: 'start_build'; building: unknown }
  | { type: 'start_upgrade'; buildingId: unknown }
  | { type: 'start_research'; research: unknown };

export class ColonyRuleError extends Error {
  readonly preserveThroughTransaction = true;
  constructor(readonly code: 'INVALID_ACTION' | 'INSUFFICIENT_RESOURCES' | 'QUEUE_FULL' | 'ALREADY_BUILT' | 'ALREADY_RESEARCHED' | 'MAX_LEVEL' | 'BUILDING_NOT_FOUND' | 'RESEARCH_PREREQUISITE' | 'INVALID_STATE') {
    super(code);
    this.name = 'ColonyRuleError';
  }
}

const DENOMINATOR = 3_600 * 10_000;
const MAX_MATERIALIZE_SECONDS = 60 * 60 * 24 * 365 * 5;

export function createInitialColonyState(now = new Date()): ColonyState {
  return {
    schemaVersion: 1,
    rulesetVersion: COLONY_RULESET_VERSION,
    coreLevel: 1,
    labLevel: 1,
    resources: { ...STARTER_INITIAL_RESOURCES },
    capacities: { ...BASE_CAPACITY },
    productionRemainders: { metal: 0, water: 0, power: 0, science: 0 },
    buildings: [],
    pendingResearch: null,
    completedResearch: [],
    lastMaterializedAt: now.toISOString(),
  };
}

export function assertValidColonyState(value: unknown): asserts value is ColonyState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ColonyRuleError('INVALID_STATE');
  const state = value as Partial<ColonyState>;
  if (state.schemaVersion !== 1 || state.rulesetVersion !== COLONY_RULESET_VERSION
    || !Number.isSafeInteger(state.coreLevel) || state.coreLevel! < 1 || state.coreLevel! > 10
    || !Number.isSafeInteger(state.labLevel) || state.labLevel! < 1 || state.labLevel! > 10
    || typeof state.lastMaterializedAt !== 'string' || !Number.isFinite(Date.parse(state.lastMaterializedAt))
    || !Array.isArray(state.buildings) || state.buildings.length > 32
    || !Array.isArray(state.completedResearch) || state.completedResearch.length > Object.keys(RESEARCH).length
    || !state.resources || !state.capacities || !state.productionRemainders) throw new ColonyRuleError('INVALID_STATE');
  for (const resource of RESOURCE_KEYS) {
    const current = state.resources[resource];
    const capacity = state.capacities[resource];
    const remainder = state.productionRemainders[resource];
    if (!Number.isSafeInteger(current) || current! < 0 || !Number.isSafeInteger(capacity) || capacity !== BASE_CAPACITY[resource] || current! > capacity!
      || !Number.isSafeInteger(remainder) || remainder! < 0 || remainder! >= DENOMINATOR) throw new ColonyRuleError('INVALID_STATE');
  }
  const buildingIds = new Set<string>();
  const buildingKinds = new Set<string>();
  for (const building of state.buildings) {
    const validLevel = Number.isSafeInteger(building?.level) && building.level >= 1 && building.level <= 3;
    const validUpgrade = building?.status === 'upgrading' && Number.isSafeInteger(building.targetLevel) && building.targetLevel === building.level + 1 && building.targetLevel <= 3;
    if (!building || !validBuildingKind(building.kind) || !validLevel
      || !['active', 'constructing', 'upgrading'].includes(building.status) || (building.status === 'upgrading' ? !validUpgrade : building.targetLevel !== undefined)
      || typeof building.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(building.id)
      || buildingIds.has(building.id) || buildingKinds.has(building.kind)
      || !Number.isFinite(Date.parse(building.startedAt)) || !Number.isFinite(Date.parse(building.completesAt))) throw new ColonyRuleError('INVALID_STATE');
    buildingIds.add(building.id); buildingKinds.add(building.kind);
  }
  if (state.pendingResearch !== null) {
    const research = state.pendingResearch;
    if (!research || !validResearchId(research.id) || !Number.isFinite(Date.parse(research.startedAt))
      || !Number.isFinite(Date.parse(research.completesAt))) throw new ColonyRuleError('INVALID_STATE');
  }
  const completed = new Set<ResearchId>();
  for (const research of state.completedResearch) {
    if (!validResearchId(research) || completed.has(research)
      || RESEARCH[research].prerequisites.some(required => !completed.has(required))) throw new ColonyRuleError('INVALID_STATE');
    completed.add(research);
  }
  if (state.pendingResearch && (completed.has(state.pendingResearch.id)
    || RESEARCH[state.pendingResearch.id].prerequisites.some(required => !completed.has(required)))) throw new ColonyRuleError('INVALID_STATE');
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
  const completions: Array<{ at: number; kind: 'building' | 'research'; id: string }> = [];
  for (const building of state.buildings) if (building.status === 'constructing' || building.status === 'upgrading') completions.push({ at: parseTime(building.completesAt), kind: 'building', id: building.id });
  if (state.pendingResearch) completions.push({ at: parseTime(state.pendingResearch.completesAt), kind: 'research', id: state.pendingResearch.id });
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
    } else if (state.pendingResearch?.id === completion.id) {
      state.completedResearch.push(state.pendingResearch.id);
      state.pendingResearch = null;
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
    if (state.buildings.some(building => building.status === 'constructing' || building.status === 'upgrading')) throw new ColonyRuleError('QUEUE_FULL');
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
    if (state.buildings.some(candidate => candidate.status === 'constructing' || candidate.status === 'upgrading')) throw new ColonyRuleError('QUEUE_FULL');
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
  if (action.type === 'start_research') {
    if (!validResearchId(action.research)) throw new ColonyRuleError('INVALID_ACTION');
    if (state.completedResearch.includes(action.research)) throw new ColonyRuleError('ALREADY_RESEARCHED');
    if (state.pendingResearch) throw new ColonyRuleError('QUEUE_FULL');
    const rule = RESEARCH[action.research];
    if (rule.prerequisites.some(required => !state.completedResearch.includes(required))) throw new ColonyRuleError('RESEARCH_PREREQUISITE');
    pay(state, rule.cost);
    const startedAt = now.toISOString();
    const completesAt = new Date(now.getTime() + rule.durationSeconds * 1000).toISOString();
    state.pendingResearch = { id: action.research, startedAt, completesAt };
    return { state, result: { research: action.research, status: 'researching', completesAt, costs: rule.cost } };
  }
  throw new ColonyRuleError('INVALID_ACTION');
}
