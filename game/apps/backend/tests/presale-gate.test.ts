import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Connection } from '@solana/web3.js';
import type { Pool } from '../src/gameops/pool.js';
import type { GameOpsConfig } from '../src/gameops/env.js';
import { presaleRouter } from '../src/routes/presale.js';

function noRunPool(): Pool {
  const client = {
    async query(sql: string) {
      if (sql.includes('SELECT * FROM game_ops.presale_runs')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  return { connect: async () => client } as unknown as Pool;
}

async function reserveStatus(cluster: 'devnet' | 'mainnet-beta', paymentsEnabled: boolean) {
  const app = express();
  app.use(express.json());
  app.use('/api/presale', presaleRouter(
    noRunPool(),
    { adminToken: 't'.repeat(40) } as GameOpsConfig,
    {
      connection: {} as Connection,
      cluster,
      paymentsEnabled,
      potatoMint: '11111111111111111111111111111111',
    },
  ));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/presale/runs/wave1/reserve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: '11111111111111111111111111111111' }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('mainnet order creation is blocked until the explicit production approval gate is enabled', async () => {
  const result = await reserveStatus('mainnet-beta', false);
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'NOT_CONFIGURED');
  assert.match(String(result.body.message), /mainnet.*disabled/i);
});

test('devnet beta remains free by default: presale writes are rejected', async () => {
  const result = await reserveStatus('devnet', false);
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'NOT_CONFIGURED');
  assert.match(String(result.body.message), /free sandbox/i);
});

test('an explicitly enabled isolated run passes the gate and reaches the order service', async () => {
  const result = await reserveStatus('mainnet-beta', true);
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'RUN_NOT_FOUND');
});
