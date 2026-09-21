import { test } from 'node:test';
import { Ajv } from 'ajv';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DEVNET_GENESIS } from '../src/rpc.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { PgStore } from '../src/store.js';
import { decodeTransaction } from '../src/event-decoder.js';
import { initialCursor } from '../src/model.js';
import { api } from '../src/api.js';
import { Metrics } from '../src/metrics.js';
import { config, transaction, sig, programId } from './helpers.js';

const schema = JSON.parse(readFileSync(new URL('../events/schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false });
const validEnvelope = ajv.compile(schema);
const validEvent = ajv.getSchema(schema.$id + '#/definitions/eventRow')!;
const database = process.env.WATCHTOWER_TEST_DATABASE_URL;
if (process.env.WATCHTOWER_REQUIRE_TEST_DATABASE === 'true' && !database) throw new Error('WATCHTOWER_TEST_DATABASE_URL is required');
if (database && new URL(database).pathname !== '/watchtower_test') throw new Error('Refusing destructive tests outside watchtower_test database');

test('real PostgreSQL transactional/read-model/API integration', { skip: !database }, async t => {
  const cfg = { ...config(), source: 'synthetic' as const, provider: 'mock' as const };
  const store = new PgStore(cfg);
  await store.pool.query('DROP SCHEMA IF EXISTS watchtower CASCADE');
  await store.pool.query(readFileSync(new URL('../migrations/watchtower-read-model.sql', import.meta.url), 'utf8'));
  await store.initialize();
  const observation = (n = 1) => decodeTransaction(transaction(n, ['Harvested', 'TreasuryTaxed']), sig(n), programId);
  const count = async (table: string) => Number((await store.pool.query(`SELECT count(*) AS n FROM watchtower.${table}`)).rows[0].n);
  try {
    await t.test('required raw uniqueness, multiple emits, duplicate delivery and replay', async () => {
      const next = { ...initialCursor(), before: sig(1) };
      await store.savePage([observation()], next, 0);
      await store.savePage([observation()], next, 1);
      assert.equal(await count('transactions'), 1); assert.equal(await count('raw_events'), 1);
      assert.equal(await count('normalized_events'), 2); assert.equal((await store.checkpoint()).version, 2);
      const constraints = await store.pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='watchtower.raw_events'::regclass");
      assert(constraints.rows.some(r => r.definition === 'UNIQUE (cluster, slot, signature, instruction_index, inner_index)'));
      const daily = await store.daily('2023-11-16T00:00:00Z', '2023-11-13T00:00:00Z', 100);
      assert.equal(daily.length, 2); assert(daily.every(row => row.eventCount === '1'));
    });
    await t.test('injected cursor-write failure rolls back raw, normalized, audit and cursor together', async () => {
      const before = await store.checkpoint();
      await store.pool.query(`CREATE FUNCTION watchtower.fail_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic fault at cursor write'; END $$;
        CREATE TRIGGER fail_cursor BEFORE UPDATE ON watchtower.cursors FOR EACH ROW EXECUTE FUNCTION watchtower.fail_cursor()`);
      try { await assert.rejects(store.savePage([observation(2)], { ...before.state, before: sig(2) }, before.version)); }
      finally { await store.pool.query('DROP TRIGGER fail_cursor ON watchtower.cursors; DROP FUNCTION watchtower.fail_cursor()'); }
      assert.deepEqual(await store.checkpoint(), before);
      assert.equal(await count('transactions'), 1); assert.equal(await count('raw_events'), 1); assert.equal(await count('normalized_events'), 2);
      const restarted = new PgStore(cfg);
      try {
        await restarted.initialize();
        assert.deepEqual(await restarted.checkpoint(), before);
        await restarted.savePage([observation(2)], { ...before.state, before: sig(2) }, before.version);
      } finally { await restarted.close(); }
      assert.equal(await count('transactions'), 2);
    });
    await t.test('database backend termination during write rolls back and supports replay', async () => {
      const before = await store.checkpoint();
      const url = new URL(cfg.databaseUrl); url.searchParams.set('application_name', 'watchtower_crash_test');
      const crashing = new PgStore({ ...cfg, databaseUrl: url.toString() });
      await store.pool.query(`CREATE FUNCTION watchtower.pause_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(20); RETURN NEW; END $$;
        CREATE TRIGGER pause_cursor BEFORE UPDATE ON watchtower.cursors FOR EACH ROW EXECUTE FUNCTION watchtower.pause_cursor()`);
      const pending = crashing.savePage([observation(3)], { ...before.state, before: sig(3) }, before.version);
      const rejected = assert.rejects(pending);
      try {
        let pid: number | undefined;
        for (let i = 0; i < 100; i++) {
          pid = (await store.pool.query("SELECT pid FROM pg_stat_activity WHERE application_name='watchtower_crash_test' AND wait_event='PgSleep'")).rows[0]?.pid;
          if (pid) break;
          await delay(20);
        }
        assert(pid, 'write reached pause before cursor update');
        await store.pool.query('SELECT pg_terminate_backend($1)', [pid]);
        await rejected;
      } finally {
        await store.pool.query('DROP TRIGGER pause_cursor ON watchtower.cursors; DROP FUNCTION watchtower.pause_cursor()');
        await crashing.close();
      }
      assert.deepEqual(await store.checkpoint(), before); assert.equal(await count('transactions'), 2);
      await store.savePage([observation(3)], { ...before.state, before: sig(3) }, before.version);
      assert.equal(await count('transactions'), 3);
    });
    await t.test('finalized replay mismatch and concurrent stale cursor both fail closed', async () => {
      const before = await store.checkpoint();
      const changed = observation(); changed.frames[0]!.events[0]!.decoded.data.amount_micro = '1';
      await assert.rejects(store.savePage([changed], before.state, before.version), /FINALIZED_RECONCILIATION_MISMATCH/);
      assert.deepEqual(await store.checkpoint(), before);
      await assert.rejects(store.savePage([], before.state, before.version - 1), /STALE_CURSOR/);
      const countBefore = await count('audit_records');
      await store.gap('TRANSACTION_GAP'); await store.gap('TRANSACTION_GAP');
      assert.equal((await store.issues()).length, 1); assert.equal(await count('audit_records'), countBefore + 1);
      await store.heal(); assert.equal((await store.issues()).length, 0);
    });
    await t.test('unknown event survives database replay; failed invocation is excluded from projections', async () => {
      const tx = transaction(4); tx.meta!.logMessages!.splice(2, 0, 'Program data: /w==');
      tx.meta!.err = 'synthetic failure'; tx.meta!.logMessages![3] = `Program ${programId} failed: synthetic`;
      const before = await store.checkpoint();
      await store.savePage([decodeTransaction(tx, sig(4), programId)], before.state, before.version);
      const found = await store.list({ cursorId: '0', limit: 100, eventType: 'Unknown' });
      assert.equal(found.rows.length, 1); assert.equal(found.rows[0].event.parserVersion, 'ares1-raw-v1');
      assert.equal(found.rows[0].applied, false);
      const raw = await store.pool.query('SELECT payload FROM watchtower.raw_events WHERE signature=$1', [sig(4)]);
      assert.equal(raw.rows[0].payload.events[1].raw, '/w==');
      const counts = await store.counts('gameplay'); assert.equal(counts[0].observedEventCount, '3');
    });
    await t.test('authenticated HTTP endpoints, bounded filters, cursor integrity and truthful unavailable metrics', async () => {
      const server = api(cfg, store, { finalizedTip: 10, lastError: null, accountVerified: false }, new Metrics());
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/watchtower`;
      const get = (path: string, options: RequestInit = {}) => fetch(base + path, { ...options, headers: { Authorization: `Bearer ${cfg.token}`, ...options.headers } });
      const envelope = (body: Record<string, unknown>) => {
        for (const key of ['source', 'commitment', 'finalizedLag', 'dataQuality', 'confidence', 'parserVersion', 'nextCursor']) assert(key in body, key);
        assert.equal(body.source, 'synthetic');
        assert(validEnvelope(body), ajv.errorsText(validEnvelope.errors));
      };
      try {
        const denied = await fetch(base + '/config'); assert.equal(denied.status, 401); envelope(await denied.json());
        assert.equal((await get('/events', { method: 'POST' })).status, 405);
        assert.equal((await get('/readyz')).status, 503);
        for (const path of ['/health', '/config', '/metrics/daily', '/players/cohorts', '/players/retention', '/players/cross-game', '/economy', '/treasury', '/security', '/alerts', '/funnels']) {
          const response = await get(path); assert.equal(response.status, 200, path); envelope(await response.json());
        }
        const conf = await (await get('/config')).text(); assert(!conf.includes(cfg.token)); assert(!conf.includes(cfg.databaseUrl));
        const cross = await (await get('/players/cross-game')).json();
        assert.equal(cross.data.value, null); assert.equal(cross.data.reason, 'requires_identity_service');
        assert(!JSON.stringify(cross).includes('wallet')); assert(!JSON.stringify(cross).includes('playerKey'));
        const retention = await (await get('/players/retention')).json(); assert.equal(retention.data.d7.value, null);
        assert.equal(retention.data.d7.reason, 'requires_client_telemetry');
        const first = await (await get('/events?limit=1&eventType=CropHarvested&slotFrom=1&slotTo=3')).json();
        assert.equal(first.data.events.length, 1); assert(validEvent(first.data.events[0]), ajv.errorsText(validEvent.errors)); assert.equal(first.data.events[0].slot, '1');
        const query = '/events?limit=1&eventType=CropHarvested&slotFrom=1&slotTo=3&cursor=' + encodeURIComponent(first.nextCursor);
        const second = await (await get(query)).json(); assert.equal(second.data.events[0].slot, '2');
        assert.equal((await get(query.replace('slotTo=3', 'slotTo=4'))).status, 400);
        const bySig = await (await get('/events/' + sig(2))).json(); assert.equal(bySig.data.events.length, 2);
        const dated = await (await get('/events?after=2023-11-14T22:13:21Z&before=2023-11-14T22:13:23Z')).json();
        assert(dated.data.events.every((e: { signature: string }) => e.signature === sig(2)));
        for (const q of ['limit=201', 'limit=-1', 'commitment=confirmed', 'slotFrom=5&slotTo=1', 'limit=1&limit=2', 'eventType=%27OR%201=1', 'cursor=bogus']) {
          assert.equal((await get('/events?' + q)).status, 400, q);
        }
        const concurrent = await Promise.all(Array.from({ length: 40 }, () => get('/events?limit=2')));
        assert(concurrent.every(r => r.status === 200)); await Promise.all(concurrent.map(r => r.arrayBuffer()));
      } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
    });
    await t.test('separate exporter process: synthetic RPC → PostgreSQL → HTTP → SIGTERM, no blockchain writes', async () => {
      const methods: string[] = [];
      const rpcServer = createServer(async (req, res) => {
        let text = ''; for await (const chunk of req) text += chunk;
        const { id, method, params } = JSON.parse(text); methods.push(method);
        let result: unknown;
        if (method === 'getGenesisHash') result = DEVNET_GENESIS;
        else if (method === 'getAccountInfo') result = { value: { executable: true } };
        else if (method === 'getSlot') result = 40;
        else if (method === 'getSignaturesForAddress') result = params[1].before ? [] : [32, 31].map(n => ({ signature: sig(n), slot: n, err: null, blockTime: 1700000000 + n }));
        else if (method === 'getTransaction') result = transaction(params[0] === sig(32) ? 32 : 31);
        else { res.writeHead(400); res.end(); return; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
      });
      await new Promise<void>(r => rpcServer.listen(0, '127.0.0.1', r));
      const reserve = createServer(); await new Promise<void>(r => reserve.listen(0, '127.0.0.1', r));
      const port = (reserve.address() as AddressInfo).port;
      await new Promise<void>(r => reserve.close(() => r()));
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/watchtower-exporter.ts'], {
        cwd: new URL('..', import.meta.url), env: { ...process.env, WATCHTOWER_ENABLE_WRITES: 'false',
          WATCHTOWER_EXPORTER_TOKEN: cfg.token, WATCHTOWER_DATABASE_URL: cfg.databaseUrl,
          WATCHTOWER_RPC_URL: `http://127.0.0.1:${(rpcServer.address() as AddressInfo).port}`,
          WATCHTOWER_RPC_FALLBACK_URL: '', WATCHTOWER_EVENT_PROVIDER: 'rpc', WATCHTOWER_CLUSTER: 'devnet',
          WATCHTOWER_EXPORTER_PORT: String(port), WATCHTOWER_POLL_MS: '1000', WATCHTOWER_PAGE_SIZE: '2', WATCHTOWER_PLAYER_HASH_SALT: '',
        }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
      const exited = once(child, 'exit');
      try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
          const response = await fetch(`http://127.0.0.1:${port}/watchtower/readyz`, { headers: { Authorization: `Bearer ${cfg.token}` } }).catch(() => null);
          if (response?.ok) { const body = await response.json(); ready = true; assert.equal(body.commitment, 'finalized'); break; }
          await response?.arrayBuffer(); await delay(40);
        }
        assert(ready, 'synthetic local runtime caught up');
        const response = await fetch(`http://127.0.0.1:${port}/watchtower/events/${sig(32)}`, { headers: { Authorization: `Bearer ${cfg.token}` } });
        const events = await response.json(); assert.equal(events.data.events.length, 1);
        child.kill('SIGTERM');
        const result = await Promise.race([exited, delay(5000).then(() => { throw new Error('shutdown timed out'); })]);
        assert.equal(result[0], 0); assert.equal(result[1], null);
        assert(methods.every(m => ['getGenesisHash', 'getAccountInfo', 'getSlot', 'getSignaturesForAddress', 'getTransaction'].includes(m)));
        assert(!output.includes(cfg.token)); assert(!output.includes(cfg.databaseUrl));
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
        rpcServer.closeAllConnections(); await new Promise<void>(r => rpcServer.close(() => r()));
      }
    });
  } finally { await store.close(); }
});
