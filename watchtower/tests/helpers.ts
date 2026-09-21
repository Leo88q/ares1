import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { loadConfig } from '../src/config.js';
import { idl } from '../src/event-decoder.js';
import type { Checkpoint, CursorState, ObservedTransaction, Store, Transaction } from '../src/model.js';
import { initialCursor } from '../src/model.js';
export const fixtureEvents: { provenance: string; onChainEvent: string; base64: string; expected: Record<string, unknown> }[] =
  JSON.parse(readFileSync(new URL('../events/fixtures/synthetic/idl-events.json', import.meta.url), 'utf8'));
export const sig = (n: number) => bs58.encode(Buffer.alloc(64, n));
export const programId = idl.address;
export const otherProgram = bs58.encode(Buffer.alloc(32, 2));
export function config() {
  return loadConfig({ WATCHTOWER_EXPORTER_TOKEN: 'test'.repeat(10), WATCHTOWER_DATABASE_URL: process.env.WATCHTOWER_TEST_DATABASE_URL ?? 'postgres://unused.invalid/test',
    WATCHTOWER_EVENT_PROVIDER: 'rpc', WATCHTOWER_RPC_URL: 'http://rpc.invalid', WATCHTOWER_PAGE_SIZE: '2' });
}
export function transaction(n = 1, names = ['Harvested'], instruction = 'harvest'): Transaction {
  return { slot: n, blockTime: 1700000000 + n,
    transaction: { signatures: [sig(n)], message: { accountKeys: [programId, otherProgram],
      instructions: [{ programIdIndex: 0, data: bs58.encode(Buffer.from(idl.instructionDiscriminators[instruction]!)) }] } },
    meta: { err: null, innerInstructions: [], logMessages: [
      `Program ${programId} invoke [1]`, ...names.map(name => `Program data: ${fixtureEvents.find(x => x.onChainEvent === name)!.base64}`),
      `Program ${programId} success`,
    ] } };
}
export class MemoryStore implements Store {
  value: Checkpoint = { version: 0, state: initialCursor() };
  events = new Map<string, ObservedTransaction>();
  gaps = new Set<string>();
  fail = false;
  async checkpoint() { return structuredClone(this.value); }
  async savePage(txs: ObservedTransaction[], state: CursorState, version: number) {
    if (this.fail || version !== this.value.version) throw new Error('test write failure');
    // This test fake is used only for scanner logic, not to claim PG atomicity.
    for (const tx of txs) this.events.set(tx.signature, tx);
    this.value = { version: version + 1, state: structuredClone(state) };
  }
  async gap(code: string) { this.gaps.add(code); }
  async heal() { this.gaps.clear(); }
}
