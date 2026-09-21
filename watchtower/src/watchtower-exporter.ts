import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig, SafeError } from './config.js';
import { PgStore } from './store.js';
import { Rpc } from './rpc.js';
import { Ingestion } from './ingestion.js';
import { api } from './api.js';
import { Metrics } from './metrics.js';

async function main() {
  const config = loadConfig(); // write guard runs before DB, HTTP or ingestion
  const shutdown = new AbortController();
  const store = new PgStore(config);
  const metrics = new Metrics();
  const rpc = new Rpc(config.rpcUrls, config.rpcTimeoutMs, shutdown.signal, metrics);
  const ingestion = new Ingestion(config, rpc, store, metrics);
  const server = api(config, store, ingestion.runtime, metrics);
  let loop: Promise<void> | undefined;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true; shutdown.abort();
    const deadline = setTimeout(() => process.exit(1), 25000).unref();
    server.close(); server.closeIdleConnections();
    const closeHttp = setTimeout(() => server.closeAllConnections(), 5000).unref();
    await loop?.catch(() => {});
    await store.close();
    clearTimeout(closeHttp); clearTimeout(deadline);
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  try {
    await store.initialize();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, '0.0.0.0', resolve); });
    console.log(JSON.stringify({ code: 'EXPORTER_STARTED', port: config.port, provider: config.provider, writes: false }));
    if (config.provider === 'rpc') loop = (async () => {
      while (!shutdown.signal.aborted) {
        let caughtUp = true;
        try { caughtUp = await ingestion.step(); }
        catch { if (!shutdown.signal.aborted) console.error(JSON.stringify({ code: 'INGESTION_RETRY' })); }
        try { await delay(caughtUp ? config.pollMs : 100, undefined, { signal: shutdown.signal }); }
        catch { break; }
      }
    })();
  } catch (error) { await stop(); throw error; }
}
main().catch(error => {
  console.error(JSON.stringify({ code: error instanceof SafeError ? error.code : 'EXPORTER_START_FAILED' }));
  process.exitCode = 1;
});
