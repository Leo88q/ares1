import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { decodeEvent, decodeTransaction, idl } from '../src/event-decoder.js';
import { eventMap } from '../src/event-normalizer.js';
import { fixtureEvents, transaction, programId, otherProgram, sig } from './helpers.js';

test('packaged event-only IDL matches the repository compiled IDL exactly', () => {
  const raw = readFileSync(new URL('../../game/apps/web/src/idl.json', import.meta.url));
  const full = JSON.parse(raw.toString());
  assert.equal(createHash('sha256').update(raw).digest('hex'), idl.sourceIdlSha256);
  assert.deepEqual(idl.events, full.events);
  assert.deepEqual(idl.types, full.types.filter((t: { name: string }) => idl.events.some(e => e.name === t.name)));
  assert.deepEqual(idl.instructionDiscriminators, Object.fromEntries(full.instructions.map((i: { name: string; discriminator: number[] }) => [i.name, i.discriminator])));
  assert.deepEqual(eventMap.map(e => e.on_chain_event).sort(), idl.events.map(e => e.name).sort());
});
for (const fixture of fixtureEvents) test(`synthetic IDL decoder: ${fixture.onChainEvent}`, () => {
  assert.equal(fixture.provenance, 'synthetic');
  const decoded = decodeEvent(fixture.base64, 'buy_field_skr');
  assert.equal(decoded.onChainEvent, fixture.onChainEvent);
  assert.deepEqual(decoded.data, fixture.expected);
  assert.notEqual(decoded.eventType, 'Unknown');
  assert.equal(decoded.confidence, 'partial');
});
test('unknown discriminator, malformed and evolved payloads are retained as Unknown', () => {
  const sample = fixtureEvents[0]!.base64;
  for (const data of ['not-base64!', Buffer.alloc(16, 255).toString('base64'), Buffer.from(sample, 'base64').subarray(0, 9).toString('base64'), Buffer.concat([Buffer.from(sample, 'base64'), Buffer.of(0)]).toString('base64')]) {
    assert.equal(decodeEvent(data).eventType, 'Unknown');
    assert.equal(decodeEvent(data).parserVersion, 'ares1-raw-v1');
  }
});
test('SOL and SKR presales are distinguished by emitting instruction, never field name', () => {
  const sample = fixtureEvents.find(f => f.onChainEvent === 'PresalePurchase')!;
  assert.equal(decodeEvent(sample.base64, 'buy_field_skr').resource, 'SKR');
  assert.equal(decodeEvent(sample.base64, 'buy_field_sol').resource, 'SOL');
  assert.equal(decodeEvent(sample.base64).resource, null);
  for (const [instruction, currency] of [['buy_field_sol', 'SOL'], ['buy_field_skr', 'SKR']]) {
    const tx = transaction(1, ['PresalePurchase'], instruction);
    assert.equal(decodeTransaction(tx, sig(1), programId).frames[0]!.events[0]!.decoded.resource, currency);
  }
});
test('multiple events and unknown payloads in one invocation never collide', () => {
  const tx = transaction(1, ['Harvested', 'TreasuryTaxed']);
  tx.meta!.logMessages!.splice(2, 0, 'Program data: /w==');
  const result = decodeTransaction(tx, sig(1), programId);
  assert.equal(result.frames.length, 1);
  assert.deepEqual(result.frames[0]!.events.map(e => e.decoded.eventType), ['CropHarvested', 'Unknown', 'TreasuryDeposited']);
  assert.equal(result.frames[0]!.events[1]!.raw, '/w==');
});
test('spoofed external logs are ignored, CPI attributed to RPC inner index and parent failure propagates', () => {
  const tx = transaction(); const payload = fixtureEvents[0]!.base64;
  tx.transaction.message.instructions[0]!.programIdIndex = 1;
  tx.meta!.innerInstructions = [{ index: 0, instructions: [{ programIdIndex: 0, data: bs58.encode(Buffer.from(idl.instructionDiscriminators.harvest!)), stackHeight: 2 }] }];
  tx.meta!.logMessages = [`Program ${otherProgram} invoke [1]`, `Program data: ${payload}`,
    `Program ${programId} invoke [2]`, `Program data: ${payload}`, `Program ${programId} success`, `Program ${otherProgram} success`];
  const frame = decodeTransaction(tx, sig(1), programId).frames[0]!;
  assert.equal(frame.innerIndex, 0); assert.equal(frame.events.length, 1); assert.equal(frame.applied, true);
  tx.meta!.logMessages[5] = `Program ${otherProgram} failed: synthetic`;
  tx.meta!.err = { InstructionError: [0, 'Custom'] };
  assert.equal(decodeTransaction(tx, sig(1), programId).frames[0]!.applied, false);
});
test('log truncation and missing metadata block cursor advancement instead of silently losing events', () => {
  const tx = transaction();
  tx.meta!.logMessages!.pop();
  assert.throws(() => decodeTransaction(tx, sig(1), programId), /LOG_GAP/);
  tx.meta!.logMessages = null;
  assert.throws(() => decodeTransaction(tx, sig(1), programId), /MISSING_TRANSACTION_METADATA/);
});
