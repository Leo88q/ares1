import type { Config } from './config.js';
import type { RuntimeState } from './ingestion.js';
import type { PgStore } from './store.js';
export async function health(config: Config, store: PgStore, runtime: RuntimeState) {
  try {
    const [checkpoint, issues] = await Promise.all([store.checkpoint(), store.issues()]);
    const state = checkpoint.state;
    const age = state.lastSuccessAt ? Date.now() - Date.parse(state.lastSuccessAt) : Infinity;
    const fresh = age < Math.max(config.pollMs * 3, 60000);
    const lag = fresh && runtime.finalizedTip !== null && state.reconciledSlot !== null
      ? Math.max(0, runtime.finalizedTip - state.reconciledSlot) : null;
    const ready = config.provider === 'rpc' && runtime.accountVerified && !runtime.lastError &&
      state.phase === 'tail' && state.before === null && issues.length === 0 && fresh;
    return { ready, database: 'up', mode: config.provider, phase: state.phase,
      finalizedLag: lag, issues, lastSuccessAt: state.lastSuccessAt,
      historyCoverage: 'provider_available_only', error: runtime.lastError };
  } catch {
    return { ready: false, database: 'down', mode: config.provider, phase: null,
      finalizedLag: null, issues: [], lastSuccessAt: null, historyCoverage: 'unknown', error: 'DATABASE_UNAVAILABLE' };
  }
}
