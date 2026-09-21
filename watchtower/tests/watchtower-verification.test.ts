import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { verifyDevnet, exporterOrigin } from '../src/verification.js';
import { DEVNET_GENESIS, type ReadRpc, type ReadMethod } from '../src/rpc.js';
import { decodeTransaction } from '../src/event-decoder.js';
import { config, transaction, programId, sig } from './helpers.js';

function eventRows(tx: ReturnType<typeof transaction>) {
  let id = 0;
  return decodeTransaction(tx, tx.transaction.signatures[0]!, programId).frames.flatMap(f => f.events.map(e => ({
    id: String(++id), signature: tx.transaction.signatures[0]!, slot: String(tx.slot), programId, instructionIndex: f.instructionIndex,
    innerIndex: f.innerIndex, logIndex: e.logIndex, event: e.decoded, applied: f.applied,
    blockTime: new Date(tx.blockTime! * 1000).toISOString(), commitment: 'finalized',
  })));
}

// All RPC/HTTP observations here are synthetic. Never capture these as real-devnet.
function harness() {
  const cfg = config();
  const now = Date.parse('2026-09-21T10:00:00Z');
  const tx = transaction(1, ['Harvested', 'TreasuryTaxed']);
  const rows = eventRows(tx);
  const h = {
    cfg, now, transactions: [tx], rows, pages: [rows], httpCalls: [] as string[], rpcCalls: [] as string[],
    httpMutation: (_path: string, value: any, _count: number): any => value,
    rpcMutation: (_method: string, value: any): any => value,
  };
  const rpc: ReadRpc = { async call<T>(method: ReadMethod, params: unknown[] = []) {
    h.rpcCalls.push(method);
    let result: unknown;
    switch (method) {
      case 'getGenesisHash': result = DEVNET_GENESIS; break;
      case 'getAccountInfo': result = { value: { executable: true } }; break;
      case 'getSlot': result = 10; break;
      case 'getSignaturesForAddress': result = h.transactions.map(t => ({ signature: t.transaction.signatures[0], slot: t.slot, blockTime: t.blockTime, err: t.meta!.err })); break;
      case 'getTransaction': result = h.transactions.find(t => t.transaction.signatures[0] === params[0]) ?? null; break;
      default: throw new Error('unexpected read method');
    }
    return h.rpcMutation(method, structuredClone(result)) as T;
  } };
  let eventPage = 0;
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${cfg.token}`);
    const path = new URL(String(url)).pathname;
    h.httpCalls.push(path);
    const body: any = { source: 'native-rpc', commitment: 'finalized', finalizedLag: 0,
      dataQuality: 'partial', confidence: 'partial', parserVersion: 'ares1-v1', nextCursor: null };
    if (path.endsWith('/config')) body.data = { gameId: 'ares1', network: 'devnet', programConfigured: true,
      deploymentVerified: false, dataQuality: 'partial', writes: false };
    else if (path.endsWith('/readyz')) body.data = { ready: true, database: 'up', mode: 'rpc', phase: 'tail',
      finalizedLag: 0, issues: [], lastSuccessAt: new Date(now).toISOString(), historyCoverage: 'provider_available_only', error: null };
    else {
      assert.equal(path, '/watchtower/events/' + sig(1));
      if (eventPage > 0) assert.equal(new URL(String(url)).searchParams.get('cursor'), 'page-' + eventPage);
      body.data = { events: h.pages[eventPage] ?? [], hasMore: eventPage < h.pages.length - 1, coverage: 'provider_available_only' };
      body.nextCursor = 'page-' + ++eventPage;
    }
    const changed = h.httpMutation(path, structuredClone(body), h.httpCalls.filter(x => x === path).length);
    return changed instanceof Response ? changed : Response.json(changed);
  };
  const run = (extra: Partial<Parameters<typeof verifyDevnet>[2]> = {}) => verifyDevnet(cfg, rpc, {
    exporterUrl: 'https://exporter.invalid', signal: new AbortController().signal, fetcher, now: () => now, ...extra,
  });
  return Object.assign(h, { run });
}

test('smoke validates complete event coordinates and payloads across pages, without claiming deployment', async () => {
  const h = harness(); h.pages = h.rows.map(row => [row]);
  const result = await h.run();
  assert.equal(result.signature, sig(1)); assert.equal(result.events, 2); assert.equal(result.unknownEvents, 0);
  assert.equal(result.checkedAt, new Date(h.now).toISOString());
  assert.equal(h.httpCalls.filter(x => x.endsWith('/readyz')).length, 2);
  assert(!('deploymentVerified' in result)); assert(!('watchtowerConnected' in result));
});
test('silent successful transaction is skipped within a bounded candidate window', async () => {
  const h = harness(); h.transactions.unshift(transaction(2, []));
  assert.equal((await h.run()).signature, sig(1));
  assert.equal(h.rpcCalls.filter(x => x === 'getTransaction').length, 2);
});
for (const [field, value] of [
  ['signature', sig(2)], ['slot', '2'], ['programId', '11111111111111111111111111111111'],
  ['instructionIndex', 3], ['innerIndex', 0], ['logIndex', 99], ['applied', false],
  ['blockTime', '2026-09-21T00:00:00.000Z'],
] as const) test(`equal event payload from wrong ${field} cannot pass smoke`, async () => {
  const h = harness();
  h.httpMutation = (path, body) => { if (path.includes('/events/')) body.data.events[0][field] = value; return body; };
  await assert.rejects(h.run(), /SMOKE_EVENTS_MISMATCH/);
});
for (const mode of ['false-ready', 'stale', 'future', 'gap', 'wrong-mode', 'null-lag', 'second-probe-failed']) {
  test(`readiness fails closed: ${mode}`, async () => {
    const h = harness();
    h.httpMutation = (path, body, count) => {
      if (path.endsWith('/readyz')) {
        if (mode === 'false-ready') body.data.ready = false;
        if (mode === 'stale') body.data.lastSuccessAt = new Date(h.now - 61000).toISOString();
        if (mode === 'future') body.data.lastSuccessAt = new Date(h.now + 61000).toISOString();
        if (mode === 'gap') body.data.issues = [{ code: 'TRANSACTION_GAP' }];
        if (mode === 'wrong-mode') body.data.mode = 'mock';
        if (mode === 'null-lag') body.finalizedLag = null;
        if (mode === 'second-probe-failed' && count === 2) body.data.ready = false;
      }
      return body;
    };
    await assert.rejects(h.run(), /EXPORTER_READINESS/);
  });
}
for (const mode of ['game', 'network', 'writes', 'credential-dump']) test(`safe config identity check: ${mode}`, async () => {
  const h = harness();
  h.httpMutation = (path, body) => {
    if (path.endsWith('/config')) {
      if (mode === 'game') body.data.gameId = 'another-game';
      if (mode === 'network') body.data.network = 'mainnet-beta';
      if (mode === 'writes') body.data.writes = true;
      if (mode === 'credential-dump') body.data.privateRpcUrl = 'must-not-be-accepted';
    }
    return body;
  };
  await assert.rejects(h.run(), /WRONG_EXPORTER_CONFIG/);
});
for (const mode of ['duplicate-id', 'missing-event', 'extra-event', 'null-cursor', 'empty-page']) {
  test(`incomplete or invalid pagination is rejected: ${mode}`, async () => {
    const h = harness();
    h.httpMutation = (path, body) => {
      if (path.includes('/events/')) {
        if (mode === 'duplicate-id') body.data.events[1].id = body.data.events[0].id;
        if (mode === 'missing-event') body.data.events.pop();
        if (mode === 'extra-event') body.data.events.push({ ...body.data.events[0], id: '3' });
        if (mode === 'null-cursor') { body.data.hasMore = true; body.nextCursor = null; }
        if (mode === 'empty-page') { body.data.events = []; body.data.hasMore = true; }
      }
      return body;
    };
    await assert.rejects(h.run(), /SMOKE_EVENTS_MISMATCH|INVALID_EXPORTER_PAGINATION/);
  });
}
for (const mode of ['cluster', 'slot', 'future-slot', 'signature', 'failed', 'missing-tx', 'time']) {
  test(`RPC metadata must agree with the sampled finalized transaction: ${mode}`, async () => {
    const h = harness();
    h.rpcMutation = (method, body) => {
      if (mode === 'cluster' && method === 'getGenesisHash') return 'another-cluster';
      if (mode === 'future-slot' && method === 'getSlot') return 0;
      if (method === 'getTransaction') {
        if (mode === 'slot') body.slot = 2;
        if (mode === 'signature') body.transaction.signatures[0] = sig(2);
        if (mode === 'failed') body.meta.err = 'synthetic failure';
        if (mode === 'missing-tx') return null;
        if (mode === 'time') body.blockTime++;
      }
      return body;
    };
    await assert.rejects(h.run(), /RPC_CLUSTER_MISMATCH|FINALIZED_SLOT_MISMATCH|MISSING_TRANSACTION_METADATA|TRANSACTION_METADATA_MISMATCH|TRANSACTION_GAP/);
  });
}
test('empty or unknown-only samples cannot certify current IDL compatibility', async () => {
  const h = harness(); h.transactions = [];
  await assert.rejects(h.run(), /NO_KNOWN_APPLIED_EVENT/);
  const unknown = harness(); unknown.transactions[0]!.meta!.logMessages = [
    `Program ${programId} invoke [1]`, 'Program data: /w==', `Program ${programId} success`,
  ];
  await assert.rejects(unknown.run(), /NO_KNOWN_APPLIED_EVENT/);
});
test('verification rejects oversized/malformed responses, HTTP failures and transport details', async () => {
  for (const [response, code] of [
    [new Response('sensitive provider body', { status: 503 }), 'EXPORTER_NOT_READY'],
    [new Response('{broken'), 'INVALID_EXPORTER_RESPONSE'],
    [new Response('x'.repeat(2 * 1024 * 1024 + 1)), 'EXPORTER_RESPONSE_TOO_LARGE'],
  ] as const) {
    await assert.rejects(harness().run({ fetcher: async () => response }), { message: code });
  }
  await assert.rejects(harness().run({ fetcher: async () => { throw new Error('private URL and token must not leak'); } }), { message: 'EXPORTER_UNAVAILABLE' });
});
test('verification timeout and pre-aborted shutdown are bounded', async () => {
  const h = harness(); h.cfg.rpcTimeoutMs = 100;
  await assert.rejects(h.run({ fetcher: async (_url, options) => {
    await delay(2000, undefined, { signal: options!.signal! }); return Response.json({});
  } }), /EXPORTER_TIMEOUT/);
  const controller = new AbortController(); controller.abort();
  const stopped = harness(); await assert.rejects(stopped.run({ signal: controller.signal }), /SHUTDOWN/);
  assert.equal(stopped.httpCalls.length, 0); assert.equal(stopped.rpcCalls.length, 0);
});
test('remote bearer traffic requires HTTPS, no credentials/query/prefix or redirect target in base URL', () => {
  for (const url of ['http://remote.invalid', 'https://user:pass@exporter.invalid', 'https://exporter.invalid/?key=secret',
    'https://exporter.invalid/#fragment', 'https://exporter.invalid/prefix', 'file:///tmp/exporter', 'not-a-url']) {
    assert.throws(() => exporterOrigin(url), { message: 'INVALID_EXPORTER_URL' });
  }
  for (const url of ['https://exporter.invalid', 'http://127.0.0.1:8790', 'http://[::1]:8790', 'http://localhost:8790']) {
    assert(exporterOrigin(url));
  }
});
test('failed CLI capture never writes a fixture or marks the manifest verified', () => {
  const manifestPath = new URL('../integration-manifest.json', import.meta.url);
  const fixturePath = new URL('../events/fixtures/real-devnet', import.meta.url);
  const before = readFileSync(manifestPath); const files = readdirSync(fixturePath);
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-devnet.ts', '--capture-fixture'], {
    cwd: new URL('..', import.meta.url), timeout: 5000, encoding: 'utf8',
    env: { ...process.env, WATCHTOWER_ENABLE_WRITES: 'true', WATCHTOWER_EXPORTER_TOKEN: 'must-not-leak' },
  });
  assert.equal(child.status, 1); assert.equal(child.stdout, '');
  const failure = JSON.parse(child.stderr);
  assert.equal(failure.code, 'WRITES_FORBIDDEN'); assert.equal(failure.watchtowerConnected, false);
  assert.equal(failure.deploymentManifestVerified, false); assert(!child.stderr.includes('must-not-leak'));
  assert.deepEqual(readFileSync(manifestPath), before); assert.deepEqual(readdirSync(fixturePath), files);
});

test('a matching Unknown is preserved alongside known events and counted in the evidence', async () => {
  const h = harness();
  h.transactions[0]!.meta!.logMessages!.splice(2, 0, 'Program data: /w==');
  h.rows = eventRows(h.transactions[0]!); h.pages = [h.rows];
  const evidence = await h.run();
  assert.equal(evidence.events, 3); assert.equal(evidence.unknownEvents, 1);
});
for (const [field, value] of [['source', 'synthetic'], ['commitment', 'confirmed'], ['parserVersion', 'another-parser']]) {
  test(`exporter envelope cannot mislabel ${field}`, async () => {
    const h = harness();
    h.httpMutation = (path, body) => { if (path.includes('/events/')) body[field!] = value; return body; };
    await assert.rejects(h.run(), /INVALID_EXPORTER_EVENTS/);
  });
}
