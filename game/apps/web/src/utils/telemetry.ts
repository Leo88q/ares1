/**
 * Телеметрия удержания: события уходят на POST /api/gameops/events.
 *
 * Принципы (см. gameops/retention.ts, «границы честности данных»):
 *   - fire-and-forget: телеметрия НИКОГДА не ломает игровой поток — любая
 *     ошибка молча гасится;
 *   - идентичность: кошелёк (если подключён) иначе стабильный anon-UUID из
 *     localStorage — когорта «первого дня» строится и без кошелька;
 *   - батч: события копятся в очереди (10 шт или5 сек), до20 за запрос
 *     (лимит сервера), на выгрузке страницы — keepalive-запрос.
 *   - без VITE_BACKEND_URL (статика без бэка) — просто no-op.
 */

type EventName =
  | 'session_start' | 'buy_field' | 'presale_buy' | 'harvest' | 'upgrade'
  | 'repair' | 'pay_tax' | 'fertilize' | 'claim_reward' | 'close_field' | 'transfer'

/** Имя события — для проводки в игровых действиях (GameContext). */
export type TelemetryEventName = EventName

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')
const ANON_KEY = 'ares_anon_id'
const FLUSH_DELAY_MS = 5_000
const FLUSH_AT = 10
const MAX_PER_CALL = 20

function anonId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY)
    if (!id) {
      id = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      localStorage.setItem(ANON_KEY, id)
    }
    return `anon-${id}`
  } catch {
    // localStorage может быть запрещён (file://, приватный режим) — без
    // идентичности событие просто не отправляем, игра не страдает.
    return ''
  }
}

interface TelemetryEvent { player: string; event: EventName }

const queue: TelemetryEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!BACKEND_URL || queue.length === 0) return
  const batch = queue.splice(0, MAX_PER_CALL)
  try {
    void fetch(`${BACKEND_URL}/api/gameops/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    }).catch(() => undefined)
  } catch { /* выгрузка — no-op */ }
  if (queue.length > 0 && flushTimer === null) flushTimer = setTimeout(flush, FLUSH_DELAY_MS)
}

/** Отправить событие. player — base58-кошелёк; пусто/undefined → anon-UUID. */
export function track(event: EventName, player?: string | null): void {
  if (!BACKEND_URL) return
  const id = player && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(player) ? player : anonId()
  if (!id) return
  queue.push({ player: id, event })
  if (queue.length >= FLUSH_AT) flush()
  else if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_DELAY_MS)
}
