/**
 * /api/features: клиент получает только публичные гейты, без секретов и без
 * чтения цепи (эндпоинт обязан отвечать при недоступном RPC).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { defaultFeatureFlags, featuresRouter } from '../src/routes/features.js';

async function serve(flags: ReturnType<typeof defaultFeatureFlags>, handler: (base: string) => Promise<void>) {
  const app = express();
  app.use('/api/features', featuresRouter(flags));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('флаги колоний отражают launch gate и не содержат секретов', async () => {
  await serve(defaultFeatureFlags({ coloniesEnabled: false }), async (base) => {
    const response = await fetch(`${base}/api/features`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=30');
    const body = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      'colonies', 'coloniesReleaseReady', 'presalePayments', 'rewardsRail',
    ]);
    assert.equal(body.colonies, false);
    assert.equal(typeof body.rewardsRail, 'boolean');
    assert.equal(typeof body.presalePayments, 'boolean');
  });
});

test('включённые колонии отдаются как true', async () => {
  await serve(defaultFeatureFlags({ coloniesEnabled: true }), async (base) => {
    const body = (await (await fetch(`${base}/api/features`)).json()) as Record<string, unknown>;
    assert.equal(body.colonies, true);
  });
});
