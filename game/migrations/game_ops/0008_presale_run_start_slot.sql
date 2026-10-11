-- Record the first finalized slot eligible for this run's reconciliation.
-- Existing runs use 0 and retain their original full-history semantics; newly
-- opened runs are pinned to finalized_slot + 1 by the API/CLI.
ALTER TABLE game_ops.presale_runs
  ADD COLUMN IF NOT EXISTS started_slot bigint NOT NULL DEFAULT 0 CHECK (started_slot >= 0);
