// Watchtower OS v3 — node:test suite (без сети/БД; spin-up только loopback).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  API_ROUTES, COMPONENTS, COMPONENTS_BY_ID, DUPLICATES_DEPRECATED, GAME,
  OS_CONFIG, assetStrategy,
} from '../../src/os/stack-v3.js';
import { PANELS_V3, osHealth, validatePanelReferences } from '../../src/os/control-panels-v3.js';
import {
  REPORT_STEPS_V3, handoffTargets, integrationMarkdown, reportMarkdown,
} from '../../src/os/handoff-v3.js';
import { createOsServer } from '../../src/os/server.js';

test('config: ровно 33 компонента (v1 8 + v2 12 + v3 13), ids уникальны', () => {
  assert.equal(COMPONENTS.length, 33);
  assert.deepEqual(OS_CONFIG.counts.byTrack, { v1: 8, v2: 12, v3: 13 });
  assert.equal(new Set(COMPONENTS.map(c => c.id)).size, 33);
  for (const c of COMPONENTS) {
    assert.ok(c.id && c.track && c.category.length > 0, `bad component ${c.id}`);
    assert.ok(['ideal-free', 'deprecated'].includes(c.status));
  }
});

test('duplicates deprecated: ровно 3 разрешённых дубля', () => {
  assert.equal(DUPLICATES_DEPRECATED.length, 3);
  assert.deepEqual(DUPLICATES_DEPRECATED.map(d => [d.duplicate, d.kept]), [
    ['create-solana-game', 'preset'], ['aureus', 'ritarena'], ['solshield', 'solguard'],
  ]);
  assert.equal(COMPONENTS_BY_ID.get('aureus').status, 'deprecated');
  assert.equal(COMPONENTS_BY_ID.get('aureus').supersededBy, 'ritarena');
  for (const d of DUPLICATES_DEPRECATED) assert.ok(COMPONENTS_BY_ID.has(d.kept), `kept ${d.kept}`);
});

test('19 control panels; ссылки на реестр валидны; health показывает 19 слоёв', () => {
  assert.equal(PANELS_V3.length, 19);
  assert.deepEqual(validatePanelReferences(), []);
  const h = osHealth();
  assert.equal(h.layerCount, 19);
  assert.equal(h.layers.length, 19);
  for (const l of h.layers) assert.equal(l.blockchainWritesEnabled, false);
});

test('запреты: writes off, session-key scope, env names only, no secrets в реестре', () => {
  assert.equal(GAME.blockchainWritesEnabled, false);
  const pstr = JSON.stringify(OS_CONFIG);
  assert.match(pstr, /withdraw_treasury/);
  assert.match(pstr, /ARES1_CORE_PROGRAM_ID/);
  assert.doesNotMatch(pstr, /[?&](api[-_]?key|token|key)=[a-z0-9_-]{16,}/i);
  // нет 64-byte Solana keypair arrays
  assert.doesNotMatch(pstr, /\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/);
  // program alias values не подменяют верифицированный deployment
  for (const p of OS_CONFIG.programs) assert.equal(p.address, null);
  assert.equal(OS_CONFIG.verifiedDeployment.programId, 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf');
});

test('asset strategy: common+common → cNFT ($110/M, tensor primary); legendary → standard NFT', () => {
  const common = assetStrategy('common', 'common');
  assert.equal(common.selected, 'cnft');
  assert.equal(common.strategy.costPer1MMintsUsd, 110);
  assert.equal(common.strategy.marketplace.primary, 'tensor');
  assert.equal(common.alwaysOn.storage.startsWith('xandeum'), true);
  const legendary = assetStrategy('common', 'legendary');
  assert.equal(legendary.selected, 'standard-nft');
  assert.equal(assetStrategy('mythic', 'common').error, 'INVALID_ASSET_QUERY');
});

test('handoff: integration doc содержит обязательные поля и запреты', () => {
  const md = integrationMarkdown();
  for (const needle of [
    'game_id', 'ares1', 'network', 'devnet', 'stage', 'prototype',
    'data_quality', 'partial', 'last_verified_at', 'blockchain_writes_enabled',
    'CgInv111', 'SessKeys111', 'STrEaSuRy111', 'ARES1_CORE_PROGRAM_ID',
    'create-solana-game', 'aureus', 'solshield',
  ]) assert.ok(md.includes(needle), `missing ${needle}`);
  assert.equal((md.match(/withdraw_treasury/g) || []).length >= 1, true);
  assert.doesNotMatch(md, /\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/);
});

test('final report: ровно 20 пунктов = v1 7 + v2 7 + v3 6; нумерация 1..20', () => {
  assert.equal(REPORT_STEPS_V3.v1.length, 7);
  assert.equal(REPORT_STEPS_V3.v2.length, 7);
  assert.equal(REPORT_STEPS_V3.v3.length, 6);
  const md = reportMarkdown();
  for (let i = 1; i <= 20; i += 1) assert.ok(md.includes(`\n${i}. `), `step ${i} numbered`);
  for (const t of handoffTargets()) assert.equal(typeof t.content(), 'string');
});

async function withServer(fn, opts = {}) {
  const server = createOsServer(opts);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('api: все объявленные маршруты отвечают 200 и envelope без writes', async () => {
  await withServer(async base => {
    for (const route of Object.keys(API_ROUTES)) {
      const path = route.slice(4) + (route === 'GET /api/sdk/preset' ? '?template=farming' : '');
      const res = await fetch(`${base}${path}`, { headers: { connection: 'close' } });
      assert.equal(res.status, 200, `${route} → ${res.status}`);
      const body = await res.json();
      assert.equal(body.gameId, 'ares1', route);
      assert.equal(body.network, 'devnet', route);
      assert.equal(body.stage, 'prototype', route);
      assert.equal(body.dataQuality, 'partial', route);
      assert.equal(body.blockchainWritesEnabled, false, route);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    const cfg = await (await fetch(`${base}/api/os/config`)).json();
    assert.equal(cfg.data.counts.total, 33);
    assert.equal(cfg.data.controlPanels.length, 19);
    const health = await (await fetch(`${base}/api/os/health`)).json();
    assert.equal(health.data.layerCount, 19);
  });
});

test('api: гварды — 404, 405, 400 gameId, 400 dup params, 400 unknown template/rarity', async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/api/sdk/nope?gameId=ares1`)).status, 404);
    assert.equal((await fetch(`${base}/api/os/config`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/api/os/config?gameId=other`)).status, 400);
    assert.equal((await fetch(`${base}/api/os/config?gameId=ares1&gameId=ares1`)).status, 400);
    assert.equal((await fetch(`${base}/api/os/config?wat=1`)).status, 400);
    assert.equal((await fetch(`${base}/api/sdk/preset?template=unknown`)).status, 400);
    assert.equal((await fetch(`${base}/api/assets/strategy?itemType=common&rarity=mythic`)).status, 400);
    const okPreset = await (await fetch(`${base}/api/sdk/preset?gameId=ares1&template=farming`)).json();
    assert.match(okPreset.data.scaffold, /create-solana-game ares1 --preset farming/);
    const strat = await (await fetch(`${base}/api/assets/strategy?gameId=ares1&itemType=common&rarity=common`)).json();
    assert.equal(strat.data.selected, 'cnft');
  });
});

test('api: token mode — 401 без Bearer, 200 с Bearer', async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/api/os/health`)).status, 401);
    const res = await fetch(`${base}/api/os/health`, { headers: { authorization: `Bearer ${'t'.repeat(40)}` } });
    assert.equal(res.status, 200);
  }, { token: 't'.repeat(40) });
});

test('sdk endpoints v3: best-free rationale и ключевые поля', async () => {
  await withServer(async base => {
    const ritarena = await (await fetch(`${base}/api/sdk/ritarena?gameId=ares1`)).json();
    assert.equal(ritarena.data.component.chosenOver, 'aureus');
    assert.deepEqual(ritarena.data.component.key.lifecycle, ['createArena', 'addBot', 'compete']);
    const slam = await (await fetch(`${base}/api/testing/solana-slam?gameId=ares1`)).json();
    assert.equal(slam.data.component.key.litesvm, true);
    const privacy = await (await fetch(`${base}/api/privacy/arcium?gameId=ares1`)).json();
    assert.equal(privacy.data.component.key.confidential, true);
    const ml = await (await fetch(`${base}/api/game-signals/config?gameId=ares1`)).json();
    assert.equal(ml.data.component.key.churnWindowDays, 14);
    assert.equal(ml.data.component.key.campaignProposal.churnRiskThreshold, 0.7);
    const rust = await (await fetch(`${base}/api/payments/rust-api?gameId=ares1`)).json();
    assert.equal(rust.data.component.key.swagger, true);
    const race = await (await fetch(`${base}/api/cross-chain/race?gameId=ares1`)).json();
    assert.deepEqual(race.data.component.key.chains, ['solana', 'evm']);
    const aureusWarn = await (await fetch(`${base}/api/sdk/security-auditing-skill?gameId=ares1`)).json();
    assert.equal(aureusWarn.data.component.key.categories.length, 9);
  });
});
