import type { SolanaCluster } from '../env.js';
import { withTransaction, type Pool } from './pool.js';

/**
 * Atomically pins the presale database to one Solana cluster. The binding is
 * write-once by design: an operator must not reuse a devnet order ledger for
 * mainnet (or vice versa) just by changing an environment variable.
 */
export async function bindPresaleDatabaseCluster(pool: Pool, cluster: SolanaCluster): Promise<void> {
  const databaseCluster = await withTransaction<SolanaCluster | null>(pool, 'startup:presale-cluster-bind', async client => {
    const existing = await client.query<{ cluster: SolanaCluster }>(
      'SELECT cluster FROM game_ops.presale_cluster_binding WHERE singleton = true',
    );
    if (existing.rows[0]) return existing.rows[0].cluster;

    await client.query(
      `INSERT INTO game_ops.presale_cluster_binding (singleton, cluster)
       VALUES (true, $1) ON CONFLICT (singleton) DO NOTHING`,
      [cluster],
    );
    const claimed = await client.query<{ cluster: SolanaCluster }>(
      'SELECT cluster FROM game_ops.presale_cluster_binding WHERE singleton = true',
    );
    return claimed.rows[0]?.cluster ?? null;
  });

  if (databaseCluster !== cluster) {
    throw new Error(
      `Presale database cluster mismatch: database=${databaseCluster ?? 'unbound'}, configured=${cluster}`,
    );
  }
}
