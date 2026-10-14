/**
 * Публичный контур метрик удержания (POST /events, GET /retention, view)
 * без живой БД: периметр валидации, авторизации и отсутствия данных-шелла.
 * Настоящая SQL-логика когорт покрыта интеграционными тестами `yarn test:db`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { gameOpsRouter } from '../src/routes/gameops.js';
import type { GameOpsConfig } from '../src/gameops/env.js';
import type { Pool } from '../src/gameops/pool.js';

const token = 'retention-token-'.padEnd(40, 'x');
const config: GameOpsConfig = {
  databaseUrl: 'postgres://localhost/unused',
  role: 'game_ops_writer',
  poolMax: 1,
  statementTimeoutMs: 1_000,
  adminToken: token,
  reconciliationMaxAgeMinutes: 20,
  chainId: 'reward',
  expectedSchemaVersion: 10,
};

function brokenPool(): { pool: Pool; queries: string[] } {
  const queries: string[] = [];
  const pool = {
    query: async (text: string) => {
      queries.push(text);
      const error = new Error('connection refused') as Error & { code?: string };
      error.code = 'ECONNREFUSED';
      throw error;
    },
    connect: async () => {
      throw new Error('connection refused');
    },
    on: () => pool,
    end: async () => undefined,
  } as unknown as Pool;
  return { pool, queries };
}

async function withServer(pool: Pool, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/gameops', gameOpsRouter(pool, config));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

function postEvents(baseUrl: string, events: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/gameops/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  });
}

test('events: без событий и с кривым кошельком — 400 без обращения к БД', async () => {
  const { pool, queries } = brokenPool();
  await withServer(pool, async baseUrl => {
    const empty = await fetch(`${baseUrl}/api/gameops/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    });
    assert.equal(empty.status, 400);
    assert.equal(((await empty.json()) as { error: string }).error, 'VALIDATION');

    const badWallet = await postEvents(baseUrl, [{ player: 'not-a-wallet', event: 'harvest' }]);
    assert.equal(badWallet.status, 400);

    const badEvent = await postEvents(baseUrl, [{ player: WALLET, event: 'drop_legendary' }]);
    assert.equal(badEvent.status, 400);

    const tooMany = await postEvents(
      baseUrl,
      Array.from({ length: 21 }, () => ({ player: WALLET, event: 'harvest' })),
    );
    assert.equal(tooMany.status, 400);
  });
  assert.equal(queries.length, 0, 'валидация обязана отсекать до БД');
});

test('events: валидный anon-UUID проходит в слой данных (БД недоступна → 503)', async () => {
  const { pool } = brokenPool();
  await withServer(pool, async baseUrl => {
    const response = await postEvents(baseUrl, [
      { player: `anon-${'a1b2c3d4'.padEnd(8, '0')}-1234-5678-9abc-def012345678`, event: 'session_start' },
    ]);
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { error: string }).error, 'DB_UNAVAILABLE');
  });
});

test('events: валидный кошелёк доходит до INSERT', async () => {
  // НЕ brokenPool: запись идёт через client из connect(), поэтому фейковый
  // клиент обязан уметь отвечать — и мы фиксируем сам INSERT.
  const queries: string[] = [];
  const client = {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  const pool = {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    },
    connect: async () => client,
    on: () => pool,
    end: async () => undefined,
  } as unknown as Pool;
  await withServer(pool, async baseUrl => {
    const response = await postEvents(baseUrl, [
      { player: WALLET, event: 'harvest' },
      { player: WALLET, event: 'upgrade' },
    ]);
    assert.equal(response.status, 202);
    assert.equal(((await response.json()) as { accepted: number }).accepted, 2);
  });
  assert.ok(
    queries.some(text => text.includes('INSERT INTO game_ops.player_events')),
    'валидные события должны уходить в INSERT player_events',
  );
});

test('retention: без токена 401, кривой days — 400, с токеном — доходит до БД', async () => {
  const { pool } = brokenPool();
  await withServer(pool, async baseUrl => {
    const noAuth = await fetch(`${baseUrl}/api/gameops/retention`);
    assert.equal(noAuth.status, 401);

    const badDays = await fetch(`${baseUrl}/api/gameops/retention?days=3`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(badDays.status, 400);

    const good = await fetch(`${baseUrl}/api/gameops/retention?days=30`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(good.status, 503);
    assert.equal(((await good.json()) as { error: string }).error, 'DB_UNAVAILABLE');
  });
});

test('retention/view: отдаёт HTML-экран со своим CSP (inline-рендер разрешён)', async () => {
  const { pool } = brokenPool();
  await withServer(pool, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/gameops/retention/view`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const csp = response.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src 'unsafe-inline'/);
    assert.match(csp, /connect-src 'self'/);
    const html = await response.text();
    assert.match(html, /Метрики удержания/);
    assert.match(html, /\/api\/gameops\/retention/);
  });
});
