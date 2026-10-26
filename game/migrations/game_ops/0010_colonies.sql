-- Persistent hybrid colonies: PostgreSQL is authoritative for Colony/Lab/buildings;
-- Solana remains authoritative for wallet identity, Field ownership and token facts.
-- Mutations are transactional and every accepted state transition has an immutable event.

CREATE TABLE IF NOT EXISTS game_ops.colony_auth_challenges (
  challenge_id uuid PRIMARY KEY,
  wallet text NOT NULL CHECK (length(wallet) BETWEEN 32 AND 44),
  origin text NOT NULL CHECK (length(origin) BETWEEN 8 AND 255),
  nonce_hash text NOT NULL UNIQUE CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  message_hash text NOT NULL CHECK (message_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT colony_challenge_window CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'
  ),
  CONSTRAINT colony_challenge_consumed_after_issue CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);
CREATE INDEX IF NOT EXISTS colony_auth_challenges_expiry_idx
  ON game_ops.colony_auth_challenges (expires_at) WHERE consumed_at IS NULL;

-- Runtime may purge only expired challenges; it does not get table-wide DELETE.
CREATE OR REPLACE FUNCTION game_ops.purge_expired_colony_challenges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, game_ops
AS $$
DECLARE purged integer;
BEGIN
  DELETE FROM game_ops.colony_auth_challenges WHERE expires_at <= now();
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END;
$$;
REVOKE ALL ON FUNCTION game_ops.purge_expired_colony_challenges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION game_ops.purge_expired_colony_challenges() TO game_ops_writer;

-- Entitlements are created only by an independently reviewed fulfillment path.
-- No public purchase/grant endpoint exists while sales are closed.
CREATE TABLE IF NOT EXISTS game_ops.colony_entitlements (
  id uuid PRIMARY KEY,
  owner_wallet text NOT NULL CHECK (length(owner_wallet) BETWEEN 32 AND 44),
  sku_id text NOT NULL CHECK (sku_id IN ('STARTER_COLONY_V1', 'RESEARCH_WING_V1', 'FRONTIER_EXPANSION_V1', 'INDUSTRIAL_NETWORK_V1')),
  cluster text NOT NULL CHECK (cluster IN ('devnet', 'mainnet-beta')),
  source text NOT NULL CHECK (source IN ('verified_payment', 'internal_qa')),
  source_reference text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT colony_entitlement_source_reference_key UNIQUE (source, source_reference)
);
CREATE INDEX IF NOT EXISTS colony_entitlements_owner_idx
  ON game_ops.colony_entitlements (owner_wallet, cluster, sku_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS game_ops.colonies (
  id uuid PRIMARY KEY,
  entitlement_id uuid NOT NULL UNIQUE REFERENCES game_ops.colony_entitlements(id),
  owner_wallet text NOT NULL UNIQUE CHECK (length(owner_wallet) BETWEEN 32 AND 44),
  field_address text NOT NULL UNIQUE CHECK (length(field_address) BETWEEN 32 AND 44),
  ruleset_version smallint NOT NULL CHECK (ruleset_version > 0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  state_hash text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS colonies_field_idx ON game_ops.colonies (field_address);

CREATE TABLE IF NOT EXISTS game_ops.colony_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  colony_id uuid NOT NULL REFERENCES game_ops.colonies(id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  request_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]{2,48}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  previous_hash text NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash text NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT colony_events_sequence_key UNIQUE (colony_id, sequence),
  CONSTRAINT colony_events_request_key UNIQUE (colony_id, request_id)
);
CREATE INDEX IF NOT EXISTS colony_events_tail_idx ON game_ops.colony_events (colony_id, sequence DESC);

-- Challenge rows are mutable only once (consumed_at); colony rows are mutable only
-- through the server-authoritative state/version/hash fields; event history is immutable.
REVOKE ALL ON game_ops.colony_auth_challenges, game_ops.colony_entitlements, game_ops.colonies, game_ops.colony_events FROM PUBLIC;
GRANT SELECT, INSERT ON game_ops.colony_auth_challenges TO game_ops_writer;
GRANT UPDATE (consumed_at) ON game_ops.colony_auth_challenges TO game_ops_writer;
GRANT SELECT ON game_ops.colony_entitlements TO game_ops_writer;
GRANT SELECT, INSERT ON game_ops.colonies TO game_ops_writer;
GRANT UPDATE (state, sequence, state_hash, updated_at) ON game_ops.colonies TO game_ops_writer;
GRANT SELECT, INSERT ON game_ops.colony_events TO game_ops_writer;
GRANT SELECT ON game_ops.colonies, game_ops.colony_events TO game_ops_reader;
GRANT ALL ON game_ops.colony_auth_challenges, game_ops.colony_entitlements, game_ops.colonies, game_ops.colony_events TO game_ops_migrator;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_writer;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_reader;
GRANT ALL ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_migrator;

DROP TRIGGER IF EXISTS colony_events_deny_update ON game_ops.colony_events;
CREATE TRIGGER colony_events_deny_update BEFORE UPDATE ON game_ops.colony_events
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
DROP TRIGGER IF EXISTS colony_events_deny_delete ON game_ops.colony_events;
CREATE TRIGGER colony_events_deny_delete BEFORE DELETE ON game_ops.colony_events
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
CREATE OR REPLACE FUNCTION game_ops.deny_unexpired_colony_challenge_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.expires_at > now() THEN
    RAISE EXCEPTION 'active colony auth challenges are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION game_ops.deny_unexpired_colony_challenge_delete() FROM PUBLIC;
GRANT ALL ON FUNCTION game_ops.deny_unexpired_colony_challenge_delete() TO game_ops_migrator;
DROP TRIGGER IF EXISTS colony_auth_challenges_deny_delete ON game_ops.colony_auth_challenges;
CREATE TRIGGER colony_auth_challenges_deny_unexpired_delete BEFORE DELETE ON game_ops.colony_auth_challenges
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_unexpired_colony_challenge_delete();
DROP TRIGGER IF EXISTS colonies_deny_delete ON game_ops.colonies;
CREATE TRIGGER colonies_deny_delete BEFORE DELETE ON game_ops.colonies
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
