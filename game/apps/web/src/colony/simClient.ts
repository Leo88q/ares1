// HTTP-клиент серверной симуляции колонии (F4, вариант 2: сервер авторитетен).
// Чистый TypeScript без React: проверяется в Node (tests/colony-sim-client.test.mjs).
//
// Идемпотентность: requestId создаётся один раз на действие и повторяется при сетевом сбое.
// Сервер на повтор того же requestId отвечает reused: true и не применяет действие второй раз.
import type { SimAction } from '@ares/colony-engine/colony/actions'
import type { ColonyState, Scenario } from '@ares/colony-engine/colony/simulation'

export interface SimView {
  sequence: number
  state: ColonyState
  scenario: Scenario
  engineVersion: number
  stateHash: string
}

export type SimResponse =
  | { ok: true; reused: boolean; view: SimView }
  | { ok: false; status: number; code: string; view?: SimView }

export interface SimActInput {
  requestId: string
  expectedSequence: number
  action: SimAction
  spendSignature?: string
}

/** Ошибка загрузки состояния: код из ответа сервера или NETWORK / HTTP_<статус>. */
export class SimLoadError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'SimLoadError'
  }
}

export interface SimClient {
  /** Текущее состояние колонии. Бросает SimLoadError. */
  get(): Promise<SimView>
  /** Отправка действия. Ответ сервера (в т.ч. отказ) возвращается, а не бросается. Сетевой сбой после повторов — NETWORK. */
  act(input: SimActInput): Promise<SimResponse>
}

export interface SimClientOptions {
  /** Базовый URL API симуляции, например `${BACKEND_URL}/api/colony-sim`. */
  baseUrl: string
  /** Bearer-токен сессии кошелька (тот же, что у /api/colonies). */
  token: string
  fetchImpl?: typeof fetch
  /** Число повторов при сетевом сбое (не при ответе сервера). */
  retries?: number
  sleep?: (ms: number) => Promise<void>
}

const RETRY_DELAY_MS = 400

export function createSimClient(options: SimClientOptions): SimClient {
  const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const retries = options.retries ?? 2
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${options.token}` }

  return {
    async get(): Promise<SimView> {
      let res: Response
      try {
        res = await doFetch(`${options.baseUrl}/state`, { headers })
      } catch {
        throw new SimLoadError('NETWORK', 0)
      }
      const body = await readBody(res)
      if (res.ok && body?.ok === true && body.view) return body.view as SimView
      throw new SimLoadError(typeof body?.code === 'string' ? body.code : (typeof body?.error === 'string' ? body.error : `HTTP_${res.status}`), res.status)
    },

    async act(input: SimActInput): Promise<SimResponse> {
      // Тело фиксируется один раз: при повторе уходят те же requestId, action и подпись.
      const payload = JSON.stringify({
        requestId: input.requestId,
        expectedSequence: input.expectedSequence,
        action: input.action,
        ...(input.spendSignature !== undefined ? { spendSignature: input.spendSignature } : {}),
      })
      let res: Response | null = null
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          res = await doFetch(`${options.baseUrl}/actions`, { method: 'POST', headers, body: payload })
          break
        } catch {
          if (attempt === retries) throw new Error('NETWORK')
          await sleep(RETRY_DELAY_MS * (attempt + 1))
        }
      }
      if (!res) throw new Error('NETWORK')
      const body = await readBody(res)
      if (res.ok && body?.ok === true && body.view) {
        return { ok: true, reused: body.reused === true, view: body.view as SimView }
      }
      return {
        ok: false,
        status: res.status,
        code: typeof body?.code === 'string' ? body.code : (typeof body?.error === 'string' ? body.error : `HTTP_${res.status}`),
        ...(body?.view ? { view: body.view as SimView } : {}),
      }
    },
  }
}

interface RawBody { ok?: unknown; code?: unknown; error?: unknown; reused?: unknown; view?: unknown }

async function readBody(res: Response): Promise<RawBody | null> {
  try {
    const value = await res.json()
    return typeof value === 'object' && value !== null ? (value as RawBody) : null
  } catch {
    return null
  }
}

/** Текст ошибки для игрока. Коды — из ColonySimService (service.ts) и из клиента. */
export function simErrorMessage(code: string | undefined, ru: boolean): string {
  const table: Record<string, [string, string]> = {
    NO_EFFECT: ['Действие ничего не меняет в колонии.', 'The action changes nothing in the colony.'],
    NO_WORLD: ['Лаборатория колонии ещё не создана.', 'The colony lab does not exist yet.'],
    COLONY_ENDED: ['Исследование завершено: 365 дней.', 'The 365-day study is complete.'],
    STALE_SEQUENCE: ['Колония изменилась в другой вкладке. Состояние обновлено, повторите действие.', 'The colony changed in another tab. The state is refreshed; repeat the action.'],
    REQUEST_CONFLICT: ['Конфликт запроса. Обновите страницу.', 'Request conflict. Reload the page.'],
    RECEIPT_REQUIRED: ['Для этого действия нужна оплата POTATO.', 'This action requires a POTATO payment.'],
    RECEIPT_NOT_FOUND: ['Сервер не нашёл оплату. Колония не изменена.', 'The server could not find the payment. The colony was not changed.'],
    RECEIPT_MISMATCH: ['Оплата не совпадает с действием. Колония не изменена.', 'The payment does not match the action. The colony was not changed.'],
    RECEIPT_USED: ['Эта оплата уже использована.', 'This payment was already used.'],
    SESSION_REQUIRED: ['Войдите через кошелёк снова.', 'Sign in with your wallet again.'],
    SESSION_INVALID: ['Сессия кошелька истекла. Войдите снова.', 'The wallet session expired. Sign in again.'],
    ENGINE_VERSION_MISMATCH: ['Версия правил колонии не совпадает с сохранением. Действия отключены.', 'The colony rules version does not match the save. Actions are disabled.'],
    REPLAY_FAILED: ['Сохранение колонии не проходит проверку. Действия отключены.', 'The colony save failed verification. Actions are disabled.'],
    REPLAY_HASH_MISMATCH: ['Сохранение колонии не совпадает с журналом. Действия отключены.', 'The colony save does not match its journal. Actions are disabled.'],
    INTERNAL: ['Внутренняя ошибка сервера. Колония не изменена, повторите позже.', 'Internal server error. The colony was not changed; try again later.'],
    NETWORK: ['Нет связи с сервером колонии. Повторите попытку.', 'Cannot reach the colony server. Try again.'],
  }
  const hit = code ? table[code] : undefined
  if (hit) return ru ? hit[0] : hit[1]
  if (code?.startsWith('INVALID_')) return ru ? 'Некорректный запрос.' : 'Invalid request.'
  return ru ? 'Действие не выполнено.' : 'The action failed.'
}
