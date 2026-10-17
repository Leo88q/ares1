-- S7 (docs/S7_SLOT_AUTHORITY_SPEC.md): журнал выдачи слотов грядок.
--
-- Владение слотом хранится на сервере и подтверждается подписанной записью
-- (решение S7). Эта таблица — источник правды о том, какая запись выдана.
--
-- Правила, которые держит сама БД (а не только приложение):
--   • append-only: строка не меняется и не удаляется (отзыв — отдельной строкой,
--     таблица отзывов добавляется отдельной миграцией, когда будет решение);
--   • один платёж — один слот (UNIQUE на payment_signature);
--   • один nonce — одна запись (UNIQUE на nonce);
--   • один слот на поле (UNIQUE на field_id, slot);
--   • слоты 1..6 бесплатны и без платежа; слоты 7..12 — только за платёж;
--   • срок записи не больше часа (решение владельца по вопросу 2 S7).
--
-- Подпись записи и проверку платежа делает приложение; здесь хранится
-- результат (key_id, expires_at), чтобы аудит мог воспроизвести выдачу.

CREATE TABLE IF NOT EXISTS game_ops.slot_grants (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nonce             uuid        NOT NULL,
  field_id          text        NOT NULL CHECK (length(field_id) BETWEEN 1 AND 64),
  slot              integer     NOT NULL CHECK (slot BETWEEN 1 AND 12),
  wallet            text        NOT NULL CHECK (length(wallet) BETWEEN 32 AND 44),
  -- Подпись SKR-платежа. NULL только у бесплатных слотов 1..6.
  payment_signature text        CHECK (payment_signature IS NULL OR length(payment_signature) BETWEEN 64 AND 88),
  -- Сумма платежа в базовых единицах SKR (0 для бесплатных слотов).
  amount_units      bigint      NOT NULL CHECK (amount_units >= 0),
  key_id            text        NOT NULL CHECK (key_id ~ '^[a-z0-9._-]{1,40}$'),
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,

  CONSTRAINT slot_grants_nonce_key UNIQUE (nonce),
  CONSTRAINT slot_grants_payment_key UNIQUE (payment_signature),
  CONSTRAINT slot_grants_field_slot_key UNIQUE (field_id, slot),
  -- Бесплатные слоты 1..6: без платежа и без суммы. Платные 7..12: с платежом и суммой.
  CONSTRAINT slot_grants_free_or_paid CHECK (
    (slot <= 6 AND payment_signature IS NULL AND amount_units = 0)
    OR (slot > 6 AND payment_signature IS NOT NULL AND amount_units > 0)
  ),
  -- Срок записи: строго после выдачи и не дольше часа.
  CONSTRAINT slot_grants_window CHECK (
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

-- Права: писатель только вставляет и читает; UPDATE/DELETE не выдаются вовсе.
REVOKE ALL ON game_ops.slot_grants FROM PUBLIC;
GRANT SELECT, INSERT ON game_ops.slot_grants TO game_ops_writer;
GRANT SELECT ON game_ops.slot_grants TO game_ops_reader;
GRANT ALL ON game_ops.slot_grants TO game_ops_migrator;
-- Identity-последовательность этой таблицы создана позже общих грантов из 0003/0006.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_writer;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_reader;
GRANT ALL ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_migrator;
