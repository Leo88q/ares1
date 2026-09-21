import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Rpc, DEVNET_GENESIS, type ReadMethod } from '../src/rpc.js';
async function mock(run: (url: string, calls: string[]) => Promise<void>, respond: (attempt: number) => { status?: number; result?: unknown; hang?: boolean }) {
  const calls: string[] = []; let attempt = 0;
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const { id, method } = JSON.parse(text); calls.push(method);
    const reply = method === 'getGenesisHash' ? { result: DEVNET_GENESIS } : respond(++attempt);
    if (reply.hang) return;
    res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: reply.result }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
for (const status of [429, 500, 503]) test(`RPC ${status} retries with backoff and recovers`, async () => {
  await mock(async (url, calls) => {
    const waits: number[] = [];
    const rpc = new Rpc([url], 1000, new AbortController().signal, undefined, async ms => { waits.push(ms); });
    assert.equal(await rpc.call('getSlot'), 42);
    assert.equal(calls.filter(x => x === 'getSlot').length, 3);
    assert.equal(waits.length, 2); assert(waits[1]! > waits[0]!);
  }, n => n < 3 ? { status } : { result: 42 });
});
test('RPC timeout exhausts bounded retries, shutdown aborts requests, no provider detail leaks', async () => {
  await mock(async (url, calls) => {
    const stop = new AbortController();
    const rpc = new Rpc([url], 100, stop.signal, undefined, async () => {});
    await assert.rejects(rpc.call('getSlot'), { message: 'RPC_TIMEOUT' });
    assert.equal(calls.filter(x => x === 'getSlot').length, 4);
    const pending = rpc.call('getSlot'); stop.abort();
    await assert.rejects(pending, /SHUTDOWN/);
  }, () => ({ hang: true }));
});
test('RPC fallback is validated against devnet genesis, not blindly trusted', async () => {
  let endpointCalls = 0;
  const rpc = new Rpc(['https://primary.invalid', 'https://fallback.invalid'], 100, new AbortController().signal, undefined, async () => {},
    (async (url, options) => {
      endpointCalls++;
      const body = JSON.parse(String(options?.body));
      if (String(url).includes('primary')) return new Response('', { status: 503 });
      return Response.json({ jsonrpc: '2.0', id: body.id, result: 'not-devnet' });
    }) as typeof fetch);
  await assert.rejects(rpc.call('getSlot'), /RPC_CLUSTER_MISMATCH/); assert.equal(endpointCalls, 2);
});
test('runtime RPC allowlist rejects blockchain writes before any transport call', async () => {
  let calls = 0;
  const rpc = new Rpc(['http://unused.invalid'], 100, new AbortController().signal, undefined, async () => {},
    (async () => { calls++; throw new Error('should not run'); }) as typeof fetch);
  for (const method of ['sendTransaction', 'sendRawTransaction', 'requestAirdrop', 'simulateTransaction']) {
    await assert.rejects(rpc.call(method as ReadMethod), /RPC_METHOD_FORBIDDEN/);
  }
  assert.equal(calls, 0);
});
