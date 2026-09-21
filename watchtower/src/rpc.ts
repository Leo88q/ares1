import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { SafeError } from './config.js';
import type { Metrics } from './metrics.js';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const READ_METHODS = ['getGenesisHash', 'getAccountInfo', 'getSlot', 'getSignaturesForAddress', 'getTransaction', 'getFirstAvailableBlock'] as const;
export type ReadMethod = typeof READ_METHODS[number];
export interface ReadRpc { call<T>(method: ReadMethod, params?: unknown[]): Promise<T> }
export class Rpc implements ReadRpc {
  private verified = new Set<string>();
  private id = 0;
  constructor(private readonly urls: string[], private readonly timeoutMs: number,
    private readonly shutdown: AbortSignal, private readonly metrics?: Metrics,
    private readonly wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) => delay(ms, undefined, { signal }),
    private readonly fetcher: typeof fetch = fetch) {}
  private async request<T>(url: string, method: ReadMethod, params: unknown[]): Promise<T> {
    const id = ++this.id;
    const response = await this.fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      redirect: 'error', signal: AbortSignal.any([this.shutdown, AbortSignal.timeout(this.timeoutMs)]) });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new SafeError('RPC_429');
      if (response.status >= 500) throw new SafeError('RPC_5XX');
      throw new SafeError('RPC_HTTP_REJECTED');
    }
    if (!response.body) throw new SafeError('RPC_INVALID_RESPONSE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 20 * 1024 * 1024) throw new SafeError('RPC_RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const parsed = z.object({ jsonrpc: z.literal('2.0'), id: z.number(), result: z.unknown().optional(),
      error: z.object({ code: z.number() }).passthrough().optional() }).safeParse(JSON.parse(Buffer.concat(chunks).toString()));
    if (!parsed.success || parsed.data.id !== id) throw new SafeError('RPC_INVALID_RESPONSE');
    if (parsed.data.error) throw new SafeError([-32005, -32004, -32007, -32009].includes(parsed.data.error.code) ? 'RPC_TEMPORARY' : 'RPC_REJECTED');
    if (!Object.hasOwn(parsed.data, 'result')) throw new SafeError('RPC_INVALID_RESPONSE');
    return parsed.data.result as T;
  }
  async call<T>(method: ReadMethod, params: unknown[] = []): Promise<T> {
    if (!(READ_METHODS as readonly string[]).includes(method)) throw new SafeError('RPC_METHOD_FORBIDDEN');
    if (!this.urls.length) throw new SafeError('RPC_REQUIRED');
    let last = new SafeError('RPC_UNAVAILABLE');
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.shutdown.aborted) throw new SafeError('SHUTDOWN');
      const url = this.urls[attempt % this.urls.length]!;
      try {
        if (!this.verified.has(url)) {
          const genesis = await this.request<string>(url, 'getGenesisHash', []);
          if (genesis !== DEVNET_GENESIS) throw new SafeError('RPC_CLUSTER_MISMATCH');
          this.verified.add(url);
        }
        const result = await this.request<T>(url, method, params);
        this.metrics?.rpc.inc({ method, result: 'success' });
        return result;
      } catch (error) {
        if (this.shutdown.aborted) throw new SafeError('SHUTDOWN');
        last = error instanceof SafeError ? error : new SafeError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'RPC_TIMEOUT' : 'RPC_TRANSPORT');
        this.metrics?.rpc.inc({ method, result: last.code });
        if (['RPC_CLUSTER_MISMATCH', 'RPC_HTTP_REJECTED', 'RPC_REJECTED', 'RPC_RESPONSE_TOO_LARGE'].includes(last.code)) throw last;
        if (attempt < 3) await this.wait(Math.min(8000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100), this.shutdown);
      }
    }
    throw last;
  }
}
