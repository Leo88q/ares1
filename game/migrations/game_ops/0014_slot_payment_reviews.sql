-- Очередь ручного разбора по слотам (S7): «деньги списаны, слот не выдан».
--
-- Почему отдельная таблица, а не строка в логе приложения: платёж может быть
-- валидным (финализирован, ровно нужная сумма, правильный минт), а слот — уже
-- занятым другим кошельком. Правильное поведение — не выдать слот и НЕ потерять
-- платёж: buyer'у нужен возврат, оператору — доказательство. Раньше оставалась
-- только запись в stdout-аудите: процесс перезапустили, лог уехал — денежный
-- след исчез.
--
-- Гарантии БД:
--   • одна подпись платежа — одна строка разбора (UNIQUE), повторный запрос не
--     плодит дубликаты;
--   • удалять строки нельзя (deny_mutation): история разбора не «чистится»;
--   • «решено» нельзя поставить без доказательства: refunded/regranted обязаны
--     иметь resolved_at и подпись транзакции, которая это подтверждает.
--     Оператор не может закрыть пункт словами «вернули» — только цепью.

CREATE TABLE IF NOT EXISTS game_ops.slot_payment_reviews (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_signature    text        NOT NULL CHECK (length(payment_signature) BETWEEN 64 AND 88),
  field_id             text        NOT NULL CHECK (length(field_id) BETWEEN 1 AND 64),
  slot                 integer     NOT NULL CHECK (slot BETWEEN 1 AND 12),
  wallet               text        NOT NULL CHECK (length(wallet) BETWEEN 32 AND 44),
  -- Что именно возвращаем: минт фиксируется в строке, а не берётся из
  -- конфигурации на момент разбора (конфигурация могла измениться, а вернуть
  -- нужно тот токен, который реально списали).
  mint                 text        NOT NULL CHECK (length(mint) BETWEEN 32 AND 44),
  -- Сколько базовых единиц SKR пришло от покупателя (ровно столько и возвращают).
  amount_units         bigint      NOT NULL CHECK (amount_units > 0),
  reason               text        NOT NULL CHECK (reason ~ '^[A-Z0-9_]{3,64}$'),
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','refunded','regranted','rejected')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz,
  resolution_signature text        CHECK (resolution_signature IS NULL OR length(resolution_signature) BETWEEN 64 AND 88),
  resolution_note      text        CHECK (resolution_note IS NULL OR length(resolution_note) <= 500),

  CONSTRAINT slot_payment_reviews_payment_key UNIQUE (payment_signature),
  CONSTRAINT slot_payment_reviews_resolution_evidence CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolution_signature IS NULL)
    OR (status = 'rejected' AND resolved_at IS NOT NULL)
    OR (status IN ('refunded','regranted') AND resolved_at IS NOT NULL AND resolution_signature IS NOT NULL)
  )
);

-- Очередь оператора: сначала необработанные, потом по времени.
CREATE INDEX IF NOT EXISTS slot_payment_reviews_status_idx
  ON game_ops.slot_payment_reviews (status, created_at);
-- Поиск «а этот платёж уже разбирали?» идёт по подписи (UNIQUE выше), а по
-- кошельку — для поддержки: «что было с этим покупателем».
CREATE INDEX IF NOT EXISTS slot_payment_reviews_wallet_idx
  ON game_ops.slot_payment_reviews (wallet, created_at DESC);

-- Удаление запрещено: закрытый разбор — это доказательство, а не мусор.
DROP TRIGGER IF EXISTS slot_payment_reviews_deny_delete ON game_ops.slot_payment_reviews;
CREATE TRIGGER slot_payment_reviews_deny_delete
  BEFORE DELETE ON game_ops.slot_payment_reviews
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

-- Что нельзя менять после закрытия: подпись, сумму и адресата разбора.
-- Разрешено только само закрытие (status/resolved_at/resolution_*).
CREATE OR REPLACE FUNCTION game_ops.slot_payment_reviews_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_signature IS DISTINCT FROM OLD.payment_signature
     OR NEW.field_id IS DISTINCT FROM OLD.field_id
     OR NEW.slot IS DISTINCT FROM OLD.slot
     OR NEW.wallet IS DISTINCT FROM OLD.wallet
     OR NEW.mint IS DISTINCT FROM OLD.mint
     OR NEW.amount_units IS DISTINCT FROM OLD.amount_units
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'SLOT_PAYMENT_REVIEW_IMMUTABLE_FIELD'
      USING DETAIL = format('Разбор %s: подпись/поле/слот/кошелёк/минт/сумма/причина/создание неизменяемы', OLD.id);
  END IF;
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'SLOT_PAYMENT_REVIEW_ALREADY_RESOLVED'
      USING DETAIL = format('Разбор %s уже закрыт как %s', OLD.id, OLD.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS slot_payment_reviews_guard ON game_ops.slot_payment_reviews;
CREATE TRIGGER slot_payment_reviews_guard
  BEFORE UPDATE ON game_ops.slot_payment_reviews
  FOR EACH ROW EXECUTE FUNCTION game_ops.slot_payment_reviews_guard();

-- Права: писатель вставляет и закрывает; денежные колонки на UPDATE не выдаются.
REVOKE ALL ON game_ops.slot_payment_reviews FROM PUBLIC;
GRANT SELECT, INSERT ON game_ops.slot_payment_reviews TO game_ops_writer;
GRANT UPDATE (status, resolved_at, resolution_signature, resolution_note)
  ON game_ops.slot_payment_reviews TO game_ops_writer;
GRANT SELECT ON game_ops.slot_payment_reviews TO game_ops_reader;
GRANT ALL ON game_ops.slot_payment_reviews TO game_ops_migrator;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_writer;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_reader;
GRANT ALL ON ALL SEQUENCES IN SCHEMA game_ops TO game_ops_migrator;
