-- Free starter access is a dev/staging onboarding entitlement, not a sale.
-- The runtime role can call one tightly-scoped function, never INSERT entitlements.
ALTER TABLE game_ops.colony_entitlements
  DROP CONSTRAINT IF EXISTS colony_entitlements_source_check;
ALTER TABLE game_ops.colony_entitlements
  ADD CONSTRAINT colony_entitlements_source_check
  CHECK (source IN ('verified_payment', 'internal_qa', 'free_onboarding'));

CREATE OR REPLACE FUNCTION game_ops.claim_free_colony_starter(
  p_id uuid,
  p_owner_wallet text,
  p_cluster text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, game_ops
AS $$
DECLARE
  entitlement_id uuid;
BEGIN
  IF p_owner_wallet IS NULL OR length(p_owner_wallet) NOT BETWEEN 32 AND 44
     OR p_cluster IS NULL OR p_cluster NOT IN ('devnet', 'mainnet-beta') THEN
    RAISE EXCEPTION 'INVALID_FREE_STARTER_CLAIM' USING ERRCODE = '22023';
  END IF;

  INSERT INTO game_ops.colony_entitlements
    (id, owner_wallet, sku_id, cluster, source, source_reference, metadata)
  VALUES (
    p_id,
    p_owner_wallet,
    'STARTER_COLONY_V1',
    p_cluster,
    'free_onboarding',
    'free-starter-v1:' || p_cluster || ':' || p_owner_wallet,
    jsonb_build_object('grant', 'one-per-wallet', 'version', 1)
  )
  ON CONFLICT (owner_wallet, cluster, sku_id) WHERE revoked_at IS NULL DO NOTHING;

  SELECT id INTO entitlement_id
    FROM game_ops.colony_entitlements
   WHERE owner_wallet = p_owner_wallet
     AND cluster = p_cluster
     AND sku_id = 'STARTER_COLONY_V1'
     AND revoked_at IS NULL
   ORDER BY granted_at ASC
   LIMIT 1;

  IF entitlement_id IS NULL THEN
    RAISE EXCEPTION 'FREE_STARTER_CLAIM_FAILED' USING ERRCODE = '23514';
  END IF;
  RETURN entitlement_id;
END;
$$;
REVOKE ALL ON FUNCTION game_ops.claim_free_colony_starter(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION game_ops.claim_free_colony_starter(uuid, text, text) TO game_ops_writer;
GRANT ALL ON FUNCTION game_ops.claim_free_colony_starter(uuid, text, text) TO game_ops_migrator;
