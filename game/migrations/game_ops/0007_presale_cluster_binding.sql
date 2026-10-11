-- Bind a game_ops database to exactly one Solana cluster. This prevents a
-- devnet instance and a mainnet presale instance from sharing the same order
-- registry, even if operators accidentally reuse GAME_OPS_DATABASE_URL.
CREATE TABLE IF NOT EXISTS game_ops.presale_cluster_binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  cluster text NOT NULL CHECK (cluster IN ('devnet', 'mainnet-beta')),
  bound_at timestamptz NOT NULL DEFAULT now()
);

-- Runtime may read an existing binding or atomically claim a fresh database.
-- It cannot change or remove the binding; resetting it requires a deliberate
-- owner-level database operation after a reviewed migration/backup.
REVOKE ALL ON game_ops.presale_cluster_binding FROM PUBLIC;
GRANT SELECT, INSERT ON game_ops.presale_cluster_binding TO game_ops_writer;
GRANT ALL ON game_ops.presale_cluster_binding TO game_ops_migrator;
