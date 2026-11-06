-- Колонийные траты POTATO (вариант B, docs/COLONY_POTATO_ECONOMY_PROPOSAL.md).
--
-- Каждая засчитанная трата — это подпись транзакции `colony_spend`, которую
-- бэкенд уже проверил в сети (сжигание ровно заявленной суммы, подпись владельца).
-- Одна подпись — одна строка: повтор возвращает ту же квитанцию, а не вторую.
-- Таблица append-only: квитанцию нельзя ни изменить, ни удалить.

CREATE TABLE IF NOT EXISTS game_ops.colony_potato_spends (
  signature text PRIMARY KEY CHECK (length(signature) BETWEEN 80 AND 90),
  owner_wallet text NOT NULL CHECK (length(owner_wallet) BETWEEN 32 AND 44),
  cluster text NOT NULL CHECK (cluster IN ('devnet', 'mainnet-beta')),
  amount_micro bigint NOT NULL CHECK (amount_micro > 0 AND amount_micro <= 10000000000),
  purpose smallint NOT NULL CHECK (purpose IN (1, 2, 3)),
  slot bigint NOT NULL CHECK (slot >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS colony_potato_spends_owner_idx
  ON game_ops.colony_potato_spends (owner_wallet, recorded_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'colony_potato_spends_deny_update'
       AND tgrelid = 'game_ops.colony_potato_spends'::regclass
  ) THEN
    CREATE TRIGGER colony_potato_spends_deny_update
      BEFORE UPDATE ON game_ops.colony_potato_spends
      FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'colony_potato_spends_deny_delete'
       AND tgrelid = 'game_ops.colony_potato_spends'::regclass
  ) THEN
    CREATE TRIGGER colony_potato_spends_deny_delete
      BEFORE DELETE ON game_ops.colony_potato_spends
      FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();
  END IF;
END
$$;

GRANT SELECT, INSERT ON game_ops.colony_potato_spends TO game_ops_writer;
GRANT SELECT ON game_ops.colony_potato_spends TO game_ops_reader;
