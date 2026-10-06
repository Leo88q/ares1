-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 presale: права. Тот же принцип, что в 0003_roles.sql — append-only
-- обеспечивается правами, а не только триггерами: роль-писатель физически не
-- может UPDATE денежную колонку, даже если код приложения ошибётся.
--
-- Файл опционален для managed-баз без права CREATE ROLE: применяется
-- `yarn db:roles` (или `yarn db:migrate --with-roles`) под суперпользователем.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Чтение ───────────────────────────────────────────────────────────────────
-- Ридеру — только публичное представление: ни email, ни кошельков целиком.
GRANT SELECT ON game_ops.presale_orders_public TO game_ops_reader;

-- ── Рантайм-писатель ─────────────────────────────────────────────────────────
-- Заказ: вставка и чтение; обновление — только служебных колонок состояния.
-- price_units, order_no, pack_id, payer_wallet, payer_email и reserved_until
-- писателю на UPDATE не выдаются вообще.
GRANT SELECT, INSERT ON game_ops.presale_orders TO game_ops_writer;
GRANT UPDATE (state, tx_signature, received_units, paid_slot, intent_id,
              failure_code, paid_at, delivered_at, refunded_at, updated_at)
  ON game_ops.presale_orders TO game_ops_writer;

-- Тираж: читается для гейта, изменяется только счётчик и флаг открытия.
-- Триггер presale_orders_count_slot двигает reserved_count от имени писателя,
-- поэтому колонка обязана быть выдана.
-- price_units, cap, treasury и pack_id на UPDATE не выдаются: цену и тираж
-- задним числом не меняют (см. триггер presale_runs_guard).
GRANT SELECT, INSERT ON game_ops.presale_runs TO game_ops_writer;
GRANT UPDATE (reserved_count, is_open, closed_at)
  ON game_ops.presale_runs TO game_ops_writer;

-- Последовательности identity для новых таблиц.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_writer;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_reader;

-- Страховка после табличных REVOKE (табличный REVOKE снимает колонковые гранты,
-- поэтому повторная выдача колонок идёт последней — порядок критичен).
REVOKE UPDATE, DELETE ON game_ops.presale_orders FROM game_ops_reader;
REVOKE UPDATE, DELETE ON game_ops.presale_runs FROM game_ops_reader;
GRANT UPDATE (state, tx_signature, received_units, paid_slot, intent_id,
              failure_code, paid_at, delivered_at, refunded_at, updated_at)
  ON game_ops.presale_orders TO game_ops_writer;
GRANT UPDATE (reserved_count, is_open, closed_at)
  ON game_ops.presale_runs TO game_ops_writer;

-- Мигратор — владелец схемы.
GRANT ALL ON SCHEMA game_ops TO game_ops_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA game_ops TO game_ops_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_migrator;
