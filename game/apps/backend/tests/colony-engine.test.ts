import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyColonyAction, createInitialColonyState, materializeColony } from '../src/colonies/engine.js';
import { resolveColonyGrants } from '../src/colonies/catalog.js';

test('server-priced construction spends fixed resources and creates a timed job', () => {
  const start = new Date('2026-10-22T00:00:00.000Z');
  const state = createInitialColonyState(start);
  const result = applyColonyAction(state, { type: 'start_build', building: 'solar_array' }, start);
  assert.deepEqual(result.state.resources, { metal: 400, water: 480, power: 450, science: 50 });
  assert.equal(result.state.buildings[0]?.status, 'constructing');
  assert.equal(result.state.buildings[0]?.completesAt, '2026-10-22T01:00:00.000Z');
  assert.equal((result.result.costs as { metal: number }).metal, 100);
});

test('invalid action, insufficient resources and duplicate buildings fail closed', () => {
  const start = new Date('2026-10-22T00:00:00.000Z');
  const state = createInitialColonyState(start);
  assert.throws(() => applyColonyAction(state, { type: 'start_build', building: 'unknown' }, start), /INVALID_ACTION/);
  const poor = { ...state, resources: { ...state.resources, metal: 0 } };
  assert.throws(() => applyColonyAction(poor, { type: 'start_build', building: 'solar_array' }, start), /INSUFFICIENT_RESOURCES/);
  const built = { ...state, buildings: [{ id: '00000000-0000-4000-8000-000000000001', kind: 'solar_array' as const, level: 1, status: 'active' as const, startedAt: start.toISOString(), completesAt: start.toISOString() }] };
  assert.throws(() => applyColonyAction(built, { type: 'start_build', building: 'solar_array' }, start), /ALREADY_BUILT/);
});

test('research consumes server-calculated materials and completes by server time', () => {
  const start = new Date('2026-10-22T00:00:00.000Z');
  const state = createInitialColonyState(start);
  const started = applyColonyAction(state, { type: 'start_research', research: 'resource_efficiency' }, start).state;
  assert.equal(started.resources.science, 30);
  assert.equal(started.pendingResearch[0]?.completesAt, '2026-10-22T04:00:00.000Z');
  const complete = materializeColony(started, new Date('2026-10-22T04:00:00.000Z'));
  assert.equal(complete.pendingResearch.length, 0);
  assert.deepEqual(complete.completedResearch, ['resource_efficiency']);
});

test('building upgrades queue server-priced levels and preserve the current level until completion', () => {
  const start = new Date('2026-10-22T00:00:00.000Z');
  const built = applyColonyAction(createInitialColonyState(start), { type: 'start_build', building: 'solar_array' }, start).state;
  const afterBuild = materializeColony(built, new Date('2026-10-22T01:00:00.000Z'));
  const buildingId = afterBuild.buildings[0]!.id;
  const upgrading = applyColonyAction(afterBuild, { type: 'start_upgrade', buildingId }, new Date('2026-10-22T01:00:00.000Z')).state;
  assert.equal(upgrading.buildings[0]?.status, 'upgrading');
  assert.equal(upgrading.buildings[0]?.level, 1);
  assert.equal(upgrading.buildings[0]?.targetLevel, 2);
  assert.equal(upgrading.resources.metal, 300);
  const complete = materializeColony(upgrading, new Date('2026-10-22T02:00:00.000Z'));
  assert.equal(complete.buildings[0]?.status, 'active');
  assert.equal(complete.buildings[0]?.level, 2);
  assert.equal(complete.buildings[0]?.targetLevel, undefined);
});

test('research prerequisites and resource-specific production bonuses are server-enforced', () => {
  const start = new Date('2026-10-22T00:00:00.000Z');
  assert.throws(() => applyColonyAction(createInitialColonyState(start), { type: 'start_research', research: 'hydrology' }, start), /RESEARCH_PREREQUISITE/);
  const state = createInitialColonyState(start);
  state.completedResearch.push('resource_efficiency');
  state.buildings.push({ id: '00000000-0000-4000-8000-000000000004', kind: 'water_recycler', level: 1, status: 'active', startedAt: start.toISOString(), completesAt: start.toISOString() });
  const waterResearch = applyColonyAction(state, { type: 'start_research', research: 'hydrology' }, start).state;
  assert.equal(waterResearch.resources.science, 20);
  const completed = materializeColony(waterResearch, new Date('2026-10-22T06:00:00.000Z'));
  assert.ok(completed.completedResearch.includes('hydrology'));
  assert.equal(completed.resources.water, 536);
});

test('production materialization is invariant to short versus long intervals', () => {
  const start = new Date('2026-10-22T00:00:00.000Z');
  const initial = createInitialColonyState(start);
  initial.buildings.push({ id: '00000000-0000-4000-8000-000000000002', kind: 'solar_array', level: 1, status: 'active', startedAt: start.toISOString(), completesAt: start.toISOString() });
  initial.buildings.push({ id: '00000000-0000-4000-8000-000000000003', kind: 'metal_extractor', level: 1, status: 'active', startedAt: start.toISOString(), completesAt: start.toISOString() });
  const end = new Date('2026-10-23T00:00:00.000Z');
  const long = materializeColony(initial, end);
  let short = initial;
  for (let step = 1; step <= 24; step += 1) short = materializeColony(short, new Date(start.getTime() + step * 60 * 60 * 1000));
  assert.deepEqual(short, long);
});

test('approved expansion grants increase resource caps and enforce parallel build/research queues', () => {
  const start = new Date('2026-10-22T00:00:00.000Z');
  const grants = resolveColonyGrants(['STARTER_COLONY_V1', 'INDUSTRIAL_NETWORK_V1', 'RESEARCH_WING_V1', 'FRONTIER_EXPANSION_V1']);
  let state = createInitialColonyState(start, grants);
  assert.deepEqual(state.capacities, { metal: 4_000, water: 4_000, power: 4_000, science: 2_000 });
  state = applyColonyAction(state, { type: 'start_build', building: 'solar_array' }, start).state;
  state = applyColonyAction(state, { type: 'start_build', building: 'water_recycler' }, start).state;
  state = applyColonyAction(state, { type: 'start_build', building: 'metal_extractor' }, start).state;
  assert.equal(state.buildings.filter(job => job.status === 'constructing').length, 3);
  assert.throws(() => applyColonyAction(state, { type: 'start_build', building: 'solar_array' }, start), /ALREADY_BUILT/);

  let researchState = createInitialColonyState(start, resolveColonyGrants(['STARTER_COLONY_V1', 'RESEARCH_WING_V1']));
  researchState = { ...researchState, completedResearch: ['resource_efficiency'], resources: { metal: 500, water: 500, power: 500, science: 100 } };
  researchState = applyColonyAction(researchState, { type: 'start_research', research: 'hydrology' }, start).state;
  researchState = applyColonyAction(researchState, { type: 'start_research', research: 'metallurgy' }, start).state;
  assert.equal(researchState.pendingResearch.length, 2);
  assert.throws(() => applyColonyAction(researchState, { type: 'start_research', research: 'solar_grid' }, start), /QUEUE_FULL/);
});

test('grant synchronization is append-only-friendly, expands capacity, and refuses capability reductions', async () => {
  const { syncColonyGrants } = await import('../src/colonies/engine.js');
  const start = new Date('2026-10-22T00:00:00.000Z');
  const starter = createInitialColonyState(start);
  const expanded = syncColonyGrants(starter, resolveColonyGrants(['STARTER_COLONY_V1', 'RESEARCH_WING_V1']));
  assert.equal(expanded.capacities.science, 1_000);
  assert.equal(expanded.grants.researchQueues, 2);
  assert.deepEqual(expanded.resources, starter.resources);
  assert.throws(() => syncColonyGrants(expanded, resolveColonyGrants(['STARTER_COLONY_V1'])), /GRANTS_REDUCTION_UNSUPPORTED/);
});
