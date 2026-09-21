BEGIN;
CREATE SCHEMA IF NOT EXISTS watchtower;
CREATE TABLE IF NOT EXISTS watchtower.schema_version (version integer PRIMARY KEY CHECK (version = 1));
INSERT INTO watchtower.schema_version VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS watchtower.cursors (
  stream_id text PRIMARY KEY, version integer NOT NULL DEFAULT 0,
  state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS watchtower.transactions (
  cluster text NOT NULL, signature text NOT NULL, slot bigint NOT NULL,
  block_time timestamptz, program_id text NOT NULL, source text NOT NULL,
  commitment text NOT NULL CHECK (commitment = 'finalized'),
  fingerprint text NOT NULL, raw jsonb NOT NULL,
  PRIMARY KEY (cluster, signature)
);
CREATE TABLE IF NOT EXISTS watchtower.raw_events (
  id bigserial PRIMARY KEY, cluster text NOT NULL, slot bigint NOT NULL,
  signature text NOT NULL, instruction_index integer NOT NULL, inner_index integer NOT NULL,
  program_id text NOT NULL, source text NOT NULL, applied boolean NOT NULL,
  -- One raw row is one invocation; all emit! payloads are retained in this array.
  payload jsonb NOT NULL,
  UNIQUE (cluster, slot, signature, instruction_index, inner_index),
  FOREIGN KEY (cluster, signature) REFERENCES watchtower.transactions(cluster, signature)
);
CREATE TABLE IF NOT EXISTS watchtower.normalized_events (
  id bigserial PRIMARY KEY, raw_id bigint NOT NULL REFERENCES watchtower.raw_events(id),
  log_index integer NOT NULL, event_type text NOT NULL, category text NOT NULL,
  parser_version text NOT NULL, payload jsonb NOT NULL,
  UNIQUE (raw_id, log_index)
);
CREATE INDEX IF NOT EXISTS wt_event_type ON watchtower.normalized_events(event_type, id);
CREATE INDEX IF NOT EXISTS wt_raw_scope ON watchtower.raw_events(cluster, program_id, source, slot);
CREATE INDEX IF NOT EXISTS wt_tx_time ON watchtower.transactions(block_time);
CREATE TABLE IF NOT EXISTS watchtower.data_quality (
  stream_id text NOT NULL, code text NOT NULL, resolved boolean NOT NULL DEFAULT false,
  first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, code)
);
CREATE TABLE IF NOT EXISTS watchtower.audit_records (
  id bigserial PRIMARY KEY, stream_id text NOT NULL, event_type text NOT NULL,
  detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS watchtower.reconciliation_state (
  stream_id text PRIMARY KEY, finalized_slot bigint, checked_at timestamptz NOT NULL DEFAULT now(),
  history_coverage text NOT NULL DEFAULT 'provider_available_only'
);
-- A view avoids double counting on replay/crash recovery. Refresh is not needed.
CREATE OR REPLACE VIEW watchtower.daily_projections AS
SELECT r.cluster, r.program_id, r.source,
       (t.block_time AT TIME ZONE 'UTC')::date AS day, n.event_type,
       count(*)::text AS event_count
FROM watchtower.normalized_events n JOIN watchtower.raw_events r ON r.id = n.raw_id
JOIN watchtower.transactions t ON t.cluster = r.cluster AND t.signature = r.signature
WHERE r.applied AND t.block_time IS NOT NULL
GROUP BY r.cluster, r.program_id, r.source, (t.block_time AT TIME ZONE 'UTC')::date, n.event_type;
COMMIT;
