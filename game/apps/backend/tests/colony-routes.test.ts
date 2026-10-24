import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { PublicKey } from '@solana/web3.js';
import { anchorDiscriminator } from '../src/anchorRaw.js';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colonyAuthRouter } from '../src/colonies/routes.js';
import type { ColonyService } from '../src/colonies/service.js';

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
  const programId = new PublicKey(new Uint8Array(32).fill(5));
  const fieldAddress = new PublicKey(new Uint8Array(32).fill(6));
  const fieldData = Buffer.alloc(70);
  anchorDiscriminator('account', 'Field').copy(fieldData);
  new PublicKey(wallet).toBuffer().copy(fieldData, 8);
  fieldData.writeUInt8(1, 40); fieldData.writeUInt8(5, 41);
  fieldData.writeBigInt64LE(0n, 42); fieldData.writeBigInt64LE(0n, 50); fieldData.writeBigInt64LE(0n, 58);
  fieldData.writeUInt8(1, 66); fieldData.writeUInt8(0, 67); fieldData.writeUInt8(255, 68); fieldData.writeUInt8(0, 69);
  const fieldRpc = {
    async getAccountInfoAndContext() {
      return { context: { slot: 456 }, value: { data: fieldData, owner: programId } };
    },
  } as unknown as import('@solana/web3.js').Connection;
  let linkedEvidence: unknown;
  let initializedRequest: unknown;
  let unlinkedRequest: unknown;
  const colonyService = {
    freeStarterEnabled: true,
    async initialize(params: { wallet: string; fieldAddress: string; requestId: string; evidence: unknown }) {
      initializedRequest = params;
      return { colonyId: 'colony-test', fieldAddress: params.fieldAddress };
    },
    async linkField(params: { evidence: { fieldAddress: string } }) {
      linkedEvidence = params.evidence;
      return { snapshot: { linkedFields: [params.evidence.fieldAddress] }, duplicate: false };
    },
    async unlinkField(params: { wallet: string; fieldAddress: string; requestId: string; expectedSequence: number }) {
      unlinkedRequest = params;
      return { snapshot: { linkedFields: [] }, duplicate: false };
    },
  } as unknown as ColonyService;
  app.use('/api/colonies', colonyAuthRouter({
    pool: challengeDb(), cluster: 'mainnet-beta', sessionSecret: SESSION_SIGNING_KEY_FOR_TESTS,
    allowedOrigins: [ORIGIN], fieldRpc, programId, colonyService,
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
    const rulesResponse = await fetch(`${base}/rules`, { headers: { origin: ORIGIN, authorization: `Bearer ${session.token}` } });
    assert.equal(rulesResponse.status, 200);
    const rules = await rulesResponse.json() as { status: string; freeStarterEnabled: boolean; freeStarterLimit: string; buildings: Record<string, unknown> };
    assert.equal(rules.status, 'internal-review');
    assert.equal(rules.freeStarterEnabled, true);
    assert.equal(rules.freeStarterLimit, 'one-per-wallet');

    const sessionResponse = await fetch(`${base}/auth/session`, { headers: { origin: ORIGIN, authorization: `Bearer ${session.token}` } });
    assert.equal(sessionResponse.status, 200);
    assert.equal((await sessionResponse.json() as { wallet: string }).wallet, wallet);

    const fieldResponse = await fetch(`${base}/field/verify`, {
      method: 'POST', headers: { ...headers, authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ fieldAddress: fieldAddress.toBase58() }),
    });
    assert.equal(fieldResponse.status, 200);
    assert.equal((await fieldResponse.json() as { fieldAddress: string; wallet: string }).fieldAddress, fieldAddress.toBase58());

    const initializeResponse = await fetch(`${base}/initialize`, {
      method: 'POST', headers: { ...headers, authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ fieldAddress: fieldAddress.toBase58(), requestId: '50000000-0000-4000-8000-000000000003' }),
    });
    assert.equal(initializeResponse.status, 201);
    assert.deepEqual(initializedRequest, {
      wallet, fieldAddress: fieldAddress.toBase58(), requestId: '50000000-0000-4000-8000-000000000003',
      evidence: { wallet, fieldAddress: fieldAddress.toBase58(), cluster: 'mainnet-beta', observedSlot: 456, commitment: 'finalized', fieldLevel: 1, fieldType: 0, durability: 5 },
    });

    const linkResponse = await fetch(`${base}/fields/link`, {
      method: 'POST', headers: { ...headers, authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ fieldAddress: fieldAddress.toBase58(), requestId: '50000000-0000-4000-8000-000000000001', expectedSequence: 1 }),
    });
    assert.equal(linkResponse.status, 200);
    assert.equal((await linkResponse.json() as { duplicate: boolean }).duplicate, false);
    assert.equal((linkedEvidence as { commitment: string }).commitment, 'finalized');

    const unlinkResponse = await fetch(`${base}/fields/unlink`, {
      method: 'POST', headers: { ...headers, authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ fieldAddress: fieldAddress.toBase58(), requestId: '50000000-0000-4000-8000-000000000002', expectedSequence: 2 }),
    });
    assert.equal(unlinkResponse.status, 200);
    assert.equal((await unlinkResponse.json() as { duplicate: boolean }).duplicate, false);
    assert.deepEqual(unlinkedRequest, { wallet, fieldAddress: fieldAddress.toBase58(), requestId: '50000000-0000-4000-8000-000000000002', expectedSequence: 2 });

    const replay = await fetch(`${base}/auth/verify`, { method: 'POST', headers, body: JSON.stringify({ wallet, challengeId: challenge.challengeId, message: challenge.message, signature }) });
    assert.equal(replay.status, 401);
    const wrongOrigin = await fetch(`${base}/auth/session`, { headers: { origin: 'https://attacker.example', authorization: `Bearer ${session.token}` } });
    assert.equal(wrongOrigin.status, 401);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
