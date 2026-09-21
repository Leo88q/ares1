import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { decodeEvent, decodeTransaction } from '../src/event-decoder.js';
import { health } from '../src/health.js';
import { initialCursor } from '../src/model.js';
import type { PgStore } from '../src/store.js';
import { config, fixtureEvents, programId, sig, transaction } from './helpers.js';

test('every supported normalized event and Unknown satisfies the published JSON Schema', () => {
  const schema = JSON.parse(readFileSync(new URL('../events/schema.json', import.meta.url), 'utf8'));
  const validator = new Ajv({ strict: false }); validator.addSchema(schema);
  const check = validator.getSchema(schema.$id + '#/definitions/normalizedEvent')!;
  for (const f of fixtureEvents) assert(check(decodeEvent(f.base64)), validator.errorsText(check.errors));
  const unknown = decodeEvent('/w==');
  assert(check(unknown), validator.errorsText(check.errors)); assert.equal(unknown.data.rawBase64, '/w==');
});
test('invalid Borsh boolean is not treated as true', () => {
  const value = Buffer.from(fixtureEvents.find(f => f.onChainEvent === 'PausedToggled')!.base64, 'base64');
  value[8] = 2;
  assert.equal(decodeEvent(value.toString('base64')).eventType, 'Unknown');
});
test('raw instruction indices remain distinct for repeated top-level invocations', () => {
  const tx = transaction();
  tx.transaction.message.instructions.push({ ...tx.transaction.message.instructions[0]! });
  tx.meta!.logMessages!.push(...tx.meta!.logMessages!);
  const frames = decodeTransaction(tx, sig(1), programId).frames;
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map(f => [f.instructionIndex, f.innerIndex]), [[0, -1], [1, -1]]);
});
test('outer instruction index includes preceding instructions without program logs', () => {
  const tx = transaction();
  tx.transaction.message.instructions.unshift({ programIdIndex: 1, data: '' });
  assert.equal(decodeTransaction(tx, sig(1), programId).frames[0]!.instructionIndex, 1);
});
test('readiness distinguishes caught-up finalized scan, stale heartbeat, gaps and mock mode', async () => {
  const state = { ...initialCursor(), phase: 'tail' as const, reconciledSlot: 100, lastSuccessAt: new Date().toISOString() };
  const issues: { code: string }[] = [];
  const store = { checkpoint: async () => ({ version: 1, state }), issues: async () => issues } as unknown as PgStore;
  const runtime = { finalizedTip: 100, lastError: null, accountVerified: true };
  const live = await health(config(), store, runtime); assert(live.ready); assert.equal(live.finalizedLag, 0);
  state.lastSuccessAt = new Date(0).toISOString();
  const stale = await health(config(), store, runtime); assert(!stale.ready); assert.equal(stale.finalizedLag, null);
  state.lastSuccessAt = new Date().toISOString(); issues.push({ code: 'TRANSACTION_GAP' });
  assert(!(await health(config(), store, runtime)).ready); issues.length = 0;
  assert(!(await health({ ...config(), provider: 'mock', source: 'synthetic' }, store, runtime)).ready);
});

test('missing all logs for a successful ARES instruction is a gap, not zero events', () => {
  const tx = transaction(); tx.meta!.logMessages = [];
  assert.throws(() => decodeTransaction(tx, sig(1), programId), /MISSING_PROGRAM_INVOCATION/);
});
