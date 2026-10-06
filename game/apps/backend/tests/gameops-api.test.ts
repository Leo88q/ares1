/**
 * Тесты админ-API слоя game_ops без живой БД (быстрые, идут в обычном CI).
 *
 * Проверяем периметр: без токена — 401 и запись отказа в аудит, с токеном —
 * доступ; при недоступной БД readiness отвечает 503 (fail-closed), а не
 * «зелёным» отчётом. Пул подменяется заглушкой: настоящая БД покрыта
 * интеграционными тестами `yarn test:db`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { tokenMatches, gameOpsRouter } from '../src/routes/gameops.js';
import type { GameOpsConfig } from '../src/gameops/env.js';
import type { Pool } from '../src/gameops/pool.js';

const token = 'token-'.padEnd(40, 'x');
const config: GameOpsConfig = {
  databaseUrl: 'postgres://localhost/unused',
  role: 'game_ops_writer',
  poolMax: 1,
  statementTimeoutMs: 1_000,
  adminToken: token,
  reconciliationMaxAgeMinutes: 20,
  chainId: 'reward',
  expectedSchemaVersion: 6,
};

/** Заглушка пула: любая операция падает так, как это делает недоступная БД. */
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

test('tokenMatches: секреты сравниваются по значению, длина не утекает', () => {
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches('token-'.padEnd(40, 'y'), token), false);
  assert.equal(tokenMatches('short', token), false);
  assert.equal(tokenMatches('', token), false);
});

test('без токена админ-API отвечает 401 и пишет отказ в аудит', async () => {
  const { pool, queries } = brokenPool();
  await withServer(pool, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/gameops/intents`);
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, 'UNAUTHORIZED');
  });
  assert.ok(queries.some(text => text.includes('admin_audit')), 'отказ должен попадать в аудит');
});

test('с неверным токеном — 401, с верным — запрос доходит до БД', async () => {
  const { pool } = brokenPool();
  await withServer(pool, async baseUrl => {
    const bad = await fetch(`${baseUrl}/api/gameops/intents`, { headers: { authorization: 'Bearer wrong' } });
    assert.equal(bad.status, 401);

    const good = await fetch(`${baseUrl}/api/gameops/intents`, { headers: { authorization: `Bearer ${token}` } });
    // БД недоступна, поэтому 503 (DB_UNAVAILABLE), но НЕ 401 — значит
    // авторизация пройдена и запрос дошёл до слоя данных.
    assert.equal(good.status, 503);
    const body = (await good.json()) as { error: string };
    assert.equal(body.error, 'DB_UNAVAILABLE');
  });
});

test('readiness fail-closed: недоступная БД даёт 503 с причиной', async () => {
  const { pool } = brokenPool();
  await withServer(pool, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/gameops/readiness`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { ready: boolean; checks: Array<{ name: string; status: string }> };
    assert.equal(body.ready, false);
    const database = body.checks.find(check => check.name === 'database');
    assert.equal(database?.status, 'fail');
  });
});

test('readiness: неприменённые миграции (42P01) не считаются готовностью', async () => {
  const queries: string[] = [];
  const pool = {
    query: async (text: string) => {
      queries.push(text);
      if (text === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      const error = new Error('relation "game_ops.schema_version" does not exist') as Error & { code?: string };
      error.code = '42P01';
      throw error;
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }),
    on: () => pool,
    end: async () => undefined,
  } as unknown as Pool;

  await withServer(pool, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/gameops/readiness`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { checks: Array<{ name: string; status: string; detail: string }> };
    const schema = body.checks.find(check => check.name === 'schema');
    assert.equal(schema?.status, 'fail');
    assert.match(schema?.detail ?? '', /MIGRATIONS_MISSING/);
  });
});

test('валидация входа: плохой amountMicro не доходит до БД', async () => {
  const { pool, queries } = brokenPool();
  await withServer(pool, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/gameops/intents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientAta: 'A'.repeat(44), amountMicro: 'abc', nonce: '1', reason: 'test:validation' }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, 'VALIDATION');
  });
});
