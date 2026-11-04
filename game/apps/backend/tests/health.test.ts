/**
 * /health — публичный и неограниченный по частоте эндпоинт, поэтому его состав
 * полей фиксируется тестом: адрес и баланс горячего кошелька наружу не уходят.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { healthRouter } from '../src/routes/health.js';

async function serve(handler: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use('/health', healthRouter({
    connection: { getSlot: async () => 250_000_000 },
    fetchConfig: async () => ({ epochId: 41n, paused: false }),
    gameOpsEnabled: () => true,
    cluster: 'devnet',
    uptime: () => 12.5,
  }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('/health отдаёт состояние процесса', async () => {
  await serve(async base => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.slot, 250_000_000);
    assert.equal(body.epochId, '41');
    assert.equal(body.cluster, 'devnet');
  });
});

test('/health не раскрывает плательщика: ни кошелька, ни баланса', async () => {
  await serve(async base => {
    const response = await fetch(`${base}/health`);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    assert.equal('payer' in body, false, 'адрес плательщика не должен уходить в публичный ответ');
    assert.equal('payerSol' in body, false, 'баланс плательщика не должен уходить в публичный ответ');
    assert.equal('payerKeypair' in body, false);
    assert.doesNotMatch(text, /[1-9A-HJ-NP-Za-km-z]{32,44}/, 'в ответе не должно быть base58-адресов');
  });
});

test('/health отвечает 503, когда зависимость недоступна (fail-closed)', async () => {
  const app = express();
  app.use('/health', healthRouter({
    connection: { getSlot: async () => { throw new Error('rpc down'); } },
    fetchConfig: async () => ({ epochId: 1n, paused: false }),
    gameOpsEnabled: () => false,
    cluster: 'devnet',
    uptime: () => 1,
  }));
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 503);
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
