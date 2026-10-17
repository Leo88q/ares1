-- S7 (docs/S7_SLOT_AUTHORITY_SPEC.md): владение слотами грядок и выдача подписанных записей.
--
-- Две таблицы, потому что у них разный жизненный цикл:
--   • slot_grants — ВЛАДЕНИЕ: «слот N поля F принадлежит кошельку W». Одна строка на слот.
--     Бесплатные слоты 1..6 — без платежа; платные 7..12 — ровно один платёж на слот.
--   • slot_record_issuances — ВЫДАЧА: каждая подписанная запись со своим nonce и сроком (≤ 1 ч).
--     Повторная выдача (например, после истечения записи) — новая строка, владение не меняется.
--
-- Правила, которые держит сама БД (а не только приложение):
--   • append-only в обеих таблицах: строка не меняется и не удаляется;
--   • один платёж — один слот (UNIQUE на payment_signature);
--   • один слот на поле (UNIQUE на field_id, slot);
--   • один nonce — одна выдача (UNIQUE на nonce);
--   • слоты 1..6 без платежа, 7..12 только с платежом;
--   • срок записи строго после выдачи и не дольше часа (решение S7, вопрос 2).
--
-- Подпись и проверку платежа делает приложение; здесь хранится результат.

CREATE TABLE IF NOT EXISTS game_ops.slot_grants (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  field_id          text        NOT NULL CHECK (length(field_id) BETWEEN 1 AND 64),
  slot              integer     NOT NULL CHECK (slot BETWEEN 1 AND 12),
  wallet            text        NOT NULL CHECK (length(wallet) BETWEEN 32 AND 44),
  -- Подпись SKR-платежа. NULL только у бесплатных слотов 1..6.
  payment_signature text        CHECK (payment_signature IS NULL OR length(payment_signature) BETWEEN 64 AND 88),
  -- Сумма платежа в базовых единицах SKR (0 для бесплатных слотов).
  amount_units      bigint      NOT NULL CHECK (amount_units >= 0),
  granted_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT slot_grants_payment_key UNIQUE (payment_signature),
  CONSTRAINT slot_grants_field_slot_key UNIQUE (field_id, slot),
  CONSTRAINT slot_grants_free_or_paid CHECK (
    (slot <= 6 AND payment_signature IS NULL AND amount_units = 0)
    OR (slot > 6 AND payment_signature IS NOT NULL AND amount_units > 0)
  )
);

CREATE TABLE IF NOT EXISTS game_ops.slot_record_issuances (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grant_id     bigint      NOT NULL REFERENCES game_ops.slot_grants (id),
  nonce        uuid        NOT NULL,
  key_id       text        NOT NULL CHECK (key_id ~ '^[a-z0-9._-]{1,40}$'),
  -- sha256 канонической записи: аудит может проверить, что выдано именно то, что подписано.
  record_hash  text        NOT NULL CHECK (record_hash ~ '^[0-9a-f]{64}$'),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,

  CONSTRAINT slot_record_issuances_nonce_key UNIQUE (nonce),
  CONSTRAINT slot_record_issuances_window CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '1 hour'
  )
);

-- Append-only на уровне триггера (та же функция, что для журнала наград).
DROP TRIGGER IF EXISTS slot_grants_deny_update ON game_ops.slot_grants;
CREATE TRIGGER slot_grants_deny_update
  BEFORE UPDATE ON game_ops.slot_grants
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

DROP TRIGGER IF EXISTS slot_grants_deny_delete ON game_ops.slot_grants;
CREATE TRIGGER slot_grants_deny_delete
  BEFORE DELETE ON game_ops.slot_grants
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

DROP TRIGGER IF EXISTS slot_record_issuances_deny_update ON game_ops.slot_record_issuances;
CREATE TRIGGER slot_record_issuances_deny_update
  BEFORE UPDATE ON game_ops.slot_record_issuances
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

DROP TRIGGER IF EXISTS slot_record_issuances_deny_delete ON game_ops.slot_record_issuances;
CREATE TRIGGER slot_record_issuances_deny_delete
  BEFORE DELETE ON game_ops.slot_record_issuances
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

-- Права: писатель только вставляет и читает; UPDATE/DELETE не выдаются вовсе.
REVOKE ALL ON game_ops.slot_grants FROM PUBLIC;
REVOKE ALL ON game_ops.slot_record_issuances FROM PUBLIC;
GRANT SELECT, INSERT ON game_ops.slot_grants TO game_ops_writer;
GRANT SELECT, INSERT ON game_ops.slot_record_issuances TO game_ops_writer;
GRANT SELECT ON game_ops.slot_grants TO game_ops_reader;
GRANT SELECT ON game_ops.slot_record_issuances TO game_ops_reader;
GRANT ALL ON game_ops.slot_grants TO game_ops_migrator;
GRANT ALL ON game_ops.slot_record_issuances TO game_ops_migrator;
-- Identity-последовательности этих таблиц созданы позже общих грантов из 0003/0006.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_writer;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_reader;
GRANT ALL ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_migrator;
