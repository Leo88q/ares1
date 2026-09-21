import { createServer } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { address, safeConfig, type Config } from './config.js';
import { PARSER_VERSION } from './artifacts.js';
import { signatureSchema, type RuntimeState } from './ingestion.js';
import { health } from './health.js';
import type { PgStore } from './store.js';
import type { Metrics } from './metrics.js';
const querySchema = z.object({
  cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(200).default(100),
  before: z.string().datetime({ offset: true }).optional(), after: z.string().datetime({ offset: true }).optional(),
  commitment: z.literal('finalized').default('finalized'), programId: address.optional(),
  eventType: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,79}$/).optional(),
  slotFrom: z.coerce.number().int().nonnegative().safe().optional(), slotTo: z.coerce.number().int().nonnegative().safe().optional(),
}).strict().refine(q => q.slotFrom === undefined || q.slotTo === undefined || q.slotFrom <= q.slotTo)
  .refine(q => !q.before || !q.after || Date.parse(q.after) < Date.parse(q.before));
const digest = (s: string) => createHash('sha256').update(s).digest();
export function authenticated(header: string | undefined, token: string): boolean {
  return typeof header === 'string' && timingSafeEqual(digest(header), digest(`Bearer ${token}`));
}
export function encodeCursor(id: string, scope: string, token: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, id, scope })).toString('base64url');
  return `${payload}.${createHmac('sha256', token).update(payload).digest('base64url')}`;
}
export function decodeCursor(cursor: string, scope: string, token: string): string {
  const [payload, mac, extra] = cursor.split('.');
  if (!payload || !mac || extra || !timingSafeEqual(digest(mac), digest(createHmac('sha256', token).update(payload).digest('base64url')))) throw new Error('cursor');
  const value = z.object({ v: z.literal(1), id: z.string().regex(/^\d{1,19}$/), scope: z.string() }).strict().parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
  if (value.scope !== scope || BigInt(value.id) > 9223372036854775807n) throw new Error('cursor');
  return value.id;
}
const unavailable = (reason = 'requires_client_telemetry') => ({ value: null, dataQuality: 'unavailable', reason });
export function api(config: Config, store: PgStore, runtime: RuntimeState, metrics: Metrics) {
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let finalizedLag: number | null = null;
    const send = (status: number, data: unknown, nextCursor: string | null = null, quality = 'partial') => {
      res.writeHead(status); res.end(JSON.stringify({ source: config.source, commitment: 'finalized', finalizedLag,
        dataQuality: quality, confidence: quality === 'unavailable' ? 'unavailable' : 'partial',
        parserVersion: PARSER_VERSION, nextCursor, data }));
    };
    if (!authenticated(req.headers.authorization, config.token)) return send(401, { error: 'UNAUTHORIZED' }, null, 'unavailable');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(405, { error: 'READ_ONLY' }, null, 'unavailable'); }
    try {
      const url = new URL(req.url ?? '/', 'http://exporter.invalid');
      const status = await health(config, store, runtime);
      finalizedLag = status.finalizedLag;
      if (url.pathname === '/watchtower/health') return send(200, { alive: true, ...status });
      if (url.pathname === '/watchtower/readyz') return send(status.ready ? 200 : 503, status, null, status.ready ? 'partial' : 'unavailable');
      if (url.pathname === '/watchtower/config') return send(200, safeConfig(config));
      const params: Record<string, string> = Object.create(null);
      for (const [key, value] of url.searchParams) {
        if (Object.hasOwn(params, key)) return send(400, { error: 'DUPLICATE_QUERY_PARAMETER' }, null, 'unavailable');
        params[key] = value;
      }
      if (url.pathname === '/watchtower/events' || url.pathname.startsWith('/watchtower/events/')) {
        const parsed = querySchema.safeParse(params);
        const signature = url.pathname === '/watchtower/events' ? undefined : url.pathname.slice('/watchtower/events/'.length);
        if (!parsed.success || (signature !== undefined && !signatureSchema.safeParse(signature).success)) {
          return send(400, { error: 'INVALID_EVENT_QUERY' }, null, 'unavailable');
        }
        const { cursor, ...q } = parsed.data;
        // Cursor is bound to filter values, route, game/network/source. Limit may change.
        const scope = JSON.stringify({ stream: store.streamId, ...q, limit: undefined, signature });
        let cursorId = '0';
        try { if (cursor) cursorId = decodeCursor(cursor, scope, config.token); }
        catch { return send(400, { error: 'INVALID_CURSOR' }, null, 'unavailable'); }
        const result = await store.list({ ...q, cursorId, signature });
        const last = result.rows.at(-1);
        // Return a resume cursor even at the current end; later inserts have larger IDs.
        const next = last ? encodeCursor(last.id, scope, config.token) : cursor ?? null;
        return send(200, { events: result.rows, hasMore: result.more, coverage: status.historyCoverage }, next);
      }
      if (url.pathname === '/watchtower/players/cross-game') return send(200, unavailable('requires_identity_service'), null, 'unavailable');
      if (url.pathname === '/watchtower/players/retention') return send(200, {
        d1: unavailable(), d3: unavailable(), d7: unavailable(), d14: unavailable(), d30: unavailable(),
      }, null, 'unavailable');
      if (url.pathname === '/watchtower/players/cohorts') return send(200, unavailable('historical_coverage_not_verified'), null, 'unavailable');
      if (url.pathname === '/watchtower/funnels') return send(200, unavailable(), null, 'unavailable');
      if (url.pathname === '/watchtower/metrics/daily') {
        const range = z.object({ before: z.string().datetime({ offset: true }).optional(), after: z.string().datetime({ offset: true }).optional() }).strict().safeParse(params);
        if (!range.success) return send(400, { error: 'INVALID_DATE_RANGE' }, null, 'unavailable');
        const before = range.data.before ?? new Date().toISOString();
        const after = range.data.after ?? new Date(Date.parse(before) - 30 * 86400000).toISOString();
        const days = (Date.parse(before) - Date.parse(after)) / 86400000;
        if (days < 0 || days > 31) return send(400, { error: 'MAX_31_DAYS' }, null, 'unavailable');
        return send(200, { observedEventCounts: await store.daily(before, after, 2000),
          sessions: unavailable(), walletConnections: unavailable(), clientCrashes: unavailable(),
          device: unavailable(), ip: unavailable(), onboarding: unavailable(),
          exporterMetrics: await metrics.registry.getMetricsAsJSON(), coverage: status.historyCoverage });
      }
      if (url.pathname === '/watchtower/economy') return send(200, {
        observedEvents: await store.counts('economy'), supply: unavailable('requires_token_account_reconciliation'),
        completeLedger: unavailable('events_are_not_complete_token_accounting'),
      });
      if (url.pathname === '/watchtower/treasury') return send(200, {
        observedEvents: (await store.counts('economy')).filter(x => x.eventType.startsWith('Treasury')),
        balances: unavailable('requires_verified_treasury_accounts'),
      });
      if (url.pathname === '/watchtower/security') return send(200, {
        observedEvents: await store.counts('security'), signerCapability: false, writes: false,
        liveAuthorityInventory: unavailable('requires_verified_account_snapshot'),
      });
      if (url.pathname === '/watchtower/alerts') return send(200, { indexerIssues: status.issues,
        lastError: status.error, fraudSignals: unavailable('not_implemented'), automatedActions: false });
      return send(404, { error: 'NOT_FOUND' }, null, 'unavailable');
    } catch { return send(503, { error: 'EXPORTER_UNAVAILABLE' }, null, 'unavailable'); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 40;
  return server;
}
