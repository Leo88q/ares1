import { Counter, Gauge, Registry } from 'prom-client';
export class Metrics {
  readonly registry = new Registry();
  readonly rpc = new Counter({ name: 'watchtower_rpc_requests_total', help: 'RPC attempts (no URLs/credentials)',
    labelNames: ['method', 'result'], registers: [this.registry] });
  readonly pages = new Counter({ name: 'watchtower_committed_pages_total', help: 'Atomically committed ingestion pages', registers: [this.registry] });
  readonly lag = new Gauge({ name: 'watchtower_finalized_lag_slots', help: 'Finalized scan watermark lag, not last event age', registers: [this.registry] });
}
