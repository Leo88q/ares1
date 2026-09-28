/**
 * Нагрузочный замер Watchtower: ingestion (RPC → decoder → PostgreSQL) + HTTP API.
 * Требует чистую схему и PostgreSQL по wire-протоколу (здесь — PGlite).
 * Запуск: node --import tsx bench-final.mjs <N_TX> [CONCURRENCY]
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import bs58 from 'bs58';
import { loadConfig } from '../src/config.js';
import { Rpc, DEVNET_GENESIS } from '../src/rpc.js';
import { PgStore } from '../src/store.js';
import { Ingestion } from '../src/ingestion.js';
import { api } from '../src/api.js';
import { Metrics } from '../src/metrics.js';
import { idl, decodeTransaction } from '../src/event-decoder.js';

const N = Number(process.argv[2] ?? 1500);
const CONCURRENCY = Number(process.argv[3] ?? 32);
const fixtureEvents = JSON.parse(readFileSync(new URL('../events/fixtures/synthetic/idl-events.json', import.meta.url), 'utf8'));
const programId = idl.address;
const otherProgram = bs58.encode(Buffer.alloc(32, 2));
const sigToN = new Map();
const sig = n => { const v = bs58.encode(Buffer.concat([Buffer.from('bench'), Buffer.alloc(57, 0), Buffer.from([n & 0xff, (n >> 8) & 0xff])])); sigToN.set(v, n); return v; };
const txOf = n => ({ slot: n, blockTime: 1_700_000_000 + n,
  transaction: { signatures: [sig(n)], message: { accountKeys: [programId, otherProgram],
    instructions: [{ programIdIndex: 0, data: bs58.encode(Buffer.from(idl.instructionDiscriminators.harvest)) }] } },
  meta: { err: null, innerInstructions: [], logMessages: [`Program ${programId} invoke [1]`,
    ...['Harvested', 'TreasuryTaxed'].map(name => `Program data: ${fixtureEvents.find(x => x.onChainEvent === name).base64}`),
    `Program ${programId} success`] } });

// 1. Чистый decoder (без сети и БД).
const decoderStart = performance.now();
const DECODED = 20_000;
for (let i = 0; i < DECODED; i++) decodeTransaction(txOf(i), sig(i), programId);
const decoder = { transactions: DECODED, seconds: (performance.now() - decoderStart) / 1000 };
decoder.transactionsPerSecond = Math.round(DECODED / decoder.seconds);
decoder.eventsPerSecond = Math.round((DECODED * 2) / decoder.seconds);

// 2. Mock JSON-RPC (только read-методы экспортёра).
const rpcCalls = new Map();
const rpcServer = createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const { id, method, params } = JSON.parse(text);
  rpcCalls.set(method, (rpcCalls.get(method) ?? 0) + 1);
  let result;
  if (method === 'getGenesisHash') result = DEVNET_GENESIS;
  else if (method === 'getAccountInfo') result = { value: { executable: true } };
  else if (method === 'getSlot') result = N + 10;
  else if (method === 'getFirstAvailableBlock') result = 1;
  else if (method === 'getSignaturesForAddress') {
    const before = params[1]?.before;
    const highest = before ? sigToN.get(before) - 1 : N;
    result = [];
    for (let n = highest; n > Math.max(0, highest - 50); n--) result.push({ signature: sig(n), slot: n, err: null, blockTime: 1_700_000_000 + n });
  } else if (method === 'getTransaction') result = txOf(sigToN.get(params[0]));
  else result = null;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
});
await new Promise(r => rpcServer.listen(0, '127.0.0.1', r));

const config = loadConfig({
  WATCHTOWER_EXPORTER_TOKEN: 'bench'.repeat(10),
  WATCHTOWER_DATABASE_URL: process.env.WATCHTOWER_TEST_DATABASE_URL,
  WATCHTOWER_EVENT_PROVIDER: 'rpc',
  WATCHTOWER_RPC_URL: `http://127.0.0.1:${rpcServer.address().port}`,
  WATCHTOWER_PAGE_SIZE: '50',
});

// 3. Ingestion до состояния «догнал» (страницы по 50 tx, атомарный savePage).
const store = new PgStore(config);
await store.initialize();
const ingest = new Ingestion(config, new Rpc(config.rpcUrls, config.rpcTimeoutMs, new AbortController().signal), store);
const ingestStart = performance.now();
let steps = 0; let caughtUp = false; const errors = [];
while (!caughtUp && steps < 500) {
  try { caughtUp = await ingest.step(); } catch (error) { errors.push(error.code ?? error.message); if (errors.length > 3) break; }
  steps += 1;
}
const ingestSeconds = (performance.now() - ingestStart) / 1000;
const rows = (await store.pool.query(
  'SELECT (SELECT count(*) FROM watchtower.transactions) t, (SELECT count(*) FROM watchtower.raw_events) r, (SELECT count(*) FROM watchtower.normalized_events) n',
)).rows[0];
const ingestion = {
  steps, caughtUp, errors, seconds: Math.round(ingestSeconds * 100) / 100,
  transactionsPerSecond: Math.round(Number(rows.t) / ingestSeconds),
  eventsPerSecond: Math.round(Number(rows.n) / ingestSeconds),
  rowsPerSecond: Math.round((Number(rows.t) + Number(rows.r) + Number(rows.n)) / ingestSeconds),
  dbRows: rows,
};

// 4. HTTP API индексатора под нагрузкой (in-process, тот же store).
const http = [];
const server = api(config, store, ingest.runtime, new Metrics());
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/watchtower`;
const headers = { Authorization: `Bearer ${config.token}` };
async function load(path, total, concurrency) {
  const latencies = []; let errors = 0; let issued = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (issued < total) {
      issued += 1;
      const t0 = performance.now();
      try { const r = await fetch(base + path, { headers }); await r.arrayBuffer(); if (!r.ok) errors += 1; } catch { errors += 1; }
      latencies.push(performance.now() - t0);
    }
  }));
  const seconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  return { path, total, concurrency, errors, seconds: Math.round(seconds * 100) / 100,
    rps: Math.round(total / seconds),
    p50: Math.round(latencies[Math.floor(latencies.length * 0.5)]),
    p95: Math.round(latencies[Math.floor(latencies.length * 0.95)]),
    p99: Math.round(latencies[Math.floor(latencies.length * 0.99)]),
    max: Math.round(latencies[latencies.length - 1]) };
}
http.push(await load('/events?limit=10', 600, CONCURRENCY));
http.push(await load('/events?limit=50', 300, CONCURRENCY));
http.push(await load('/economy', 300, CONCURRENCY));
http.push(await load('/metrics/daily?from=2023-11-14T00:00:00Z&to=2023-11-20T00:00:00Z', 200, CONCURRENCY));
const unauthorized = await fetch(`${base}/events`);
const wrongToken = await fetch(`${base}/events`, { headers: { Authorization: 'Bearer wrong' } });

console.log(JSON.stringify({
  node: process.version,
  db: 'PGlite 0.5.8 → PostgreSQL 18.3 (wasm32, один бэкенд; нижняя граница для native PG)',
  decoder, ingestion, http, status: { unauthorized: unauthorized.status, wrongToken: wrongToken.status },
  rpcCalls: Object.fromEntries(rpcCalls),
}, null, 2));
await new Promise(r => server.close(r));
rpcServer.close();
await store.close();
process.exit(0);
