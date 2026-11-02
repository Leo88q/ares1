/**
 * Витрина /api/store: каталог обязан совпадать с тем, что реально выдаёт
 * рельса, а состояние продаж — с launch gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { storePacks, storeRouter } from '../src/routes/store.js';

async function serve(enabled: boolean, handler: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use('/api/store', storeRouter({ salesEnabled: enabled, closedReason: 'closed for test' }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('каталог витрины: три пака, каждый ровно 1000 POTATO', () => {
  const packs = storePacks();
  assert.deepEqual(packs.map((p) => p.id), ['bed-10', 'meadow-4', 'field-2']);
  for (const pack of packs) {
    assert.equal(pack.potatoMicro, '1000000000');
    assert.equal(pack.potato, '1000');
    assert.ok(pack.fields.length > 0);
    assert.equal(pack.fields.reduce((sum, f) => sum + f.count, 0) >= 2, true);
  }
  // Состав паков — ровно цена поля × количество (тип 0/1/2 = 100/250/500).
  const price: Record<number, number> = { 0: 100, 1: 250, 2: 500 };
  for (const pack of packs) {
    const total = pack.fields.reduce((sum, f) => sum + price[f.type]! * f.count, 0);
    assert.equal(total, 1000, `${pack.id}: состав должен стоить 1000 POTATO`);
  }
});

test('закрытая витрина отдаёт причину и не притворяется магазином', async () => {
  await serve(false, async (base) => {
    const response = await fetch(`${base}/api/store`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, any>;
    assert.equal(body.enabled, false);
    assert.equal(body.reason, 'closed for test');
    assert.equal(body.currency, 'POTATO');
    assert.equal(body.packs.length, 3);
  });
});

test('открытая витрина отдаёт enabled=true и тот же каталог', async () => {
  await serve(true, async (base) => {
    const body = (await (await fetch(`${base}/api/store`)).json()) as Record<string, any>;
    assert.equal(body.enabled, true);
    assert.equal(body.reason, null);
    assert.equal(body.packs.length, 3);
  });
});
