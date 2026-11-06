-- Серверная симуляция колонии (вариант 2, docs/COLONY_SERVER_SIM_PLAN.md).
--
-- Авторитетное состояние колонии живёт на сервере. Три таблицы:
--   colony_sim_sessions     — текущая позиция сеанса и последний снимок (перезаписывается);
--   colony_sim_actions      — журнал принятых действий (append-only, источник истины);
--   colony_spend_consumptions — какая квитанция colony_spend оплатила какое действие (append-only).
--
-- Снимок хранится как text, а не jsonb: jsonb переупорядочивает ключи при чтении, а хеш состояния
-- и воспроизведение журнала зависят от точного порядка ключей (см. serializeSession в движке).

CREATE TABLE IF NOT EXISTS game_ops.colony_sim_sessions (
  owner_wallet text PRIMARY KEY CHECK (length(owner_wallet) BETWEEN 32 AND 44),
  cluster text NOT NULL CHECK (cluster IN ('devnet', 'mainnet-beta')),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  snapshot_sequence bigint NOT NULL CHECK (snapshot_sequence >= 0 AND snapshot_sequence <= sequence),
  snapshot text NOT NULL CHECK (length(snapshot) BETWEEN 2 AND 8000000),
  state_hash text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  engine_version integer NOT NULL CHECK (engine_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_ops.colony_sim_actions (
  owner_wallet text NOT NULL CHECK (length(owner_wallet) BETWEEN 32 AND 44),
  cluster text NOT NULL CHECK (cluster IN ('devnet', 'mainnet-beta')),
  sequence bigint NOT NULL CHECK (sequence >= 1),
  request_id uuid NOT NULL UNIQUE,
  action jsonb NOT NULL,
  state_hash text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  engine_version integer NOT NULL CHECK (engine_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_wallet, sequence)
);

CREATE TABLE IF NOT EXISTS game_ops.colony_spend_consumptions (
  signature text PRIMARY KEY REFERENCES game_ops.colony_potato_spends (signature),
  owner_wallet text NOT NULL CHECK (length(owner_wallet) BETWEEN 32 AND 44),
  cluster text NOT NULL CHECK (cluster IN ('devnet', 'mainnet-beta')),
  request_id uuid NOT NULL UNIQUE,
  sim_sequence bigint NOT NULL CHECK (sim_sequence >= 1),
  consumed_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'colony_sim_actions_deny_update'
       AND tgrelid = 'game_ops.colony_sim_actions'::regclass
  ) THEN
    CREATE TRIGGER colony_sim_actions_deny_update
      BEFORE UPDATE ON game_ops.colony_sim_actions
      FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'colony_sim_actions_deny_delete'
       AND tgrelid = 'game_ops.colony_sim_actions'::regclass
  ) THEN
    CREATE TRIGGER colony_sim_actions_deny_delete
      BEFORE DELETE ON game_ops.colony_sim_actions
      FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'colony_spend_consumptions_deny_update'
       AND tgrelid = 'game_ops.colony_spend_consumptions'::regclass
  ) THEN
    CREATE TRIGGER colony_spend_consumptions_deny_update
      BEFORE UPDATE ON game_ops.colony_spend_consumptions
      FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'colony_spend_consumptions_deny_delete'
       AND tgrelid = 'game_ops.colony_spend_consumptions'::regclass
  ) THEN
    CREATE TRIGGER colony_spend_consumptions_deny_delete
      BEFORE DELETE ON game_ops.colony_spend_consumptions
      FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE ON game_ops.colony_sim_sessions TO game_ops_writer;
GRANT SELECT ON game_ops.colony_sim_sessions TO game_ops_reader;
GRANT SELECT, INSERT ON game_ops.colony_sim_actions TO game_ops_writer;
GRANT SELECT ON game_ops.colony_sim_actions TO game_ops_reader;
GRANT SELECT, INSERT ON game_ops.colony_spend_consumptions TO game_ops_writer;
GRANT SELECT ON game_ops.colony_spend_consumptions TO game_ops_reader;
