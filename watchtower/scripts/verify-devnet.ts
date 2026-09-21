import { writeFileSync } from 'node:fs';
import { loadConfig, manifest, SafeError } from '../src/config.js';
import { Rpc, DEVNET_GENESIS } from '../src/rpc.js';
import { verifyDevnet } from '../src/verification.js';

// Read-only live evidence. Never edits the deployment manifest or publishes it.
const stop = new AbortController();
const timeout = setTimeout(() => stop.abort(), 60000);
try {
  const config = loadConfig();
  const rpc = new Rpc(config.rpcUrls, config.rpcTimeoutMs, stop.signal);
  const evidence = await verifyDevnet(config, rpc, {
    exporterUrl: process.env.WATCHTOWER_VERIFY_EXPORTER_URL ?? `http://127.0.0.1:${config.port}`,
    signal: stop.signal,
  });
  const { transaction: tx, signature, checkedAt } = evidence;
  if (process.argv.includes('--capture-fixture')) {
    writeFileSync(new URL(`../events/fixtures/real-devnet/${signature}.json`, import.meta.url), JSON.stringify({
      provenance: 'real-devnet', cluster: 'devnet', genesisHash: DEVNET_GENESIS, commitment: 'finalized',
      programId: config.programId, signature, slot: tx.slot, collectedAt: checkedAt,
      idlSha256: manifest.idlSha256, transaction: tx,
    }, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ result: 'runtime_smoke_pass', checkedAt, programId: config.programId,
    signature, slot: tx.slot, events: evidence.events, unknownEvents: evidence.unknownEvents, commitment: 'finalized',
    deploymentManifestVerified: manifest.deploymentVerified, watchtowerConnected: false,
    note: 'Account inventory, deployed binary provenance and central Watchtower handshake remain separate gates.' }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ result: 'runtime_smoke_failed', code: error instanceof SafeError ? error.code : 'VERIFICATION_UNAVAILABLE',
    deploymentManifestVerified: false, watchtowerConnected: false }));
  process.exitCode = 1;
} finally { clearTimeout(timeout); stop.abort(); }
