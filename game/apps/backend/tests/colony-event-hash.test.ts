import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLONY_GENESIS_HASH, canonicalJson, hashColonyEvent, verifyColonyEventChain } from '../src/colonies/eventHash.js';

test('colony event hashing canonicalizes object key order and verifies an append-only chain', () => {
  assert.equal(canonicalJson({ z: 2, a: { y: true, x: 'ok' } }), '{"a":{"x":"ok","y":true},"z":2}');
  const first = {
    colonyId: '00000000-0000-4000-8000-000000000001', sequence: 1,
    requestId: '00000000-0000-4000-8000-000000000101', eventType: 'colony_initialized',
    payload: { field: 'F', starter: true },
  };
  const firstHash = hashColonyEvent(COLONY_GENESIS_HASH, first);
  const second = {
    colonyId: first.colonyId, sequence: 2,
    requestId: '00000000-0000-4000-8000-000000000102', eventType: 'lab_research_started',
    payload: { research: 'R1' },
  };
  const secondHash = hashColonyEvent(firstHash, second);
  assert.equal(verifyColonyEventChain([
    { ...first, previousHash: COLONY_GENESIS_HASH, eventHash: firstHash },
    { ...second, previousHash: firstHash, eventHash: secondHash },
  ]), true);
  assert.equal(verifyColonyEventChain([
    { ...first, previousHash: COLONY_GENESIS_HASH, eventHash: firstHash },
    { ...second, previousHash: firstHash, eventHash: 'f'.repeat(64) },
  ]), false);
});

test('colony event canonical form rejects floats, undefined and non-plain objects', () => {
  assert.throws(() => canonicalJson({ amount: 0.5 }), /safe integers/);
  assert.throws(() => canonicalJson({ amount: undefined }), /JSON values/);
  assert.throws(() => canonicalJson(new Date()), /plain objects/);
  assert.throws(() => hashColonyEvent(COLONY_GENESIS_HASH, {
    colonyId: 'x', sequence: 0, requestId: 'r', eventType: 'invalid', payload: {},
  }), /positive safe integer/);
});
