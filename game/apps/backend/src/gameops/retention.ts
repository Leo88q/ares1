/**
 * Метрики удержания: события игроков и когортный отчёт D1/D7.
 *
 * Следует конвенциям слоя: валидация до БД (GameOpsError → 400), запись —
 * через withTransaction (актор в GUC), чтение — query() без транзакции.
 *
 * Определения метрик (UTC-дни, границы — календарные даты):
 *   - когорта дня T — игроки, чье ПЕРВОЕ событие попало на T;
 *   - D1  — доля когорты с ≥1 событием ровно на T+1 (зрелость: T ≤ вчера);
 *   - D7  — доля когорты с ≥1 событием ровно на T+7 (зрелость: T ≤ сегодня−7);
 *   - D7-окно — доля когорты с ≥1 событием в дни T+1…T+7 (зрелость: T ≤ сегодня−7).
 *
 * Порог решения (чек-лист §10): D7-окно последней зрелой когорты с n ≥ 10
 *   ≥15% → «строим»; <8% → «стоп»; между → «добираем данных».
 * kогорта с n < 10 не участвует в вердикте — на малых числах D7 скачет
 * на 1–2 игроках, и вердикт был бы шумом, а не решением.
 */
import { GameOpsError } from './errors.js';
import { query, withTransaction, type Pool } from './pool.js';

export const EVENT_KINDS = [
  'session_start', 'buy_field', 'presale_buy', 'harvest', 'upgrade',
  'repair', 'pay_tax', 'fertilize', 'claim_reward', 'close_field', 'transfer',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ANON_RE = /^anon-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_EVENTS_PER_CALL = 20;
export const MIN_COHORT_SIZE = 10;
export const THRESHOLD_BUILD = 0.15;
export const THRESHOLD_STOP = 0.08;

export interface PlayerEventInput {
  player: string;
  event: EventKind;
}

/** Разбор входа без БД: любая ошибка — VALIDATION (400), не сюрприз из SQL. */
export function normalizeEvents(body: unknown): PlayerEventInput[] {
  const list = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(list) || list.length === 0) {
    throw new GameOpsError('VALIDATION', 'Ожидается { events: [...] } с хотя бы одним событием');
  }
  if (list.length > MAX_EVENTS_PER_CALL) {
    throw new GameOpsError('VALIDATION', `Не больше ${MAX_EVENTS_PER_CALL} событий за вызов (пачкой)`);
  }
  const kindSet = new Set<string>(EVENT_KINDS);
  return list.map((raw, index) => {
    const item = raw as { player?: unknown; event?: unknown };
    const player = typeof item.player === 'string' ? item.player.trim() : '';
    const event = typeof item.event === 'string' ? item.event.trim() : '';
    if (!WALLET_RE.test(player) && !ANON_RE.test(player)) {
      throw new GameOpsError('VALIDATION', `events[${index}].player — кошелёк base58 (32–44) или anon-UUID`);
    }
    if (!kindSet.has(event)) {
      throw new GameOpsError('VALIDATION', `events[${index}].event не из белого списка: ${event.slice(0, 32)}`);
    }
    return { player, event: event as EventKind };
  });
}

/** Пакетная вставка. Время ставит сервер (now()) — клиент backdate не может. */
export async function recordEvents(
  pool: Pool,
  events: PlayerEventInput[],
  actor: string,
): Promise<{ accepted: number }> {
  if (!events.length) return { accepted: 0 };
  const placeholders: string[] = [];
  const params: unknown[] = [];
  events.forEach((item, index) => {
    placeholders.push(`($${index * 2 + 1}, $${index * 2 + 2})`);
    params.push(item.player, item.event);
  });
  await withTransaction(pool, actor, client =>
    client.query(
      `INSERT INTO game_ops.player_events (player_id, event) VALUES ${placeholders.join(', ')}`,
      params,
    ),
  );
  return { accepted: events.length };
}

export interface CohortRow {
  day: string;
  newPlayers: number;
  dauPlayers: number;
  events: number;
  d1Returned: number | null;
  d7Returned: number | null;
  d7WindowReturned: number | null;
  d1Mature: boolean;
  d7Mature: boolean;
}

export interface RetentionDecision {
  verdict: 'build' | 'hold' | 'stop' | 'insufficient';
  metric: 'd7_window';
  value: number | null;
  cohortDay: string | null;
  cohortSize: number | null;
  thresholdBuild: number;
  thresholdStop: number;
  /** Пояснение для дашборда: почему вердикт такой. */
  basis: string;
}

export interface RetentionReport {
  generatedAt: string;
  lookbackDays: number;
  /** Дни с данными, включая сегодня; когорта за сегодня ещё не зрелая. */
  cohorts: CohortRow[];
  dau: Array<{ day: string; players: number; events: number }>;
  byEvent: Record<string, number>;
  totalPlayers: number;
  totalEvents: number;
  decision: RetentionDecision;
}

export async function retentionReport(pool: Pool, lookbackDays = 30): Promise<RetentionReport> {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 7 || lookbackDays > 120) {
    throw new GameOpsError('VALIDATION', 'days должен быть в диапазоне7..120');
  }
  // Окно с запасом +7 дней назад от нижней границы когорт: нужны события и на
  // T−0 (сама когорта), и факты активности вплоть до T+7.
  const windowStartDays = lookbackDays + 8;
  const rows = await query<{
    day: string;
    new_players: string | number | null;
    dau_players: string | number | null;
    events: string | number;
    d1_returned: string | number | null;
    d7_returned: string | number | null;
    d7w_returned: string | number | null;
    d1_mature: boolean;
    d7_mature: boolean;
  }>(
    pool,
    `WITH bounds AS (
       SELECT ((now() AT TIME ZONE 'UTC')::date - $1::int) AS d0,
              (now() AT TIME ZONE 'UTC')::date AS today
     ),
     ev AS (
       SELECT e.player_id, ((e.occurred_at AT TIME ZONE 'UTC')::date) AS day
       FROM game_ops.player_events e
       WHERE e.occurred_at >= now() - make_interval(days => $2::int)
     ),
     first_seen AS (
       SELECT player_id, min(day) AS cohort FROM ev GROUP BY player_id
     ),
     cohort_sizes AS (
       SELECT cohort AS day, count(*) AS new_players FROM first_seen GROUP BY cohort
     ),
     dau AS (
       SELECT day, count(DISTINCT player_id) AS dau_players, count(*) AS events
       FROM ev GROUP BY day
     ),
     d1 AS (
       SELECT f.cohort AS day, count(*) AS returned
       FROM first_seen f JOIN ev a ON a.player_id = f.player_id AND a.day = f.cohort + 1
       GROUP BY f.cohort
     ),
     d7 AS (
       SELECT f.cohort AS day, count(*) AS returned
       FROM first_seen f JOIN ev a ON a.player_id = f.player_id AND a.day = f.cohort + 7
       GROUP BY f.cohort
     ),
     d7w AS (
       SELECT f.cohort AS day, count(DISTINCT f.player_id) AS returned
       FROM first_seen f JOIN ev a ON a.player_id = f.player_id
         AND a.day > f.cohort AND a.day <= f.cohort + 7
       GROUP BY f.cohort
     ),
     days AS (
       SELECT generate_series((SELECT d0 FROM bounds), (SELECT today FROM bounds), interval '1 day')::date AS day
     )
     SELECT days.day,
            cs.new_players, d.dau_players, COALESCE(d.events, 0) AS events,
            r1.returned AS d1_returned, r7.returned AS d7_returned, r7w.returned AS d7w_returned,
            days.day <= (SELECT today FROM bounds) - 1 AS d1_mature,
            days.day <= (SELECT today FROM bounds) - 7 AS d7_mature
     FROM days
     LEFT JOIN cohort_sizes cs ON cs.day = days.day
     LEFT JOIN dau d ON d.day = days.day
     LEFT JOIN d1 r1 ON r1.day = days.day
     LEFT JOIN d7 r7 ON r7.day = days.day
     LEFT JOIN d7w r7w ON r7w.day = days.day
     ORDER BY days.day`,
    [lookbackDays, windowStartDays],
  );

  const byEventRows = await query<{ event: string; n: string | number }>(
    pool,
    `SELECT event, count(*) AS n
     FROM game_ops.player_events
     WHERE occurred_at >= now() - make_interval(days => $1::int)
     GROUP BY event`,
    [windowStartDays],
  );

  const num = (v: string | number | null | undefined): number | null =>
    v === null || v === undefined ? null : Number(v);

  const cohorts: CohortRow[] = rows.map(row => ({
    day: String(row.day),
    newPlayers: Number(row.new_players ?? 0),
    dauPlayers: Number(row.dau_players ?? 0),
    events: Number(row.events ?? 0),
    d1Returned: num(row.d1_returned),
    d7Returned: num(row.d7_returned),
    d7WindowReturned: num(row.d7w_returned),
    d1Mature: Boolean(row.d1_mature),
    d7Mature: Boolean(row.d7_mature),
  }));

  const dau = cohorts
    .filter(c => c.dauPlayers > 0)
    .map(c => ({ day: c.day, players: c.dauPlayers, events: c.events }));

  const byEvent: Record<string, number> = {};
  for (const row of byEventRows) byEvent[row.event] = Number(row.n);
  const totalEvents = Object.values(byEvent).reduce((sum, n) => sum + n, 0);
  const totalPlayers = cohorts.length
    ? cohorts.reduce((sum, c) => sum + c.newPlayers, 0)
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays,
    cohorts,
    dau,
    byEvent,
    totalPlayers,
    totalEvents,
    decision: decide(cohorts),
  };
}

/** Вердикт по последней зрелой когорте с n ≥ 10 (см. шапку модуля). */
function decide(cohorts: CohortRow[]): RetentionDecision {
  const base = {
    metric: 'd7_window' as const,
    thresholdBuild: THRESHOLD_BUILD,
    thresholdStop: THRESHOLD_STOP,
  };
  const eligible = cohorts.filter(c => c.d7Mature && c.newPlayers >= MIN_COHORT_SIZE);
  if (!eligible.length) {
    return {
      ...base,
      verdict: 'insufficient',
      value: null,
      cohortDay: null,
      cohortSize: null,
      basis: `Нет зрелой когорты с n ≥ ${MIN_COHORT_SIZE} — данных мало, решение не принимаем`,
    };
  }
  const latest = eligible[eligible.length - 1];
  const returned = latest.d7WindowReturned ?? 0;
  const value = returned / latest.newPlayers;
  const verdict = value >= THRESHOLD_BUILD ? 'build' : value < THRESHOLD_STOP ? 'stop' : 'hold';
  return {
    ...base,
    verdict,
    value,
    cohortDay: latest.day,
    cohortSize: latest.newPlayers,
    basis: `Когорта ${latest.day}: вернулось за неделю ${returned} из ${latest.newPlayers}`,
  };
}
