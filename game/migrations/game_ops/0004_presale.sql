-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1: офчейн-предоплата за наборы во время devnet-беты.
--
-- Почему эта таблица законна по правилу DATABASE_DESIGN.md §1
-- («что произойдёт, если таблицу потерять полностью?»):
--   Книга правды про деньги здесь — НЕ эта таблица, а история кошелька-казначейства
--   в блокчейне. `scripts/presale-reconcile` обязан уметь восстановить полный
--   список плательщиков из одной только истории кошелька, без БД. Потеря
--   presale_orders стоит нам «кто заказал и на какой email прислать уведомление»
--   и «не выдали ли мы уже» — то есть операционных данных, а не денег.
--
-- Что здесь хранится и чего в цепи нет и не может быть:
--   1. Намерение (заказ до получения платежа) — в цепи его не существует.
--   2. Привязка платежа к заказу — цепь знает «на кошелёк пришло N лампортов»,
--      но не знает, что это заказ №17 на пак «Луг».
--   3. Email для уведомления о выдаче — в цепь персональные данные не кладутся.
--   4. Факт выдачи — связка заказа с reward_intents (единственная рельса выдачи).
--
-- Инварианты продублированы схемой (этот файл), триггерами (0005_presale_guards.sql)
-- и правами (0006_presale_roles.sql): код приложения — не единственная защита.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Тираж: конфигурация продажи и живой счётчик занятых мест.
--
-- Счётчик живёт здесь, а не считается COUNT(*) по заказам, потому что решение
-- «место ещё есть» должно приниматься атомарно в одной транзакции с резервом.
-- UPDATE ... WHERE reserved_count < cap — это и есть гейт против oversell:
-- при гонке второй запрос получит 0 строк и заказ не создастся.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_ops.presale_runs (
  run_id          text        PRIMARY KEY CHECK (length(run_id) BETWEEN 1 AND 40),
  pack_id         text        NOT NULL CHECK (length(pack_id) BETWEEN 1 AND 40),
  -- Валюта тиража. От неё зависит, ЧТО именно означает число в price_units:
  --   sol — лампорты (10^-9 SOL), treasury = кошелёк-получатель;
  --   skr — атомы SKR (10^-6, SKR_DECIMALS), treasury = ТОКЕН-аккаунт (ATA).
  -- Смешивать нельзя: цена 1053 в лампортах и 1053 в атомах SKR — это разные
  -- деньги, отличающиеся в 1000 раз. Отдельная колонка currency делает такую
  -- ошибку видимой в схеме, а не в отчёте о расхождениях.
  currency        text        NOT NULL CHECK (currency IN ('sol','skr')),
  -- Цена в базовых единицах выбранной валюты. Lamport/atom-пыль для автопривязки
  -- платежа добавляется к этой базе на стороне приложения (price_units + order_no).
  price_units     bigint      NOT NULL CHECK (price_units > 0),
  cap             integer     NOT NULL CHECK (cap > 0 AND cap <= 100000),
  reserved_count  integer     NOT NULL DEFAULT 0 CHECK (reserved_count >= 0 AND reserved_count <= cap),
  is_open         boolean     NOT NULL DEFAULT true,
  -- Для sol — кошелёк-получатель, для skr — его associated token account.
  treasury        text        NOT NULL CHECK (length(treasury) BETWEEN 32 AND 44),
  -- Сколько минут заказ держит место без платежа. Без этого cap выкупают
  -- брошенными заказами и реальные покупатели не проходят.
  reserve_minutes integer     NOT NULL DEFAULT 30 CHECK (reserve_minutes BETWEEN 1 AND 1440),
  started_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Заказ. Состояние — явная машина переходов, деньги неизменяемы.
--
--   reserved ──▶ payment_seen ──▶ paid ──▶ delivered
--      │              │             │
--      ├─▶ expired    ├─▶ expired   └─▶ refunded
--      └─▶ cancelled  └─▶ refunded
--
-- Терминальные: delivered, refunded, expired, cancelled.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_ops.presale_orders (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        text        NOT NULL REFERENCES game_ops.presale_runs (run_id),
  -- Номер заказа внутри тиража: 1..cap. Именно он попадает в lamport-пыль,
  -- поэтому уникален и неизменяем — иначе привязка платежа разъедется.
  order_no      integer     NOT NULL CHECK (order_no > 0),
  pack_id       text        NOT NULL CHECK (length(pack_id) BETWEEN 1 AND 40),
  -- Сколько лампортов мы ОЖИДАЕМ (база + пыль). Неизменяемо: если цену можно
  -- поменять постфактум, сверка с цепью теряет смысл.
  price_units bigint     NOT NULL CHECK (price_units > 0),
  payer_wallet  text        NOT NULL CHECK (length(payer_wallet) BETWEEN 32 AND 44),
  -- Email — только для уведомления о выдаче. NULL допустим: покупатель вправе
  -- не давать почту, тогда он следит за статусом по номеру заказа.
  payer_email   text        CHECK (payer_email IS NULL OR payer_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  state         text        NOT NULL DEFAULT 'reserved'
                            CHECK (state IN ('reserved','payment_seen','paid','delivered','refunded','expired','cancelled')),
  -- Подпись платёжной транзакции. Уникальна: одна транзакция не может закрыть
  -- два заказа — это главная защита от «я оплатил один раз, дайте два пака».
  tx_signature  text        CHECK (tx_signature IS NULL OR length(tx_signature) BETWEEN 64 AND 88),
  received_units bigint  CHECK (received_units IS NULL OR received_units >= 0),
  paid_slot     bigint      CHECK (paid_slot IS NULL OR paid_slot >= 0),
  -- Ссылка на рельсу выдачи. Один заказ — не больше одной выдачи.
  intent_id     bigint      CHECK (intent_id IS NULL OR intent_id > 0),
  failure_code  text        CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{3,40}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  reserved_until timestamptz NOT NULL,
  paid_at       timestamptz,
  delivered_at  timestamptz,
  refunded_at   timestamptz,

  CONSTRAINT presale_orders_run_order_key UNIQUE (run_id, order_no),
  CONSTRAINT presale_orders_signature_key UNIQUE (tx_signature),
  CONSTRAINT presale_orders_reserve_window CHECK (reserved_until > created_at),
  CONSTRAINT presale_orders_paid_needs_signature
    CHECK (state NOT IN ('payment_seen','paid','delivered') OR tx_signature IS NOT NULL),
  CONSTRAINT presale_orders_delivered_needs_intent
    CHECK (state <> 'delivered' OR intent_id IS NOT NULL),
  CONSTRAINT presale_orders_terminal_timestamps
    CHECK (
      -- paid_at сохраняется и после возврата: факт оплаты был, и при споре
      -- именно он это доказывает. Теряется право на выдачу, а не история.
      (paid_at IS NULL OR state IN ('paid','delivered','refunded'))
      AND (delivered_at IS NULL OR state = 'delivered')
      AND (refunded_at IS NULL OR state = 'refunded')
    )
);

-- «Что протухло» и «что пора выдавать».
CREATE INDEX IF NOT EXISTS presale_orders_state_idx
  ON game_ops.presale_orders (state, reserved_until);
-- Сверка с цепью идёт по подписи, выдача — по кошельку.
CREATE INDEX IF NOT EXISTS presale_orders_signature_idx
  ON game_ops.presale_orders (tx_signature) WHERE tx_signature IS NOT NULL;
CREATE INDEX IF NOT EXISTS presale_orders_wallet_idx
  ON game_ops.presale_orders (payer_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS presale_orders_intent_idx
  ON game_ops.presale_orders (intent_id) WHERE intent_id IS NOT NULL;

-- Публичное представление: ни email, ни обоснований — только то, что покупатель
-- и так знает про свой заказ. Отдаётся наружу без админ-аутентификации.
CREATE OR REPLACE VIEW game_ops.presale_orders_public AS
  SELECT o.run_id,
         o.order_no,
         o.pack_id,
         r.currency,
         o.price_units,
         o.state,
         -- Кошелёк маскируется: представление читает любой, кто знает номер заказа.
         left(o.payer_wallet, 4) || '…' || right(o.payer_wallet, 4) AS payer_wallet_masked,
         o.created_at,
         o.paid_at,
         o.delivered_at
  FROM game_ops.presale_orders o
  JOIN game_ops.presale_runs r ON r.run_id = o.run_id;
