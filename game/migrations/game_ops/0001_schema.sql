-- game_ops: офчейн-схема «намерений» ARES-1.
--
-- Принцип (docs/DATABASE_DESIGN.md): книга учёта по деньгам — цепь; эта схема
-- хранит только то, чего в цепи нет и не может быть: интенты выплат с nonce,
-- аудит админ-действий, квоты/сверку, курсоры сервисов. Никаких балансов игроков.
--
-- Файлы миграций применяются по одному в транзакции (scripts/db-migrate.ts),
-- повторный запуск безопасен. DDL в рантайме запрещён: роль приложения не имеет
-- прав на схему, только DML по узкому набору таблиц (см. 0003_roles.sql).

CREATE SCHEMA IF NOT EXISTS game_ops;

-- Версия схемы: одна строка на применённый файл + его контрольная сумма.
-- Контрольная сумма защищает от «правки уже применённой миграции».
CREATE TABLE IF NOT EXISTS game_ops.schema_version (
  version    integer     PRIMARY KEY,
  file_name  text        NOT NULL UNIQUE,
  checksum   text        NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now(),
  note       text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Интенты выплат: единственное место, где БД опережает цепь.
--    Ключ идемпотентности совпадает с ончейн-PDA ["reward", recipient_ata, nonce]
--    (гейт G-1: grant_reward_once) — повтор невозможен ни офчейн, ни ончейн.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_ops.reward_intents (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_ata text        NOT NULL CHECK (length(recipient_ata) BETWEEN 32 AND 44),
  amount_micro  bigint      NOT NULL CHECK (amount_micro > 0 AND amount_micro <= 1_000_000_000),
  nonce         bigint      NOT NULL CHECK (nonce >= 0),
  reason        text        NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  actor         text        NOT NULL CHECK (length(actor) BETWEEN 3 AND 120),
  state         text        NOT NULL DEFAULT 'pending'
                            CHECK (state IN ('pending','submitted','confirmed','failed','expired')),
  signature     text        CHECK (signature IS NULL OR length(signature) BETWEEN 64 AND 88),
  slot          bigint      CHECK (slot IS NULL OR slot >= 0),
  failure_code  text        CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{3,40}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  -- Идемпотентность: одна выплата на (получатель, nonce) — как ончейн-PDA.
  CONSTRAINT reward_intents_recipient_nonce_key UNIQUE (recipient_ata, nonce),
  -- Одна подпись транзакции = один интент (NULL допускается многократно).
  CONSTRAINT reward_intents_signature_key UNIQUE (signature),
  CONSTRAINT reward_intents_expiry_after_creation CHECK (expires_at > created_at)
);

-- Выборка «что отдать подписанту» и «что протухло».
CREATE INDEX IF NOT EXISTS reward_intents_actionable_idx
  ON game_ops.reward_intents (state, expires_at);
CREATE INDEX IF NOT EXISTS reward_intents_recipient_idx
  ON game_ops.reward_intents (recipient_ata, created_at DESC);
-- Подтверждённые интенты сверяются с зеркалом по подписи.
CREATE INDEX IF NOT EXISTS reward_intents_signature_state_idx
  ON game_ops.reward_intents (state) WHERE state IN ('submitted','confirmed');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Зеркало ончейн-факта: только финализированные RewardGrantedOnce и исторические RewardGranted.
--    Append-only: hash-chain (prev_hash → row_hash) + запрет UPDATE/DELETE
--    правами (0003) и триггером (0002).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_ops.reward_ledger (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id      text        NOT NULL DEFAULT 'reward' CHECK (chain_id ~ '^[a-z0-9_]{3,32}$'),
  intent_id     bigint      REFERENCES game_ops.reward_intents(id),
  recipient_ata text        NOT NULL,
  amount_micro  bigint      NOT NULL CHECK (amount_micro > 0),
  signature     text        NOT NULL CHECK (length(signature) BETWEEN 64 AND 88),
  slot          bigint      NOT NULL CHECK (slot >= 0),
  block_time    timestamptz NOT NULL,
  prev_hash     text        NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash      text        NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Дедупликация зеркала: одно и то же событие нельзя записать дважды.
  CONSTRAINT reward_ledger_signature_recipient_key UNIQUE (signature, recipient_ata)
);

CREATE INDEX IF NOT EXISTS reward_ledger_chain_idx ON game_ops.reward_ledger (chain_id, id);
-- Сверка сравнивает суммы за окно слотов, поэтому нужен индекс по (chain_id, slot).
CREATE INDEX IF NOT EXISTS reward_ledger_slot_idx ON game_ops.reward_ledger (chain_id, slot);
CREATE INDEX IF NOT EXISTS reward_ledger_recipient_idx ON game_ops.reward_ledger (recipient_ata, slot DESC);
CREATE INDEX IF NOT EXISTS reward_ledger_intent_idx ON game_ops.reward_ledger (intent_id) WHERE intent_id IS NOT NULL;

-- Голова цепочки: строка, за которую «держатся» писатели (SELECT … FOR UPDATE),
-- поэтому вставка в журнал сериализуется, а хвост остаётся согласованным.
CREATE TABLE IF NOT EXISTS game_ops.ledger_chain_head (
  chain_id    text        PRIMARY KEY CHECK (chain_id ~ '^[a-z0-9_]{3,32}$'),
  last_hash   text        NOT NULL CHECK (last_hash ~ '^[0-9a-f]{64}$'),
  last_id     bigint      NOT NULL DEFAULT 0 CHECK (last_id >= 0),
  last_slot   bigint      NOT NULL DEFAULT 0 CHECK (last_slot >= 0),
  row_count   bigint      NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Аудит административных действий: «кто, что, почему, с каким исходом».
--    В цепи есть «что» (AuthorityProposed, PausedToggled…), но нет «кто в команде»
--    и «почему». Append-only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_ops.admin_audit (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor       text        NOT NULL CHECK (length(actor) BETWEEN 3 AND 120),
  action      text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{2,60}$'),
  subject     text        NOT NULL CHECK (subject ~ '^[a-z][a-z0-9_]{2,40}$'),
  subject_id  bigint,
  outcome     text        NOT NULL CHECK (outcome IN ('ok','denied','error')),
  -- Дайджест деталей: 32 hex (md5, считается триггерами без расширений)
  -- или 64 hex (sha256, если пишет приложение).
  detail_hash text        NOT NULL CHECK (detail_hash ~ '^[0-9a-f]{32}([0-9a-f]{32})?$'),
  request_id  text        CHECK (request_id IS NULL OR length(request_id) BETWEEN 8 AND 64),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_subject_idx ON game_ops.admin_audit (subject, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_idx ON game_ops.admin_audit (actor, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON game_ops.admin_audit (created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Сверка с цепью: доказательство, что офчейн-зеркало не разошлось с ончейн-учётом.
--    drift_micro должен быть 0; readiness сервиса fail-closed (см. readiness.ts).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_ops.chain_reconciliation (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stream_id      text        NOT NULL CHECK (stream_id ~ '^[a-z0-9:_-]{3,80}$'),
  finalized_slot bigint      NOT NULL CHECK (finalized_slot >= 0),
  epoch_id       bigint      NOT NULL CHECK (epoch_id >= 0),
  granted_micro  bigint      NOT NULL CHECK (granted_micro >= 0),
  ledger_micro   bigint      NOT NULL CHECK (ledger_micro >= 0),
  drift_micro    bigint      NOT NULL,
  checked_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chain_reconciliation_drift_is_difference
    CHECK (drift_micro = granted_micro - ledger_micro)
);

CREATE INDEX IF NOT EXISTS chain_reconciliation_stream_idx
  ON game_ops.chain_reconciliation (stream_id, checked_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Курсоры сервисов: единственная изменяемая таблица (CAS по version).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_ops.service_cursors (
  stream_id  text        PRIMARY KEY CHECK (stream_id ~ '^[a-z0-9:_-]{3,80}$'),
  version    bigint      NOT NULL DEFAULT 0 CHECK (version >= 0),
  state      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Представления для сервисов (не дают обойти права на таблицы).
-- ─────────────────────────────────────────────────────────────────────────────

-- Что подписант может забрать прямо сейчас.
CREATE OR REPLACE VIEW game_ops.reward_intents_actionable AS
SELECT id, recipient_ata, amount_micro, nonce, reason, actor, created_at, expires_at
FROM game_ops.reward_intents
WHERE state = 'pending' AND expires_at > now();

-- Хвост журнала для внешнего аудита.
CREATE OR REPLACE VIEW game_ops.reward_ledger_tail AS
SELECT l.id, l.chain_id, l.intent_id, l.recipient_ata, l.amount_micro, l.signature,
       l.slot, l.block_time, l.prev_hash, l.row_hash
FROM game_ops.reward_ledger l
ORDER BY l.id DESC;

-- Последняя сверка по каждому потоку.
CREATE OR REPLACE VIEW game_ops.chain_reconciliation_latest AS
SELECT DISTINCT ON (stream_id) stream_id, finalized_slot, epoch_id, granted_micro,
       ledger_micro, drift_micro, checked_at
FROM game_ops.chain_reconciliation
ORDER BY stream_id, checked_at DESC;
