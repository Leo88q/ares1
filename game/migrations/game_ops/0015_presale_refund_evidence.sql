-- Возврат по заказу пресейла: решение и его исполнение — разные факты.
--
-- Сейчас `refundOrder` переводит заказ в `refunded`, но деньги при этом никуда
-- не двигаются: перевод делает оператор (вывод из казны — двухшаговый, с
-- таймлоком). Из-за этого «refunded» смешивало две разные вещи — «решено
-- вернуть» и «вернули», а очередь внимания показывала такие заказы вечно.
--
-- Здесь фиксируется ВТОРОЙ факт: подпись транзакции, в которой покупатель
-- реально получил возврат. Правило то же, что у очереди слотов (0014):
-- закрыть пункт можно доказательством из цепи, а не словом оператора.
--
-- Почему отдельная колонка, а не «status = refunded_paid»: состояние заказа —
-- это бизнес-переход (его держит триггер presale_orders_guard), а исполнение
-- возврата — независимый факт, который может появиться позже и не меняет
-- историю заказа.

ALTER TABLE game_ops.presale_orders
  ADD COLUMN IF NOT EXISTS refund_tx_signature text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'presale_orders_refund_signature_shape'
       AND conrelid = 'game_ops.presale_orders'::regclass
  ) THEN
    ALTER TABLE game_ops.presale_orders
      ADD CONSTRAINT presale_orders_refund_signature_shape
      CHECK (refund_tx_signature IS NULL
             OR (length(refund_tx_signature) BETWEEN 64 AND 88));
  END IF;

  -- Доказательство возврата существует только у возвращённого заказа: иначе
  -- подпись можно «приложить» к живому заказу и запутать сверку.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'presale_orders_refund_signature_requires_refunded'
       AND conrelid = 'game_ops.presale_orders'::regclass
  ) THEN
    ALTER TABLE game_ops.presale_orders
      ADD CONSTRAINT presale_orders_refund_signature_requires_refunded
      CHECK (refund_tx_signature IS NULL OR state = 'refunded');
  END IF;
END $$;

-- Очередь исполнения: возвращённые заказы без доказательства перевода.
CREATE INDEX IF NOT EXISTS presale_orders_refund_pending_idx
  ON game_ops.presale_orders (refunded_at)
  WHERE state = 'refunded' AND refund_tx_signature IS NULL;

-- Права: писатель закрывает возврат; сами суммы и адресат по-прежнему не его.
GRANT UPDATE (refund_tx_signature) ON game_ops.presale_orders TO game_ops_writer;

-- Покупатель должен видеть не только «refunded», но и саму транзакцию возврата:
-- это единственное, что он может проверить в обозревателе без обращения в
-- поддержку. Подпись — публичные данные цепи, маскировать нечего.
-- CREATE OR REPLACE VIEW умеет только ДОБАВЛЯТЬ колонки в конец — прежние
-- остаются на своих местах, поэтому гранты из 0006 не теряются.
CREATE OR REPLACE VIEW game_ops.presale_orders_public AS
  SELECT o.run_id,
         o.order_no,
         o.pack_id,
         r.currency,
         o.price_units,
         o.state,
         left(o.payer_wallet, 4) || '…' || right(o.payer_wallet, 4) AS payer_wallet_masked,
         o.created_at,
         o.paid_at,
         o.delivered_at,
         o.refunded_at,
         o.refund_tx_signature
  FROM game_ops.presale_orders o
  JOIN game_ops.presale_runs r ON r.run_id = o.run_id;

-- Записанная подпись возврата — окончательная. Без этого «доказательство»
-- можно заменить на другую транзакцию (в том числе чужую), и сверка увидит
-- закрытый возврат там, где покупатель ничего не получил.
CREATE OR REPLACE FUNCTION game_ops.presale_orders_refund_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.refund_tx_signature IS NOT NULL
     AND NEW.refund_tx_signature IS DISTINCT FROM OLD.refund_tx_signature THEN
    RAISE EXCEPTION 'PRESALE_REFUND_SIGNATURE_IMMUTABLE'
      USING DETAIL = format('Заказ %s: подпись возврата уже зафиксирована', OLD.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS presale_orders_refund_immutable ON game_ops.presale_orders;
CREATE TRIGGER presale_orders_refund_immutable
  BEFORE UPDATE ON game_ops.presale_orders
  FOR EACH ROW EXECUTE FUNCTION game_ops.presale_orders_refund_immutable();

-- Кто и когда закрыл возврат — тоже факт, и он должен остаться в журнале.
-- Триггер аудита из 0005 пишет только переходы состояний; запись подписи
-- возврата состоянием не является, без этого в аудите не осталось бы следа.
CREATE OR REPLACE FUNCTION game_ops.presale_orders_refund_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM game_ops.write_audit('presale_order.refund_settled', 'presale_orders', NEW.id, 'ok',
    format('signature=%s state=%s', left(NEW.refund_tx_signature, 10), NEW.state));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS presale_orders_refund_audit ON game_ops.presale_orders;
CREATE TRIGGER presale_orders_refund_audit
  AFTER UPDATE OF refund_tx_signature ON game_ops.presale_orders
  FOR EACH ROW
  WHEN (OLD.refund_tx_signature IS DISTINCT FROM NEW.refund_tx_signature)
  EXECUTE FUNCTION game_ops.presale_orders_refund_audit();
