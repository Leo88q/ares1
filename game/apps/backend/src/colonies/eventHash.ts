import { createHash } from 'node:crypto';

export const COLONY_GENESIS_HASH = '0'.repeat(64);

export interface ColonyEventPayload {
  colonyId: string;
  sequence: number;
  requestId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value) ?? 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error('Colony event numbers must be finite safe integers');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('Colony event payload must use plain objects');
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new Error('Colony event payload must contain JSON values only');
}

export function hashColonyEvent(previousHash: string, event: ColonyEventPayload): string {
  if (!/^[0-9a-f]{64}$/.test(previousHash)) throw new Error('Invalid previous colony event hash');
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error('Colony sequence must be a positive safe integer');
  if (!/^[a-z][a-z0-9_]{2,48}$/.test(event.eventType)) throw new Error('Invalid colony event type');
  return createHash('sha256').update([
    previousHash,
    event.colonyId,
    String(event.sequence),
    event.requestId,
    event.eventType,
    canonicalJson(event.payload),
  ].join('|')).digest('hex');
}

export interface StoredColonyEvent extends ColonyEventPayload {
  previousHash: string;
  eventHash: string;
}

export function verifyColonyEventChain(events: readonly StoredColonyEvent[], startHash = COLONY_GENESIS_HASH): boolean {
  let previousHash = startHash;
  let sequence = 1;
  for (const event of events) {
    if (event.sequence !== sequence || event.previousHash !== previousHash) return false;
    const actual = hashColonyEvent(previousHash, event);
    if (actual !== event.eventHash) return false;
    previousHash = actual;
    sequence += 1;
  }
  return true;
}
