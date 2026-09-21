import bs58 from 'bs58';
import { artifact } from './artifacts.js';
import { SafeError } from './config.js';
import { normalize, unknown } from './event-normalizer.js';
import type { Fields, Instruction, Normalized, ObservedTransaction, RawFrame, Transaction } from './model.js';

interface EventIdl {
  address: string; sourceIdlSha256: string;
  events: { name: string; discriminator: number[] }[];
  types: { name: string; type: { kind: string; fields: { name: string; type: string }[] } }[];
  instructionDiscriminators: Record<string, number[]>;
}
export const idl = artifact<EventIdl>('events/ares1-idl.json');
export function decodeEvent(base64: string, instructionName: string | null = null): Normalized {
  const unparsed = (reason: string): Normalized => ({ ...unknown(reason), data: { rawBase64: base64 } });
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64) return unparsed('invalid_base64');
    const event = idl.events.find(e => bytes.subarray(0, 8).equals(Buffer.from(e.discriminator)));
    if (!event) return unparsed('unknown_discriminator');
    const type = idl.types.find(t => t.name === event.name);
    if (!type || type.type.kind !== 'struct') return unparsed('unsupported_layout');
    let offset = 8;
    const data: Fields = {};
    for (const field of type.type.fields) {
      const size = ({ pubkey: 32, u64: 8, i64: 8, u32: 4, u16: 2, u8: 1, bool: 1 } as Record<string, number>)[field.type];
      if (!size || offset + size > bytes.length) return unparsed('invalid_layout');
      switch (field.type) {
        case 'pubkey': data[field.name] = bs58.encode(bytes.subarray(offset, offset + size)); break;
        case 'u64': data[field.name] = bytes.readBigUInt64LE(offset).toString(); break;
        case 'i64': data[field.name] = bytes.readBigInt64LE(offset).toString(); break;
        case 'bool':
          if (bytes[offset]! > 1) return unparsed('invalid_bool');
          data[field.name] = bytes[offset] === 1; break;
        default: data[field.name] = bytes.readUIntLE(offset, size);
      }
      offset += size;
    }
    if (offset !== bytes.length) return unparsed('layout_version_mismatch');
    return normalize(event.name, data, instructionName);
  } catch { return unparsed('invalid_layout'); }
}
function instructionName(ix: Instruction): string | null {
  try {
    const prefix = Buffer.from(bs58.decode(ix.data)).subarray(0, 8);
    return Object.entries(idl.instructionDiscriminators).find(([, d]) => prefix.equals(Buffer.from(d)))?.[0] ?? null;
  } catch { return null; }
}

// Attribute logs by invocation stack AND RPC instruction metadata. Never accept an
// ARES-looking Program data line emitted by a different program. Multiple emit!s
// share a raw instruction row; event log indices distinguish normalized children.
export function decodeTransaction(tx: Transaction, signature: string, programId: string): ObservedTransaction {
  if (!tx.meta || !tx.meta.logMessages || tx.transaction.signatures[0] !== signature || !Number.isSafeInteger(tx.slot)) {
    throw new SafeError('MISSING_TRANSACTION_METADATA');
  }
  const keys = [...tx.transaction.message.accountKeys,
    ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
  type Frame = { program: string; depth: number; parent?: Frame; succeeded: boolean; raw?: RawFrame };
  const stack: Frame[] = [];
  const all: Frame[] = [];
  let outer = -1;
  let inner = -1;
  const top = tx.transaction.message.instructions;
  for (const [logIndex, line] of tx.meta.logMessages.entries()) {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      const program = invoke[1]!;
      const depth = Number(invoke[2]);
      if (depth !== stack.length + 1) throw new SafeError('LOG_GAP');
      let ix: Instruction | undefined;
      if (depth === 1) {
        outer++;
        while (outer < top.length && keys[top[outer]!.programIdIndex] !== program) outer++;
        ix = top[outer]; inner = -1;
      } else {
        const instructions = tx.meta.innerInstructions?.find(x => x.index === outer)?.instructions ?? [];
        inner++;
        ix = instructions[inner];
      }
      if (!ix || keys[ix.programIdIndex] !== program || (ix.stackHeight != null && ix.stackHeight !== depth)) {
        throw new SafeError('INSTRUCTION_LOG_MISMATCH');
      }
      const f: Frame = { program, depth, parent: stack.at(-1), succeeded: false };
      if (program === programId) f.raw = { instructionIndex: outer, innerIndex: depth === 1 ? -1 : inner,
        instructionName: instructionName(ix), applied: false, events: [] };
      stack.push(f); all.push(f);
      continue;
    }
    const end = /^Program (\w+) (success|failed:.*)$/.exec(line);
    if (end) {
      const f = stack.pop();
      if (!f || f.program !== end[1]) throw new SafeError('LOG_GAP');
      f.succeeded = end[2] === 'success';
      continue;
    }
    if (line === 'Log truncated' || line.includes('Log truncated')) throw new SafeError('LOG_TRUNCATED');
    const f = stack.at(-1);
    if (line.startsWith('Program data: ') && f?.raw) {
      const raw = line.slice('Program data: '.length);
      f.raw.events.push({ logIndex, raw, decoded: decodeEvent(raw, f.raw.instructionName) });
    }
  }
  if (stack.length) throw new SafeError('LOG_GAP');
  if (tx.meta.err === null) {
    // A successful transaction cannot silently omit an executed ARES invocation.
    for (const [index, ix] of top.entries()) {
      if (keys[ix.programIdIndex] === programId && !all.some(f => f.raw?.instructionIndex === index && f.raw.innerIndex === -1)) {
        throw new SafeError('MISSING_PROGRAM_INVOCATION');
      }
    }
    for (const group of tx.meta.innerInstructions ?? []) {
      for (const [index, ix] of group.instructions.entries()) {
        if (keys[ix.programIdIndex] === programId && !all.some(f => f.raw?.instructionIndex === group.index && f.raw.innerIndex === index)) {
          throw new SafeError('MISSING_PROGRAM_INVOCATION');
        }
      }
    }
  }
  const frames = all.filter(f => f.raw).map(f => {
    let applied = tx.meta!.err === null;
    for (let p: Frame | undefined = f; p; p = p.parent) applied = applied && p.succeeded;
    f.raw!.applied = applied;
    return f.raw!;
  });
  return { slot: tx.slot, signature, blockTime: tx.blockTime, raw: tx, frames };
}
