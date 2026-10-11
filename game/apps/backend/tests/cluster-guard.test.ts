import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from '../src/gameops/pool.js';
import { bindPresaleDatabaseCluster } from '../src/gameops/clusterGuard.js';

function fakePool(initialCluster: 'devnet' | 'mainnet-beta' | null = null) {
  let boundCluster = initialCluster;
  let inserts = 0;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes('SELECT cluster FROM game_ops.presale_cluster_binding WHERE singleton = true')) {
        return { rows: boundCluster ? [{ cluster: boundCluster }] : [] };
      }
      if (sql.includes('INSERT INTO game_ops.presale_cluster_binding')) {
        inserts += 1;
        boundCluster ??= params[0] as 'devnet' | 'mainnet-beta';
        return { rows: [] };
      }
      if (sql.includes('SELECT cluster FROM game_ops.presale_cluster_binding WHERE singleton = true')) {
        return { rows: boundCluster ? [{ cluster: boundCluster }] : [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, get boundCluster() { return boundCluster; }, get inserts() { return inserts; } };
}

test('the first presale process pins an unbound database to its cluster', async () => {
  const db = fakePool();
  await bindPresaleDatabaseCluster(db.pool, 'devnet');
  assert.equal(db.boundCluster, 'devnet');
  assert.equal(db.inserts, 1);
});

test('matching cluster startup is idempotent without rewriting the binding', async () => {
  const db = fakePool('mainnet-beta');
  await bindPresaleDatabaseCluster(db.pool, 'mainnet-beta');
  assert.equal(db.boundCluster, 'mainnet-beta');
  assert.equal(db.inserts, 0);
});

test('a database bound to another cluster fails closed', async () => {
  const db = fakePool('devnet');
  await assert.rejects(bindPresaleDatabaseCluster(db.pool, 'mainnet-beta'), /database=devnet, configured=mainnet-beta/);
  assert.equal(db.boundCluster, 'devnet');
  assert.equal(db.inserts, 0);
});
