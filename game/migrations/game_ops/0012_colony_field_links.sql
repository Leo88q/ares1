-- Persist verified Field associations. Links are eligibility slots only: the
-- association itself grants no on-chain rights or resource output.
CREATE TABLE IF NOT EXISTS game_ops.colony_fields (
  id uuid PRIMARY KEY,
  colony_id uuid NOT NULL REFERENCES game_ops.colonies(id),
  field_address text NOT NULL CHECK (length(field_address) BETWEEN 32 AND 44),
  is_primary boolean NOT NULL DEFAULT false,
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  CONSTRAINT colony_fields_unlinked_after_link CHECK (unlinked_at IS NULL OR unlinked_at >= linked_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS colony_fields_one_primary_idx
  ON game_ops.colony_fields (colony_id) WHERE is_primary AND unlinked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS colony_fields_one_active_address_idx
  ON game_ops.colony_fields (field_address) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS colony_fields_colony_idx
  ON game_ops.colony_fields (colony_id, linked_at, field_address);

-- Preserve every existing Colony's already-verified primary Field association.
-- The deterministic UUID lets migration retries remain idempotent without extensions.
INSERT INTO game_ops.colony_fields (id, colony_id, field_address, is_primary, linked_at)
SELECT md5(id::text || ':' || field_address)::uuid, id, field_address, true, created_at
  FROM game_ops.colonies
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON game_ops.colony_fields FROM PUBLIC;
GRANT UPDATE (ruleset_version) ON game_ops.colonies TO game_ops_writer;
GRANT SELECT, INSERT ON game_ops.colony_fields TO game_ops_writer;
GRANT UPDATE (unlinked_at) ON game_ops.colony_fields TO game_ops_writer;
GRANT SELECT ON game_ops.colony_fields TO game_ops_reader;
GRANT ALL ON game_ops.colony_fields TO game_ops_migrator;

CREATE OR REPLACE FUNCTION game_ops.guard_colony_field_link_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.unlinked_at IS NULL
     AND NEW.unlinked_at IS NOT NULL
     AND NEW.id = OLD.id
     AND NEW.colony_id = OLD.colony_id
     AND NEW.field_address = OLD.field_address
     AND NEW.is_primary = OLD.is_primary
     AND NEW.linked_at = OLD.linked_at
     AND EXISTS (
       SELECT 1 FROM game_ops.colony_events e
        WHERE e.colony_id = OLD.colony_id
          AND e.event_type = 'colony_field_unlinked'
          AND e.payload->>'fieldAddress' = OLD.field_address
          AND e.payload->>'linkId' = OLD.id::text
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'COLONY_FIELD_LINK_IMMUTABLE' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION game_ops.guard_colony_field_link_mutation() FROM PUBLIC;
GRANT ALL ON FUNCTION game_ops.guard_colony_field_link_mutation() TO game_ops_migrator;

DROP TRIGGER IF EXISTS colony_fields_deny_update ON game_ops.colony_fields;
CREATE TRIGGER colony_fields_deny_update BEFORE UPDATE ON game_ops.colony_fields
  FOR EACH ROW EXECUTE FUNCTION game_ops.guard_colony_field_link_mutation();
DROP TRIGGER IF EXISTS colony_fields_deny_delete ON game_ops.colony_fields;
CREATE TRIGGER colony_fields_deny_delete BEFORE DELETE ON game_ops.colony_fields
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
