-- ─────────────────────────────────────────────────────────────────────────────
-- Метрики удержания: события игроков для когорт D1/D7.
--
-- Зачем: решение «строим крючки дальше / стоп» (чек-лист §10) принимается по
-- живым когортам, а не по впечатлениям. Парты событий шлёт браузер игрока
-- (utils/telemetry.ts) → POST /api/gameops/events.
--
-- Границы честности данных (задокументировано, а не спрятано):
--   - запись СЕРВЕРНАЯ: клиент не передаёт время → бэктейтить вчерашний вход
--     задним числом невозможно;
--   - подпись событий отсутствует — это метрики, не деньги: накрутить DAU
--     можно; для пилота100–300 человек приемлемо, на mainnet события завяжут
--     на подписываемое сообщение;
--   - идентичность: кошелёк (когда подключён) либо anon-UUID из localStorage
--     (первый заход без кошелька) — когорта считается по обоим.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_ops.player_events (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id   text        NOT NULL CHECK (
    player_id ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'                       -- кошелёк Solana
    OR player_id ~ '^anon-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  event       text        NOT NULL CHECK (event IN (
    'session_start', 'buy_field', 'presale_buy', 'harvest', 'upgrade',
    'repair', 'pay_tax', 'fertilize', 'claim_reward', 'close_field', 'transfer'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Когортные срезы: по дням (UTC) и по игроку. День считаем в UTC явно —
-- дата в локальной таймзоне сервера не должна сдвигать границы D1/D7.
CREATE INDEX IF NOT EXISTS player_events_occurred_idx ON game_ops.player_events (occurred_at);
CREATE INDEX IF NOT EXISTS player_events_player_idx   ON game_ops.player_events (player_id, occurred_at);
