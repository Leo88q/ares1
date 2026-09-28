-- game_ops: неизменяемость и аудит (уровень 2 поверх прав из 0003).
--
-- Защита в три слоя, чтобы падение одного не открывало историю:
--   1) права: REVOKE UPDATE/DELETE у роли-писателя (0003_roles.sql);
--   2) триггеры: этот файл — запрет UPDATE/DELETE на журнале/аудите/сверке,
--      машина состояний интента, неизменяемость денежных полей;
--   3) hash-chain + сверка: hash-chain в журнале (row_hash/prev_hash) и Merkle-
--      якорь ончейн (внешний уровень, см. docs/DB_RUNBOOK.md § Якорь).
--
-- Хэши цепочки считает приложение (sha256), БД проверяет связность пакета.
-- detail_hash в аудите считается в БД через md5() — это связующий дайджест для
-- расследования, а не криптографическое обязательство (расширения вроде
-- pgcrypto намеренно не требуются: деплой не должен зависеть от extension).

-- ─────────────────────────────────────────────────────────────────────────────
-- Общие помощники
-- ─────────────────────────────────────────────────────────────────────────────

-- Актор берётся из GUC game_ops.actor, который приложение выставляет внутри
-- транзакции (SET LOCAL). Нет актора — 'unknown', но не NULL: аудит обязан иметь
-- строку даже для системных операций.
CREATE OR REPLACE FUNCTION game_ops.current_actor() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('game_ops.actor', true), ''), 'unknown')
$$;

-- Запись в аудит из триггеров. SECURITY INVOKER: триггер работает с правами
-- вызывающего, поэтому роль-писатель обязана иметь INSERT на admin_audit
-- (и не имеет UPDATE/DELETE — это и есть гарантия append-only на уровне прав).
CREATE OR REPLACE FUNCTION game_ops.write_audit(
  p_action text, p_subject text, p_subject_id bigint, p_outcome text, p_detail text
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO game_ops.admin_audit (actor, action, subject, subject_id, outcome, detail_hash)
  VALUES (game_ops.current_actor(), p_action, p_subject, p_subject_id, p_outcome, md5(coalesce(p_detail, '')));
END $$;

-- Универсальный запрет изменения строки: используется для append-only таблиц.
CREATE OR REPLACE FUNCTION game_ops.deny_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_%', upper(TG_OP)
    USING DETAIL = format('Таблица %I.%I доступна только для вставки', TG_TABLE_SCHEMA, TG_TABLE_NAME);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Журнал наград: append-only + проверка связности пакета (statement-level,
--    чтобы батч из тысячи строк проверялся одним проходом, а не N триггерами).
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS reward_ledger_deny_update ON game_ops.reward_ledger;
CREATE TRIGGER reward_ledger_deny_update
  BEFORE UPDATE ON game_ops.reward_ledger
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

DROP TRIGGER IF EXISTS reward_ledger_deny_delete ON game_ops.reward_ledger;
CREATE TRIGGER reward_ledger_deny_delete
  BEFORE DELETE ON game_ops.reward_ledger
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

CREATE OR REPLACE FUNCTION game_ops.ledger_validate_batch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_chain       text;
  v_chains      bigint;
  v_head        text;
  v_head_id     bigint;
  v_bad         bigint;
  v_count       bigint;
  v_last_hash   text;
  v_last_id     bigint;
  v_last_slot   bigint;
BEGIN
  SELECT count(DISTINCT chain_id), min(chain_id), count(*)
    INTO v_chains, v_chain, v_count
  FROM new_rows;

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  -- Батарея должна принадлежать одной цепочке: иначе непонятно, какую голову
  -- двигать, и проверка связности теряет смысл.
  IF v_chains <> 1 THEN
    RAISE EXCEPTION 'LEDGER_SINGLE_CHAIN_PER_BATCH_REQUIRED';
  END IF;

  -- Голова цепочки создаётся лениво, с генезис-хэшем из нулей.
  INSERT INTO game_ops.ledger_chain_head (chain_id, last_hash, last_id, last_slot, row_count)
  VALUES (v_chain, repeat('0', 64), 0, 0, 0)
  ON CONFLICT (chain_id) DO NOTHING;

  -- Блокируем голову: конкурирующие писатели сериализуются на этой строке,
  -- поэтому «вилка» цепочки невозможна даже при нескольких процессах.
  SELECT last_hash, last_id INTO v_head, v_head_id
  FROM game_ops.ledger_chain_head
  WHERE chain_id = v_chain
  FOR UPDATE;

  -- Связность: первый элемент батча ссылается на прежнюю голову, каждый
  -- следующий — на хэш предыдущего.
  WITH ordered AS (
    SELECT id, prev_hash, row_hash, row_number() OVER (ORDER BY id) AS rn
    FROM new_rows
  )
  SELECT count(*) INTO v_bad
  FROM ordered o
  LEFT JOIN ordered p ON p.rn = o.rn - 1
  WHERE (o.rn = 1 AND o.prev_hash <> v_head)
     OR (o.rn > 1 AND o.prev_hash <> p.row_hash);

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'LEDGER_CHAIN_MISMATCH'
      USING DETAIL = format('Цепочка %s не сходится с головой %s (нарушений: %s)', v_chain, left(v_head, 12), v_bad);
  END IF;

  SELECT row_hash, id, slot INTO v_last_hash, v_last_id, v_last_slot
  FROM new_rows ORDER BY id DESC LIMIT 1;

  UPDATE game_ops.ledger_chain_head
  SET last_hash = v_last_hash,
      last_id   = v_last_id,
      last_slot = greatest(last_slot, v_last_slot),
      row_count = row_count + v_count,
      updated_at = now()
  WHERE chain_id = v_chain;

  PERFORM game_ops.write_audit('reward_ledger.appended', 'reward_ledger', v_last_id, 'ok',
    format('chain=%s count=%s first_head=%s last_hash=%s', v_chain, v_count, left(v_head, 12), left(v_last_hash, 12)));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS reward_ledger_validate_batch ON game_ops.reward_ledger;
CREATE TRIGGER reward_ledger_validate_batch
  AFTER INSERT ON game_ops.reward_ledger
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION game_ops.ledger_validate_batch();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Интенты: машина состояний и неизменяемость «денежных» полей.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION game_ops.reward_intents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_allowed boolean;
BEGIN
  -- Денежные и идентифицирующие поля фиксируются навсегда: правка означала бы
  -- подмену уже согласованной выплаты (сумма/получатель/nonce/обоснование).
  IF NEW.recipient_ata IS DISTINCT FROM OLD.recipient_ata
     OR NEW.amount_micro IS DISTINCT FROM OLD.amount_micro
     OR NEW.nonce IS DISTINCT FROM OLD.nonce
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.actor IS DISTINCT FROM OLD.actor
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'INTENT_IMMUTABLE_FIELD'
      USING DETAIL = format('Интент %s: поля суммы/получателя/nonce/reason/actor/сроков менять нельзя', OLD.id);
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    v_allowed := CASE OLD.state
      WHEN 'pending'   THEN NEW.state IN ('submitted','failed','expired')
      WHEN 'submitted' THEN NEW.state IN ('confirmed','failed','expired')
      ELSE false   -- confirmed/failed/expired — терминальные состояния
    END;
    IF NOT v_allowed THEN
      RAISE EXCEPTION 'INTENT_INVALID_TRANSITION'
        USING DETAIL = format('Интент %s: переход %s → %s запрещён', OLD.id, OLD.state, NEW.state);
    END IF;
  END IF;

  -- Подпись можно проставить один раз и только вместе с переходом в submitted.
  IF NEW.signature IS DISTINCT FROM OLD.signature THEN
    IF OLD.signature IS NOT NULL THEN
      RAISE EXCEPTION 'INTENT_SIGNATURE_IMMUTABLE' USING DETAIL = format('Интент %s: подпись уже зафиксирована', OLD.id);
    END IF;
    IF NEW.state <> 'submitted' THEN
      RAISE EXCEPTION 'INTENT_SIGNATURE_REQUIRES_SUBMITTED' USING DETAIL = format('Интент %s: подпись только при переходе в submitted', OLD.id);
    END IF;
  END IF;

  IF NEW.state = 'failed' AND NEW.failure_code IS NULL THEN
    RAISE EXCEPTION 'INTENT_FAILURE_CODE_REQUIRED' USING DETAIL = format('Интент %s: для failed нужен failure_code', OLD.id);
  END IF;

  IF NEW.state = 'submitted' AND NEW.signature IS NULL THEN
    RAISE EXCEPTION 'INTENT_SIGNATURE_REQUIRED' USING DETAIL = format('Интент %s: для submitted нужна подпись', OLD.id);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reward_intents_guard ON game_ops.reward_intents;
CREATE TRIGGER reward_intents_guard
  BEFORE UPDATE ON game_ops.reward_intents
  FOR EACH ROW EXECUTE FUNCTION game_ops.reward_intents_guard();

-- Изменение интента разрешено только в колонках state/signature/slot/failure_code
-- (права роли-писателя), а здесь фиксируется «что именно» для расследования.
CREATE OR REPLACE FUNCTION game_ops.reward_intents_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM game_ops.write_audit('reward_intent.created', 'reward_intents', NEW.id, 'ok',
      format('recipient=%s amount=%s nonce=%s actor=%s', left(NEW.recipient_ata, 8), NEW.amount_micro, NEW.nonce, NEW.actor));
    RETURN NULL;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    PERFORM game_ops.write_audit('reward_intent.transition', 'reward_intents', NEW.id,
      CASE NEW.state WHEN 'failed' THEN 'error' ELSE 'ok' END,
      format('%s->%s signature=%s failure=%s', OLD.state, NEW.state, coalesce(left(NEW.signature, 10), '-'), coalesce(NEW.failure_code, '-')));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS reward_intents_audit_ins ON game_ops.reward_intents;
CREATE TRIGGER reward_intents_audit_ins
  AFTER INSERT ON game_ops.reward_intents
  FOR EACH ROW EXECUTE FUNCTION game_ops.reward_intents_audit();

DROP TRIGGER IF EXISTS reward_intents_audit_upd ON game_ops.reward_intents;
CREATE TRIGGER reward_intents_audit_upd
  AFTER UPDATE ON game_ops.reward_intents
  FOR EACH ROW EXECUTE FUNCTION game_ops.reward_intents_audit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Аудит и сверка: append-only (дублирует права — на случай ошибки в грантах).
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS admin_audit_deny_update ON game_ops.admin_audit;
CREATE TRIGGER admin_audit_deny_update
  BEFORE UPDATE ON game_ops.admin_audit
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

DROP TRIGGER IF EXISTS admin_audit_deny_delete ON game_ops.admin_audit;
CREATE TRIGGER admin_audit_deny_delete
  BEFORE DELETE ON game_ops.admin_audit
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

DROP TRIGGER IF EXISTS chain_reconciliation_deny_update ON game_ops.chain_reconciliation;
CREATE TRIGGER chain_reconciliation_deny_update
  BEFORE UPDATE ON game_ops.chain_reconciliation
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

DROP TRIGGER IF EXISTS chain_reconciliation_deny_delete ON game_ops.chain_reconciliation;
CREATE TRIGGER chain_reconciliation_deny_delete
  BEFORE DELETE ON game_ops.chain_reconciliation
  FOR EACH ROW EXECUTE FUNCTION game_ops.deny_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Курсоры сервисов: изменяемые, но только по CAS (version), и каждое
--    изменение попадает в аудит — «кто сдвинул курсор и на сколько».
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION game_ops.service_cursors_cas() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'CURSOR_VERSION_CONFLICT'
      USING DETAIL = format('Курсор %s: ожидалась версия %s, получена %s', OLD.stream_id, OLD.version + 1, NEW.version);
  END IF;
  IF NEW.stream_id <> OLD.stream_id THEN
    RAISE EXCEPTION 'CURSOR_STREAM_ID_IMMUTABLE';
  END IF;
  NEW.updated_at := now();
  PERFORM game_ops.write_audit('service_cursor.advanced', 'service_cursors', NULL, 'ok',
    format('stream=%s version=%s->%s', NEW.stream_id, OLD.version, NEW.version));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS service_cursors_cas ON game_ops.service_cursors;
CREATE TRIGGER service_cursors_cas
  BEFORE UPDATE ON game_ops.service_cursors
  FOR EACH ROW EXECUTE FUNCTION game_ops.service_cursors_cas();

CREATE OR REPLACE FUNCTION game_ops.service_cursors_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM game_ops.write_audit('service_cursor.registered', 'service_cursors', NULL, 'ok',
    format('stream=%s version=%s', NEW.stream_id, NEW.version));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS service_cursors_audit_ins ON game_ops.service_cursors;
CREATE TRIGGER service_cursors_audit_ins
  AFTER INSERT ON game_ops.service_cursors
  FOR EACH ROW EXECUTE FUNCTION game_ops.service_cursors_audit();
