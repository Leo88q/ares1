import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig, manifest, SafeError } from '../src/config.js';
import { Rpc, DEVNET_GENESIS } from '../src/rpc.js';
import { decodeTransaction } from '../src/event-decoder.js';
import { signatureSchema } from '../src/ingestion.js';
import type { Transaction, SignatureInfo } from '../src/model.js';

// Read-only live evidence. Never edits the deployment manifest or publishes it.
const stop = new AbortController();
const timeout = setTimeout(() => stop.abort(), 60000);
try {
  const config = loadConfig();
  if (config.provider !== 'rpc') throw new SafeError('LIVE_RPC_REQUIRED');
  const rpc = new Rpc(config.rpcUrls, config.rpcTimeoutMs, stop.signal);
  const account = await rpc.call<{ value: { executable: boolean } | null }>('getAccountInfo', [config.programId, { commitment: 'finalized', encoding: 'base64' }]);
  if (!account.value?.executable) throw new SafeError('PROGRAM_NOT_EXECUTABLE');
  const page = await rpc.call<SignatureInfo[]>('getSignaturesForAddress', [config.programId, { commitment: 'finalized', limit: 20 }]);
  const candidate = page.find(x => x.err === null);
  if (!candidate || !signatureSchema.safeParse(candidate.signature).success) throw new SafeError('NO_REAL_TRANSACTION_SAMPLE');
  const tx = await rpc.call<Transaction | null>('getTransaction', [candidate.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
  if (!tx) throw new SafeError('TRANSACTION_GAP');
  const decoded = decodeTransaction(tx, candidate.signature, config.programId);
  const expected = decoded.frames.flatMap(f => f.events.map(e => ({ event: e.decoded, applied: f.applied })));
  if (!expected.some(e => e.applied && e.event.eventType !== 'Unknown')) throw new SafeError('NO_KNOWN_APPLIED_EVENT');
  const base = new URL(process.env.WATCHTOWER_VERIFY_EXPORTER_URL ?? `http://127.0.0.1:${config.port}`);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new SafeError('INVALID_EXPORTER_URL');
  const get = async (path: string) => {
    const response = await fetch(new URL(path, base), { redirect: 'error', signal: stop.signal,
      headers: { Authorization: `Bearer ${config.token}` } });
    if (!response.ok) throw new SafeError('EXPORTER_NOT_READY');
    const body = await response.json();
    if (body.source !== 'native-rpc' || body.commitment !== 'finalized') throw new SafeError('WRONG_EXPORTER_SOURCE');
    return body;
  };
  await get('/watchtower/readyz');
  const events = await get(`/watchtower/events/${candidate.signature}?limit=200`);
  const observed = events.data.events.map((e: { event: unknown; applied: boolean }) => ({ event: e.event, applied: e.applied }));
  if (events.data.hasMore || !isDeepStrictEqual(observed, expected)) throw new SafeError('SMOKE_EVENTS_MISMATCH');
  const checkedAt = new Date().toISOString();
  if (process.argv.includes('--capture-fixture')) {
    writeFileSync(new URL(`../events/fixtures/real-devnet/${candidate.signature}.json`, import.meta.url), JSON.stringify({
      provenance: 'real-devnet', cluster: 'devnet', genesisHash: DEVNET_GENESIS, commitment: 'finalized',
      programId: config.programId, signature: candidate.signature, slot: tx.slot, collectedAt: checkedAt,
      idlSha256: manifest.idlSha256, transaction: tx,
    }, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ result: 'runtime_smoke_pass', checkedAt, programId: config.programId,
    signature: candidate.signature, slot: tx.slot, events: expected.length, commitment: 'finalized',
    deploymentManifestVerified: manifest.deploymentVerified, watchtowerConnected: false,
    note: 'Account inventory, deployed binary provenance and central Watchtower handshake remain separate gates.' }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ result: 'runtime_smoke_failed', code: error instanceof SafeError ? error.code : 'VERIFICATION_UNAVAILABLE',
    deploymentManifestVerified: false, watchtowerConnected: false }));
  process.exitCode = 1;
} finally { clearTimeout(timeout); stop.abort(); }
