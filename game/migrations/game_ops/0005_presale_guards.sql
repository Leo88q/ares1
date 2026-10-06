-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 presale: триггеры. Дублируют инварианты схемы так, чтобы их нельзя
-- было обойти своим же кодом (ошибка в приложении не должна превращаться
-- в расхождение учёта).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Счётчик занятых мест. Ведёт триггер, а не приложение: если бы счётчик
--    инкрементировал код, любая ошибка или пропущенная ветка оставляла бы
--    reserved_count разошедшимся с реальным числом заказов — и либо cap
--    молча разъезжался (oversell), либо места «залипали».
--
--    Место занимают состояния, где пак фактически продан или продётся:
--    reserved, payment_seen, paid, delivered.
--    Освобождают место только терминальные «не состоялось»: expired, cancelled,
--    refunded. Переходы в них необратимы, поэтому счётчик только убывает.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION game_ops.presale_slot_occupying(p_state text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_state IN ('reserved', 'payment_seen', 'paid', 'delivered')
$$;

CREATE OR REPLACE FUNCTION game_ops.presale_orders_count_slot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_delta integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT game_ops.presale_slot_occupying(NEW.state) THEN
      RAISE EXCEPTION 'PRESALE_INITIAL_STATE_MUST_OCCUPY_SLOT'
        USING DETAIL = format('Заказ создаётся в состоянии %s, которое не занимает место', NEW.state);
    END IF;
    v_delta := 1;
  ELSE
    v_delta := (CASE WHEN game_ops.presale_slot_occupying(NEW.state) THEN 1 ELSE 0 END)
             - (CASE WHEN game_ops.presale_slot_occupying(OLD.state) THEN 1 ELSE 0 END);
    IF v_delta = 0 THEN RETURN NULL; END IF;
    -- Счётчик не должен расти после создания: переход «освободил → занял»
    -- означал бы воскрешение отменённого заказа.
    IF v_delta > 0 THEN
      RAISE EXCEPTION 'PRESALE_SLOT_CANNOT_BE_RETAKEN'
        USING DETAIL = format('Заказ %s: переход %s -> %s возвращает занятое место', OLD.id, OLD.state, NEW.state);
    END IF;
  END IF;

  UPDATE game_ops.presale_runs
     SET reserved_count = reserved_count + v_delta
   WHERE run_id = NEW.run_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS presale_orders_count_slot_ins ON game_ops.presale_orders;
CREATE TRIGGER presale_orders_count_slot_ins
  AFTER INSERT ON game_ops.presale_orders
  FOR EACH ROW EXECUTE FUNCTION game_ops.presale_orders_count_slot();

DROP TRIGGER IF EXISTS presale_orders_count_slot_upd ON game_ops.presale_orders;
CREATE TRIGGER presale_orders_count_slot_upd
  AFTER UPDATE OF state ON game_ops.presale_orders
  FOR EACH ROW EXECUTE FUNCTION game_ops.presale_orders_count_slot();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Неизменяемость денег и допустимость переходов.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION game_ops.presale_orders_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Деньги и идентификация заказа фиксируются навсегда.
  -- payer_email здесь же: по этому адресу уходит уведомление о выдаче, а окно
  -- клейма всего 15 минут. Молча подменить его — значит отправить уведомление
  -- другому человеку, и в аудите этого не осталось бы (аудит пишет только
  -- переходы состояний). Нужна реальная коррекция — возврат и новый заказ.
  IF NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.order_no IS DISTINCT FROM OLD.order_no
     OR NEW.pack_id IS DISTINCT FROM OLD.pack_id
     OR NEW.price_units IS DISTINCT FROM OLD.price_units
     OR NEW.payer_wallet IS DISTINCT FROM OLD.payer_wallet
     OR NEW.payer_email IS DISTINCT FROM OLD.payer_email
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.reserved_until IS DISTINCT FROM OLD.reserved_until THEN
    RAISE EXCEPTION 'PRESALE_IMMUTABLE_FIELD'
      USING DETAIL = format('Заказ %s: run_id/order_no/pack_id/price_units/payer_wallet/payer_email/created_at/reserved_until неизменяемы', OLD.id);
  END IF;

  -- Подпись проставляется один раз и только при входе в payment_seen.
  IF OLD.tx_signature IS NOT NULL AND NEW.tx_signature IS DISTINCT FROM OLD.tx_signature THEN
    RAISE EXCEPTION 'PRESALE_SIGNATURE_IMMUTABLE'
      USING DETAIL = format('Заказ %s: подпись платежа уже зафиксирована', OLD.id);
  END IF;
  IF NEW.tx_signature IS NOT NULL AND OLD.tx_signature IS NULL AND NEW.state <> 'payment_seen' THEN
    RAISE EXCEPTION 'PRESALE_SIGNATURE_REQUIRES_PAYMENT_SEEN'
      USING DETAIL = format('Заказ %s: подпись принимается только при переходе в payment_seen', OLD.id);
  END IF;

  -- Выдача фиксируется один раз и только при входе в delivered.
  IF OLD.intent_id IS NOT NULL AND NEW.intent_id IS DISTINCT FROM OLD.intent_id THEN
    RAISE EXCEPTION 'PRESALE_INTENT_IMMUTABLE'
      USING DETAIL = format('Заказ %s: связь с выдачей уже зафиксирована', OLD.id);
  END IF;
  IF NEW.intent_id IS NOT NULL AND OLD.intent_id IS NULL AND NEW.state <> 'delivered' THEN
    RAISE EXCEPTION 'PRESALE_INTENT_REQUIRES_DELIVERED'
      USING DETAIL = format('Заказ %s: intent_id принимается только при переходе в delivered', OLD.id);
  END IF;

  -- Машина переходов. Терминальные состояния — навсегда.
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state IN ('delivered','refunded','expired','cancelled') THEN
      RAISE EXCEPTION 'PRESALE_INVALID_TRANSITION'
        USING DETAIL = format('Заказ %s: состояние %s терминальное', OLD.id, OLD.state);
    END IF;
    IF NOT (
         (OLD.state = 'reserved'     AND NEW.state IN ('payment_seen','expired','cancelled'))
      OR (OLD.state = 'payment_seen' AND NEW.state IN ('paid','refunded','expired'))
      OR (OLD.state = 'paid'         AND NEW.state IN ('delivered','refunded'))
    ) THEN
      RAISE EXCEPTION 'PRESALE_INVALID_TRANSITION'
        USING DETAIL = format('Заказ %s: переход %s -> %s недопустим', OLD.id, OLD.state, NEW.state);
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS presale_orders_guard ON game_ops.presale_orders;
CREATE TRIGGER presale_orders_guard
  BEFORE UPDATE ON game_ops.presale_orders
  FOR EACH ROW EXECUTE FUNCTION game_ops.presale_orders_guard();

-- Тираж: цена, cap и казначейство неизменяемы. Закрыть можно, открыть обратно — нет.
CREATE OR REPLACE FUNCTION game_ops.presale_runs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.pack_id IS DISTINCT FROM OLD.pack_id
     OR NEW.price_units IS DISTINCT FROM OLD.price_units
     OR NEW.treasury IS DISTINCT FROM OLD.treasury
     OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'PRESALE_RUN_IMMUTABLE_FIELD'
      USING DETAIL = format('Тираж %s: run_id/pack_id/price_units/treasury/started_at неизменяемы', OLD.run_id);
  END IF;
  -- Уменьшить cap ниже уже занятого — значит признать oversell задним числом.
  IF NEW.cap <> OLD.cap THEN
    RAISE EXCEPTION 'PRESALE_RUN_CAP_IMMUTABLE'
      USING DETAIL = format('Тираж %s: cap неизменяем; закройте тираж и откройте новый', OLD.run_id);
  END IF;
  IF OLD.is_open = false AND NEW.is_open = true THEN
    RAISE EXCEPTION 'PRESALE_RUN_CANNOT_REOPEN'
      USING DETAIL = format('Тираж %s: закрытый тираж нельзя открыть снова', OLD.run_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS presale_runs_guard ON game_ops.presale_runs;
CREATE TRIGGER presale_runs_guard
  BEFORE UPDATE ON game_ops.presale_runs
  FOR EACH ROW EXECUTE FUNCTION game_ops.presale_runs_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Аудит. Каждое создание и каждый переход — строкой в admin_audit.
--    Здесь же фиксируется email, но только хешем: в аудит персональные данные
--    не кладутся, а доказать «почта была такая-то» при споре нужно.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION game_ops.presale_orders_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM game_ops.write_audit('presale_order.created', 'presale_orders', NEW.id, 'ok',
      format('run=%s order_no=%s pack=%s price=%s wallet=%s email_md5=%s',
             NEW.run_id, NEW.order_no, NEW.pack_id, NEW.price_units,
             left(NEW.payer_wallet, 8), coalesce(md5(lower(NEW.payer_email)), '-')));
    RETURN NULL;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    PERFORM game_ops.write_audit('presale_order.transition', 'presale_orders', NEW.id,
      CASE WHEN NEW.state IN ('refunded','expired','cancelled') THEN 'error' ELSE 'ok' END,
      format('%s->%s signature=%s slot=%s intent=%s failure=%s',
             OLD.state, NEW.state, coalesce(left(NEW.tx_signature, 10), '-'),
             coalesce(NEW.paid_slot::text, '-'), coalesce(NEW.intent_id::text, '-'),
             coalesce(NEW.failure_code, '-')));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS presale_orders_audit_ins ON game_ops.presale_orders;
CREATE TRIGGER presale_orders_audit_ins
  AFTER INSERT ON game_ops.presale_orders
  FOR EACH ROW EXECUTE FUNCTION game_ops.presale_orders_audit();

DROP TRIGGER IF EXISTS presale_orders_audit_upd ON game_ops.presale_orders;
CREATE TRIGGER presale_orders_audit_upd
  AFTER UPDATE ON game_ops.presale_orders
  FOR EACH ROW EXECUTE FUNCTION game_ops.presale_orders_audit();
