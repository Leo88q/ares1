// Watchtower OS v3 — read-only HTTP server (node:http, без зависимостей).
// Все endpoints GET; envelope: gameId/network/stage/dataQuality/blockchainWritesEnabled.
// Если WATCHTOWER_OS_TOKEN задан (>=32), требуется Bearer (как exporter); иначе open read-only.

import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  API_ROUTES, GAME, OS_CONFIG, assetStrategy, componentOrError,
} from './stack-v3.js';
import { PANELS_V3, osHealth } from './control-panels-v3.js';
import { REPORT_STEPS_V3 } from './handoff-v3.js';

const digest = s => createHash('sha256').update(s).digest();
const authed = (header, token) => typeof header === 'string' && timingSafeEqual(digest(header), digest(`Bearer ${token}`));

/** Строгий парсинг query: дубликаты запрещены, разрешены только gameId+allowlist. */
function parseParams(url, allow = []) {
  const params = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(params, key)) return { error: 'DUPLICATE_QUERY_PARAMETER' };
    if (key !== 'gameId' && !allow.includes(key)) return { error: 'INVALID_QUERY_PARAMETER', key };
    params[key] = value;
  }
  const gameId = params.gameId ?? GAME.gameId;
  if (gameId !== GAME.gameId) return { error: 'UNKNOWN_GAME', gameId };
  return { gameId, params };
}

/**
 * @param {{ token?: string | null }} [opts]
 * @returns {import('node:http').Server}
 */
export function createOsServer(opts = {}) {
  const token = typeof opts.token === 'string' && opts.token.length >= 32 ? opts.token : null;
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, data, quality = 'partial') => {
      res.writeHead(status);
      res.end(JSON.stringify({
        osVersion: OS_CONFIG.version, gameId: GAME.gameId, network: GAME.network,
        stage: GAME.stage, dataQuality: quality, blockchainWritesEnabled: false, data,
      }));
    };
    try {
      if (token && !authed(req.headers.authorization, token)) return send(401, { error: 'UNAUTHORIZED' }, 'unavailable');
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(405, { error: 'READ_ONLY' }, 'unavailable'); }
      const url = new URL(req.url ?? '/', 'http://os.invalid');
      const routeKey = `GET ${url.pathname}`;
      const route = API_ROUTES[routeKey];
      if (!route) return send(404, { error: 'NOT_FOUND' }, 'unavailable');
      const parsed = parseParams(url, route.params ?? []);
      if (parsed.error) return send(400, parsed, 'unavailable');

      if (url.pathname === '/api/os/config') {
        return send(200, { ...OS_CONFIG, controlPanels: PANELS_V3, reportSteps: REPORT_STEPS_V3 });
      }
      if (url.pathname === '/api/os/health') return send(200, { ...osHealth(), checkedAt: new Date().toISOString() });
      if (url.pathname === '/api/assets/strategy') {
        const strategy = assetStrategy(parsed.params.itemType ?? 'common', parsed.params.rarity ?? 'common');
        return send(strategy.error ? 400 : 200, strategy, strategy.error ? 'unavailable' : 'partial');
      }
      if (url.pathname === '/api/sdk/preset') {
        const c = componentOrError('preset');
        const template = parsed.params.template ?? 'farming';
        if (c.error) return send(500, c, 'unavailable');
        if (!c.key.templates.includes(template)) {
          return send(400, { error: 'UNKNOWN_TEMPLATE', template, allowed: c.key.templates }, 'unavailable');
        }
        return send(200, { component: c, scaffold: `npx create-solana-game ares1 --preset ${template}`, template, deprecatedAlias: 'create-solana-game (duplicate → preset official)' });
      }
      const component = componentOrError(route.component ?? '');
      if (component.error) return send(500, component, 'unavailable');
      if (component.status === 'deprecated') {
        return send(200, { component, warning: `deprecated duplicate; use ${component.supersededBy}` });
      }
      return send(200, { component });
    } catch {
      return send(500, { error: 'OS_UNAVAILABLE' }, 'unavailable');
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 40;
  return server;
}

/** Запуск: WATCHTOWER_OS_PORT (default 8791), WATCHTOWER_OS_TOKEN (optional >=32). */
export function main(env = process.env) {
  const port = Number.parseInt(env.WATCHTOWER_OS_PORT ?? '8791', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_OS_PORT');
  const token = env.WATCHTOWER_OS_TOKEN && env.WATCHTOWER_OS_TOKEN.length >= 32 ? env.WATCHTOWER_OS_TOKEN : null;
  const server = createOsServer({ token });
  server.listen(port, '0.0.0.0', () => {
    console.log(`watchtower-os v3 listening 0.0.0.0:${port} (${Object.keys(API_ROUTES).length} GET routes, token=${token ? 'required' : 'open'}, writes=false)`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
if (invoked === import.meta.url) main();
