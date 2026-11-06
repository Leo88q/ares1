import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { PublicKey } from '@solana/web3.js';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colonyAuthRouter } from '../src/colonies/routes.js';

const ORIGIN = 'https://game.example';
const SESSION_SIGNING_KEY_FOR_TESTS = 'test-only-colony-session-secret-32-bytes';

function walletPair() {
  const pair = generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  return {
    wallet: new PublicKey(der.subarray(der.length - 32)).toBase58(),
    privateKey: pair.privateKey,
  };
}

function challengeDb(): Pool {
  const rows = new Map<string, Record<string, unknown>>();
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('SELECT set_config')) {
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      }
      if (sql.includes('purge_expired_colony_challenges')) return { rows: [{ purge_expired_colony_challenges: 0 }], rowCount: 1 } as unknown as QueryResult;
      if (sql.includes('INSERT INTO game_ops.colony_auth_challenges')) {
        const [id, wallet, origin, nonce_hash, message_hash, issuedAt, expiresAt] = params as [string, string, string, string, string, string, string];
        rows.set(id, { challenge_id: id, wallet, origin, nonce_hash, message_hash, issued_at: issuedAt, expires_at: new Date(expiresAt), consumed_at: null });
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      if (sql.includes('FROM game_ops.colony_auth_challenges')) {
        const [id, wallet] = params as [string, string];
        const row = rows.get(id);
        return { rows: row?.wallet === wallet ? [row] : [], rowCount: row?.wallet === wallet ? 1 : 0 } as unknown as QueryResult;
      }
      if (sql.includes('UPDATE game_ops.colony_auth_challenges')) {
        const [id] = params as [string];
        const row = rows.get(id);
        if (!row || row.consumed_at !== null) return { rows: [], rowCount: 0 } as unknown as QueryResult;
        row.consumed_at = new Date();
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      throw new Error(`Unexpected SQL in fake test pool: ${sql}`);
    },
    release() {},
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

test('colony auth routes issue an origin-bound one-time session from a wallet signature', async () => {
  const { wallet, privateKey } = walletPair();
  const app = express();
  app.use(express.json());
  app.use('/api/colonies', colonyAuthRouter({
    pool: challengeDb(), cluster: 'mainnet-beta', sessionSecret: SESSION_SIGNING_KEY_FOR_TESTS,
    allowedOrigins: [ORIGIN],
  }));
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/colonies`;
  const headers = { 'content-type': 'application/json', origin: ORIGIN };
  try {
    const challengeResponse = await fetch(`${base}/auth/challenge`, { method: 'POST', headers, body: JSON.stringify({ wallet }) });
    assert.equal(challengeResponse.status, 201);
    const challenge = await challengeResponse.json() as { challengeId: string; message: string };
    const signature = sign(null, Buffer.from(challenge.message), privateKey).toString('base64url');
    const verifyResponse = await fetch(`${base}/auth/verify`, { method: 'POST', headers, body: JSON.stringify({ wallet, challengeId: challenge.challengeId, message: challenge.message, signature }) });
    assert.equal(verifyResponse.status, 200);
    const session = await verifyResponse.json() as { token: string; wallet: string; cluster: string };
    assert.equal(session.wallet, wallet);
    assert.equal(session.cluster, 'mainnet-beta');

    const sessionResponse = await fetch(`${base}/auth/session`, { headers: { origin: ORIGIN, authorization: `Bearer ${session.token}` } });
    assert.equal(sessionResponse.status, 200);
    assert.equal((await sessionResponse.json() as { wallet: string }).wallet, wallet);

    const replay = await fetch(`${base}/auth/verify`, { method: 'POST', headers, body: JSON.stringify({ wallet, challengeId: challenge.challengeId, message: challenge.message, signature }) });
    assert.equal(replay.status, 401);
    const wrongOrigin = await fetch(`${base}/auth/session`, { headers: { origin: 'https://attacker.example', authorization: `Bearer ${session.token}` } });
    assert.equal(wrongOrigin.status, 401);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

/**
 * Старая серверная колония закрыта (B2, решение владельца 2026-11-06). Её пути отвечают 410
 * независимо от сессии: данные колонии с них не отдаются, а клиент получает явный отказ.
 */
test('старые маршруты колонии отвечают 410 и не отдают данные, даже с валидной сессией', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/colonies', colonyAuthRouter({
    pool: challengeDb(), cluster: 'devnet', sessionSecret: SESSION_SIGNING_KEY_FOR_TESTS,
    allowedOrigins: [ORIGIN],
  }));
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/colonies`;
  const retired: Array<{ method: 'GET' | 'POST'; path: string }> = [
    { method: 'POST', path: '/field/verify' },
    { method: 'POST', path: '/fields/link' },
    { method: 'POST', path: '/fields/unlink' },
    { method: 'POST', path: '/initialize' },
    { method: 'GET', path: '/rules' },
    { method: 'GET', path: '/state' },
    { method: 'POST', path: '/actions' },
  ];
  const longEnoughButFake = `Bearer ${'a'.repeat(40)}`;
  try {
    for (const route of retired) {
      const withSession = await fetch(`${base}${route.path}`, {
        method: route.method, headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: longEnoughButFake },
        ...(route.method === 'POST' ? { body: JSON.stringify({}) } : {}),
      });
      assert.equal(withSession.status, 410, `${route.path}: должно быть 410`);
      assert.equal((await withSession.json() as { error: string }).error, 'LEGACY_COLONY_RETIRED');
    }
  } finally {
    server.close();
    await once(server, 'close');
  }
});

/**
 * Единственный защищённый маршрут этого роутера — /auth/session. Он обязан требовать origin и Bearer.
 * Проверка идёт через `requireSession`, а не копируется в хендлер.
 */
test('/auth/session отвечает 401 без origin/токена, с битым токеном и с чужим origin', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/colonies', colonyAuthRouter({
    pool: challengeDb(), cluster: 'devnet', sessionSecret: SESSION_SIGNING_KEY_FOR_TESTS,
    allowedOrigins: [ORIGIN],
  }));
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/colonies`;
  const longEnoughButFake = `Bearer ${'a'.repeat(40)}`;
  try {
    const noOrigin = await fetch(`${base}/auth/session`, { headers: { authorization: longEnoughButFake } });
    assert.equal(noOrigin.status, 401);
    assert.equal((await noOrigin.json() as { error: string }).error, 'SESSION_REQUIRED');

    const noToken = await fetch(`${base}/auth/session`, { headers: { origin: ORIGIN } });
    assert.equal(noToken.status, 401);
    assert.equal((await noToken.json() as { error: string }).error, 'SESSION_REQUIRED');

    const badToken = await fetch(`${base}/auth/session`, { headers: { origin: ORIGIN, authorization: longEnoughButFake } });
    assert.equal(badToken.status, 401);
    assert.equal((await badToken.json() as { error: string }).error, 'SESSION_INVALID');

    const wrongOrigin = await fetch(`${base}/auth/session`, { headers: { origin: 'https://attacker.example', authorization: longEnoughButFake } });
    assert.equal(wrongOrigin.status, 401);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
