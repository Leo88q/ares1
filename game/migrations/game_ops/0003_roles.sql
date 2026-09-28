-- game_ops: роли и гранты — «жёсткий» слой неизменяемости.
--
-- Почему именно так: в PostgreSQL append-only обеспечивается правами, а не только
-- триггерами. Роль-писатель физически не имеет UPDATE/DELETE на журнал, аудит и
-- сверку; UPDATE разрешён по колонкам (column-level), а не на таблицу — поэтому
-- «подправить сумму» в интенте нельзя даже своим кодом.
--
-- Файл опционален для managed-баз, где нельзя создавать роли: применяется
-- `yarn db:roles` (или `yarn db:migrate --with-roles`) под суперпользователем.
-- Проверка фактических прав — `yarn db:verify` (has_table_privilege/has_column_privilege).
--
-- Роли:
--   game_ops_migrator — DDL и обслуживание (владелец схемы). НЕ для приложения.
--   game_ops_writer   — рантайм: интенты + зеркало + аудит + курсоры.
--   game_ops_reader   — только чтение (дашборды, аудит-выгрузки).
--
-- Логины (LOGIN) создаёт деплой и выдаёт им соответствующую роль:
--   GRANT game_ops_writer TO ares1_backend;   -- см. scripts/db-roles.ts

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_ops_migrator') THEN
    CREATE ROLE game_ops_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_ops_writer') THEN
    CREATE ROLE game_ops_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_ops_reader') THEN
    CREATE ROLE game_ops_reader NOLOGIN;
  END IF;
END $$;

-- Приложение не должно подключаться мигратором: у него нет прав на DDL.
REVOKE CREATE ON SCHEMA game_ops FROM game_ops_writer;
REVOKE CREATE ON SCHEMA game_ops FROM game_ops_reader;

GRANT USAGE ON SCHEMA game_ops TO game_ops_writer, game_ops_reader;

-- ── Чтение ───────────────────────────────────────────────────────────────────
-- Ридер видит только представления и справочные таблицы: ему не нужны ни
-- сырые интенты (в них обоснования), ни голова цепочки.
GRANT SELECT ON game_ops.reward_intents_actionable TO game_ops_reader;
GRANT SELECT ON game_ops.reward_ledger_tail TO game_ops_reader;
GRANT SELECT ON game_ops.chain_reconciliation_latest TO game_ops_reader;
GRANT SELECT ON game_ops.admin_audit TO game_ops_reader;
GRANT SELECT ON game_ops.schema_version TO game_ops_reader;

-- ── Рантайм-писатель ─────────────────────────────────────────────────────────
-- Интенты: вставка, чтение и обновление ТОЛЬКО служебных колонок.
GRANT SELECT, INSERT ON game_ops.reward_intents TO game_ops_writer;
GRANT UPDATE (state, signature, slot, failure_code, updated_at)
  ON game_ops.reward_intents TO game_ops_writer;

-- Журнал: только вставка и чтение. Ни UPDATE, ни DELETE не выдаются никогда.
GRANT SELECT, INSERT ON game_ops.reward_ledger TO game_ops_writer;

-- Голова цепочки: двигается триггером от имени писателя — разрешены только
-- колонки самой головы, не произвольные.
GRANT SELECT, INSERT ON game_ops.ledger_chain_head TO game_ops_writer;
GRANT UPDATE (last_hash, last_id, last_slot, row_count, updated_at)
  ON game_ops.ledger_chain_head TO game_ops_writer;

-- Аудит: только вставка (триггеры пишут от имени вызывающего) и чтение.
GRANT SELECT, INSERT ON game_ops.admin_audit TO game_ops_writer;
REVOKE UPDATE, DELETE ON game_ops.admin_audit FROM game_ops_writer;

-- Сверка: только вставка и чтение.
GRANT SELECT, INSERT ON game_ops.chain_reconciliation TO game_ops_writer;

-- Курсоры: единственная таблица, где писателю разрешён UPDATE (CAS по version).
GRANT SELECT, INSERT ON game_ops.service_cursors TO game_ops_writer;
GRANT UPDATE (version, state, updated_at) ON game_ops.service_cursors TO game_ops_writer;

-- Последовательности identity нужны для INSERT.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_writer;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_reader;

-- Страховка: даже если кто-то выдаст права шире, эти REVOKE фиксируют запрет.
-- (Табличный REVOKE снимает и column-level гранты, поэтому он идёт ПЕРЕД
-- повторной выдачей колоночных прав — порядок критичен.)
REVOKE UPDATE, DELETE ON game_ops.reward_ledger FROM game_ops_writer;
REVOKE UPDATE, DELETE ON game_ops.chain_reconciliation FROM game_ops_writer;
REVOKE UPDATE, DELETE ON game_ops.admin_audit FROM game_ops_writer;
GRANT UPDATE (state, signature, slot, failure_code, updated_at)
  ON game_ops.reward_intents TO game_ops_writer;
GRANT UPDATE (last_hash, last_id, last_slot, row_count, updated_at)
  ON game_ops.ledger_chain_head TO game_ops_writer;
GRANT UPDATE (version, state, updated_at) ON game_ops.service_cursors TO game_ops_writer;

-- Мигратор — владелец схемы: DDL, обслуживание, но не рантайм-путь приложения.
GRANT ALL ON SCHEMA game_ops TO game_ops_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA game_ops TO game_ops_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_migrator;
