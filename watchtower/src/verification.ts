import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { SafeError, type Config } from './config.js';
import { PARSER_VERSION } from './artifacts.js';
import { decodeTransaction } from './event-decoder.js';
import { signatureSchema } from './ingestion.js';
import { DEVNET_GENESIS, type ReadRpc } from './rpc.js';
import type { Transaction } from './model.js';

const slot = z.number().int().nonnegative().safe();
const baseEnvelope = z.object({
  source: z.literal('native-rpc'), commitment: z.literal('finalized'),
  finalizedLag: slot.nullable(), dataQuality: z.literal('partial'), confidence: z.literal('partial'),
  parserVersion: z.literal(PARSER_VERSION), nextCursor: z.string().min(1).max(2048).nullable(),
});
const safeConfigEnvelope = baseEnvelope.extend({ data: z.object({
  gameId: z.literal('ares1'), network: z.literal('devnet'), programConfigured: z.literal(true),
  deploymentVerified: z.boolean(), dataQuality: z.literal('partial'), writes: z.literal(false),
}).strict() }).strict();
const readyEnvelope = baseEnvelope.extend({ data: z.object({
  ready: z.literal(true), database: z.literal('up'), mode: z.literal('rpc'), phase: z.literal('tail'),
  finalizedLag: slot, issues: z.array(z.unknown()).length(0), lastSuccessAt: z.string().datetime(),
  historyCoverage: z.literal('provider_available_only'), error: z.null(),
}).strict() }).strict();
const rowSchema = z.object({
  id: z.string().regex(/^[1-9][0-9]{0,18}$/).refine(s => BigInt(s) <= 9223372036854775807n),
  signature: signatureSchema, slot: z.string().regex(/^(0|[1-9][0-9]*)$/).max(16),
  programId: z.string(), instructionIndex: slot, innerIndex: z.number().int().min(-1).safe(),
  logIndex: slot, applied: z.boolean(), event: z.unknown(), blockTime: z.string().datetime().nullable(),
  commitment: z.literal('finalized'),
}).strict();
const eventsEnvelope = baseEnvelope.extend({ data: z.object({
  events: z.array(rowSchema).max(200), hasMore: z.boolean(), coverage: z.literal('provider_available_only'),
}).strict() }).strict();
const signaturePage = z.array(z.object({ signature: signatureSchema, slot,
  err: z.unknown().refine(value => value !== undefined), blockTime: z.number().int().safe().nullable(),
})).max(20);

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SafeError(code);
  return result.data;
}

export function exporterOrigin(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new SafeError('INVALID_EXPORTER_URL'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // Bearer credentials must not travel over remote plaintext HTTP or redirects.
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new SafeError('INVALID_EXPORTER_URL');
  }
  return url;
}

async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) { await response.body?.cancel(); throw new SafeError('EXPORTER_NOT_READY'); }
  if (!response.body) throw new SafeError('INVALID_EXPORTER_RESPONSE');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new SafeError('EXPORTER_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new SafeError('INVALID_EXPORTER_RESPONSE'); }
}

/** A read-only runtime smoke, NOT deployment/binary verification or central admission. */
export async function verifyDevnet(config: Config, rpc: ReadRpc, options: {
  exporterUrl: string; signal: AbortSignal; fetcher?: typeof fetch; now?: () => number;
}) {
  if (config.provider !== 'rpc') throw new SafeError('LIVE_RPC_REQUIRED');
  if (options.signal.aborted) throw new SafeError('SHUTDOWN');
  const origin = exporterOrigin(options.exporterUrl); // validate before any credential-bearing request
  const now = options.now ?? Date.now;
  const get = async (path: string): Promise<unknown> => {
    try {
      if (options.signal.aborted) throw new SafeError('SHUTDOWN');
      const response = await (options.fetcher ?? fetch)(new URL(path, origin), {
        redirect: 'error', signal: AbortSignal.any([options.signal, AbortSignal.timeout(config.rpcTimeoutMs)]),
        headers: { Authorization: `Bearer ${config.token}` },
      });
      return await jsonResponse(response);
    } catch (error) {
      if (options.signal.aborted) throw new SafeError('SHUTDOWN');
      if (error instanceof SafeError) throw error;
      throw new SafeError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'EXPORTER_TIMEOUT' : 'EXPORTER_UNAVAILABLE');
    }
  };
  if (await rpc.call('getGenesisHash') !== DEVNET_GENESIS) throw new SafeError('RPC_CLUSTER_MISMATCH');
  parse(z.object({ value: z.object({ executable: z.literal(true) }) }),
    await rpc.call('getAccountInfo', [config.programId, { commitment: 'finalized', encoding: 'base64' }]), 'PROGRAM_NOT_EXECUTABLE');
  const checkReady = async () => {
    const ready = parse(readyEnvelope, await get('/watchtower/readyz'), 'INVALID_EXPORTER_READINESS');
    const age = now() - Date.parse(ready.data.lastSuccessAt);
    if (age < -60000 || age >= Math.max(config.pollMs * 3, 60000) || ready.finalizedLag !== ready.data.finalizedLag) {
      throw new SafeError('STALE_EXPORTER_READINESS');
    }
  };
  parse(safeConfigEnvelope, await get('/watchtower/config'), 'WRONG_EXPORTER_CONFIG');
  await checkReady();
  const page = parse(signaturePage, await rpc.call('getSignaturesForAddress', [config.programId,
    { commitment: 'finalized', limit: 20 }]), 'INVALID_SIGNATURE_PAGE');
  if (new Set(page.map(info => info.signature)).size !== page.length) throw new SafeError('INVALID_SIGNATURE_PAGE');
  // A successful transaction can legitimately have no events. Search a bounded
  // sample instead of declaring failure merely because the latest one is silent.
  for (const candidate of page) {
    if (candidate.err !== null) continue;
    const tx = await rpc.call<Transaction | null>('getTransaction', [candidate.signature,
      { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    if (!tx) throw new SafeError('TRANSACTION_GAP');
    const tip = parse(slot, await rpc.call('getSlot', [{ commitment: 'finalized' }]), 'INVALID_FINALIZED_SLOT');
    if (tx.slot !== candidate.slot || tx.slot > tip) throw new SafeError('FINALIZED_SLOT_MISMATCH');
    if (!tx.meta || tx.meta.err !== null || tx.blockTime !== candidate.blockTime) throw new SafeError('TRANSACTION_METADATA_MISMATCH');
    const decoded = decodeTransaction(tx, candidate.signature, config.programId);
    const time = tx.blockTime === null ? null : new Date(tx.blockTime * 1000);
    if (time && !Number.isFinite(time.getTime())) throw new SafeError('TRANSACTION_METADATA_MISMATCH');
    const expected = decoded.frames.flatMap(f => f.events.map(e => ({
      signature: candidate.signature, slot: String(tx.slot), programId: config.programId,
      instructionIndex: f.instructionIndex, innerIndex: f.innerIndex, logIndex: e.logIndex,
      event: e.decoded, applied: f.applied, blockTime: time?.toISOString() ?? null, commitment: 'finalized',
    })));
    if (!expected.some(e => e.applied && e.event.eventType !== 'Unknown')) continue;
    const observed: Omit<z.infer<typeof rowSchema>, 'id'>[] = [];
    const cursors = new Set<string>(); let cursor: string | null = null; let previousId = 0n;
    for (let n = 0; n < 100; n++) {
      const query: string = `/watchtower/events/${candidate.signature}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response: z.infer<typeof eventsEnvelope> = parse(eventsEnvelope, await get(query), 'INVALID_EXPORTER_EVENTS');
      for (const row of response.data.events) {
        if (BigInt(row.id) <= previousId) throw new SafeError('INVALID_EXPORTER_PAGINATION');
        previousId = BigInt(row.id);
        const { id: _, ...value } = row; observed.push(value);
      }
      if (observed.length > expected.length) throw new SafeError('SMOKE_EVENTS_MISMATCH');
      if (!response.data.hasMore) break;
      if (!response.data.events.length || !response.nextCursor || cursors.has(response.nextCursor) || n === 99) {
        throw new SafeError('INVALID_EXPORTER_PAGINATION');
      }
      cursors.add(response.nextCursor); cursor = response.nextCursor;
    }
    if (!isDeepStrictEqual(observed, expected)) throw new SafeError('SMOKE_EVENTS_MISMATCH');
    await checkReady(); // a healthy first response must not mask a failure during pagination
    return { transaction: tx, signature: candidate.signature, slot: tx.slot, events: expected.length,
      unknownEvents: expected.filter(e => e.event.eventType === 'Unknown').length, checkedAt: new Date(now()).toISOString() };
  }
  throw new SafeError('NO_KNOWN_APPLIED_EVENT');
}
