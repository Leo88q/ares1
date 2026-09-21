import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ingestion } from '../src/ingestion.js';
import { config, MemoryStore, sig, transaction } from './helpers.js';
import type { ReadMethod, ReadRpc } from '../src/rpc.js';
class RpcMock implements ReadRpc {
  signatures = [4, 3, 2, 1]; missing = false; anchorGone = false;
  tip = 10; calls: string[] = [];
  async call<T>(method: ReadMethod, params: unknown[] = []): Promise<T> {
    this.calls.push(method);
    if (method === 'getAccountInfo') return { value: { executable: true } } as T;
    if (method === 'getSlot') return this.tip as T;
    if (method === 'getSignaturesForAddress') {
      const q = params[1] as { before?: string; limit: number; commitment: string };
      assert.equal(q.commitment, 'finalized');
      const start = q.before ? this.signatures.findIndex(n => sig(n) === q.before) + 1 : 0;
      return (this.anchorGone ? [] : this.signatures.slice(start, start + q.limit).map(n => ({ signature: sig(n), slot: n, err: null, blockTime: 1700000000 + n }))) as T;
    }
    if (method === 'getTransaction') {
      assert.equal((params[1] as { commitment: string }).commitment, 'finalized');
      return (this.missing ? null : transaction(this.signatures.find(n => sig(n) === params[0])!)) as T;
    }
    throw new Error('unexpected method');
  }
}
test('backfill, durable resume after restart, replay, tail scan, finalized head reconciliation', async () => {
  const store = new MemoryStore(); const rpc = new RpcMock();
  const first = new Ingestion(config(), rpc, store);
  assert.equal(await first.step(), false);
  assert.equal(store.value.state.before, sig(3)); assert.equal(store.events.size, 2);
  const restarted = new Ingestion(config(), rpc, store);
  assert.equal(await restarted.step(), false);
  assert.equal(store.events.size, 4);
  assert.equal(await restarted.step(), true);
  assert.equal(store.value.state.head, sig(4)); assert.equal(store.value.state.reconciledSlot, 10);
  assert.equal(await restarted.step(), true); // replay boundary, no duplicate
  assert.equal(store.events.size, 4);
  rpc.signatures.unshift(5); rpc.tip = 12;
  assert.equal(await restarted.step(), true);
  assert.equal(store.events.size, 5); assert.equal(store.value.state.head, sig(5));
  assert.equal(store.value.state.reconciledSlot, 12);
});
test('missing transaction creates gap, leaves cursor untouched and heals only after successful replay', async () => {
  const store = new MemoryStore(); const rpc = new RpcMock(); rpc.missing = true;
  const engine = new Ingestion(config(), rpc, store);
  await assert.rejects(engine.step(), /TRANSACTION_GAP/);
  assert.equal(store.value.version, 0); assert.equal(store.events.size, 0); assert(store.gaps.has('TRANSACTION_GAP'));
  rpc.missing = false; await engine.step(); assert.equal(store.gaps.size, 0);
});
test('write failure leaves same page retryable; scanner never advances cursor itself', async () => {
  const store = new MemoryStore(); const rpc = new RpcMock(); store.fail = true;
  const engine = new Ingestion(config(), rpc, store);
  await assert.rejects(engine.step()); assert.equal(store.value.version, 0);
  store.fail = false; await engine.step(); assert.equal(store.events.size, 2);
});
test('missing history anchor fails closed, not a falsely successful catch-up', async () => {
  const store = new MemoryStore(); const rpc = new RpcMock(); const engine = new Ingestion(config(), rpc, store);
  await engine.step(); await engine.step(); await engine.step();
  const version = store.value.version; rpc.anchorGone = true;
  await assert.rejects(engine.step(), /HISTORY_ANCHOR_GAP/); assert.equal(store.value.version, version);
});
test('RPC behind reconciled finalized watermark is rejected', async () => {
  const store = new MemoryStore(); const rpc = new RpcMock(); const engine = new Ingestion(config(), rpc, store);
  await engine.step(); await engine.step(); await engine.step(); rpc.tip = 9;
  await assert.rejects(engine.step(), /RPC_BEHIND_WATERMARK/);
});

test('finalized root advancing between RPC calls is rechecked without dropping the new page', async () => {
  const store = new MemoryStore(); let rootReads = 0;
  const rpc: ReadRpc = { async call<T>(method: ReadMethod): Promise<T> {
    if (method === 'getAccountInfo') return { value: { executable: true } } as T;
    if (method === 'getSlot') return (++rootReads === 1 ? 10 : 12) as T;
    if (method === 'getSignaturesForAddress') return [{ signature: sig(11), slot: 11, blockTime: 1700000011, err: null }] as T;
    if (method === 'getTransaction') return transaction(11) as T;
    throw new Error('unexpected method');
  } };
  await new Ingestion(config(), rpc, store).step();
  assert.equal(rootReads, 2); assert(store.events.has(sig(11))); assert.equal(store.gaps.size, 0);
});
