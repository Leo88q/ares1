-- A wallet may own each Colony SKU at most once at a time. The package resolver
-- treats duplicate active entitlements as an integrity error, so enforce the
-- invariant at the database boundary (revoked rows remain available for audit).
CREATE UNIQUE INDEX IF NOT EXISTS colony_entitlements_one_active_sku_idx
  ON game_ops.colony_entitlements (owner_wallet, cluster, sku_id)
  WHERE revoked_at IS NULL;
