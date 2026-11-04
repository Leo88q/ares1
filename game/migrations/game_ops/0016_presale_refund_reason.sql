-- Причина возврата пресейла: решение оператора должно пережить сам возврат.
--
-- Сейчас `refundOrder` требует причину (`reason.trim().length >= 3`), но
-- сохраняет её только как `failure_code = 'REFUND_' || upper(left(md5($2), 4))`,
-- то есть четыре шестнадцатеричных символа. Через час после возврата ответить на
-- вопрос «почему покупателю вернули деньги» невозможно: 65 536 значений хэша на
-- все причины, а исходного текста в базе нет вообще. Для денежной операции это
-- означает, что спор с покупателем разбирается по памяти оператора.
--
-- Здесь причина становится фактом строки заказа:
--   • текст 3..500 символов (то же правило, что в коде, но проверяемое базой);
--   • существует только у возвращённого заказа — «причина возврата» на живом
--     заказе бессмысленна и мешала бы сверке;
--   • записывается один раз: подменить причину после решения нельзя;
--   • в публичное представление НЕ попадает: там подпись перевода (её покупатель
--     может проверить сам), а заметки оператора — внутренние данные.

ALTER TABLE game_ops.presale_orders
  ADD COLUMN IF NOT EXISTS refund_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'presale_orders_refund_reason_shape'
       AND conrelid = 'game_ops.presale_orders'::regclass
  ) THEN
    ALTER TABLE game_ops.presale_orders
      ADD CONSTRAINT presale_orders_refund_reason_shape
      CHECK (refund_reason IS NULL OR length(btrim(refund_reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'presale_orders_refund_reason_requires_refunded'
       AND conrelid = 'game_ops.presale_orders'::regclass
  ) THEN
    ALTER TABLE game_ops.presale_orders
      ADD CONSTRAINT presale_orders_refund_reason_requires_refunded
      CHECK (refund_reason IS NULL OR state = 'refunded');
  END IF;
END $$;

-- Причина — часть решения, а не комментарий: после записи её нельзя ни
-- переписать, ни стереть. Иначе «почему вернули» снова станет непроверяемым.
CREATE OR REPLACE FUNCTION game_ops.presale_orders_refund_reason_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.refund_reason IS NOT NULL
     AND NEW.refund_reason IS DISTINCT FROM OLD.refund_reason THEN
    RAISE EXCEPTION 'PRESALE_REFUND_REASON_IMMUTABLE'
      USING DETAIL = format('Заказ %s: причина возврата уже зафиксирована', OLD.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS presale_orders_refund_reason_immutable ON game_ops.presale_orders;
CREATE TRIGGER presale_orders_refund_reason_immutable
  BEFORE UPDATE ON game_ops.presale_orders
  FOR EACH ROW EXECUTE FUNCTION game_ops.presale_orders_refund_reason_immutable();

-- Права те же, что у подписи возврата: писатель закрывает возврат, но суммы и
-- адресат по-прежнему не его.
GRANT UPDATE (refund_reason) ON game_ops.presale_orders TO game_ops_writer;

-- Триггер аудита 0005 пишет только переходы состояний. Причина приходит позже
-- перевода в `refunded` (оператор вводит её одновременно, но отдельным UPDATE
-- не обязана), поэтому фиксируем её явно — с md5, как и остальные детали аудита
-- (сам текст в аудит не попадает, но доказать «эта причина та же» можно).
CREATE OR REPLACE FUNCTION game_ops.presale_orders_refund_reason_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM game_ops.write_audit('presale_order.refund_reason', 'presale_orders', NEW.id, 'ok',
    format('reason_md5=%s state=%s', md5(NEW.refund_reason), NEW.state));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS presale_orders_refund_reason_audit ON game_ops.presale_orders;
CREATE TRIGGER presale_orders_refund_reason_audit
  AFTER UPDATE OF refund_reason ON game_ops.presale_orders
  FOR EACH ROW
  WHEN (NEW.refund_reason IS NOT NULL AND OLD.refund_reason IS DISTINCT FROM NEW.refund_reason)
  EXECUTE FUNCTION game_ops.presale_orders_refund_reason_audit();
