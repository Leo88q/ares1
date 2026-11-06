// Связка клиента с серверной колонией: последовательная очередь действий и актуальный sequence.
// Чистый TypeScript без React. React-стор (ColonyContext) только подписан на onChange.
//
// Правила:
//  - действия уходят строго по одному, каждое берёт sequence последнего принятого ответа;
//  - STALE_SEQUENCE: сервер ничего не применил и не списал квитанцию, поэтому один повтор
//    с тем же requestId и той же подписью оплаты безопасен;
//  - NO_EFFECT — не ошибка сеанса: колония не меняется, отказ возвращается вызывающему;
//  - NETWORK: после сбоя запрашиваем состояние, чтобы не работать с устаревшим sequence.
import type { SimAction } from '@ares/colony-engine/colony/actions'
import type { ColonyState, Scenario } from '@ares/colony-engine/colony/simulation'
import type { SimClient, SimView } from './simClient'

export type PerformResult =
  | { ok: true; state: ColonyState; scenario: Scenario }
  | { ok: false; code: string }

export interface LinkSnapshot {
  view: SimView | null
  /** Есть действия или загрузка в очереди. */
  busy: boolean
  /** Последний код ошибки, кроме NO_EFFECT; null, если всё в порядке. */
  error: string | null
}

export interface PerformOptions {
  spendSignature?: string
}

const MAX_STALE_ATTEMPTS = 2

export class ColonyServerLink {
  private view: SimView | null = null
  private error: string | null = null
  private queued = 0
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly client: SimClient,
    private readonly newId: () => string,
    private readonly onChange: (snapshot: LinkSnapshot) => void,
  ) {}

  snapshot(): LinkSnapshot {
    return { view: this.view, busy: this.queued > 0, error: this.error }
  }

  /** Загрузка состояния с сервера (первый вход, повтор после сбоя). */
  load(): Promise<void> {
    return this.enqueue(async () => {
      try {
        this.apply(await this.client.get(), null)
      } catch (err) {
        this.setError(errorCode(err))
      }
    })
  }

  /** Отправка действия. Возвращает новое состояние или код отказа. */
  perform(action: SimAction, options: PerformOptions = {}): Promise<PerformResult> {
    const requestId = this.newId()
    return this.enqueue(async (): Promise<PerformResult> => {
      for (let attempt = 0; attempt < MAX_STALE_ATTEMPTS; attempt++) {
        const current = this.view
        if (!current) return { ok: false, code: 'NOT_LOADED' }

        let res
        try {
          res = await this.client.act({
            requestId,
            expectedSequence: current.sequence,
            action,
            ...(options.spendSignature !== undefined ? { spendSignature: options.spendSignature } : {}),
          })
        } catch {
          // Ответ мог потеряться уже после применения: берём состояние с сервера.
          await this.resync()
          this.setError('NETWORK')
          return { ok: false, code: 'NETWORK' }
        }

        if (res.ok) {
          this.apply(res.view, null)
          return { ok: true, state: res.view.state, scenario: res.view.scenario }
        }
        if (res.view) this.apply(res.view, this.error)
        if (res.code === 'STALE_SEQUENCE' && res.view && attempt + 1 < MAX_STALE_ATTEMPTS) continue
        // NO_EFFECT — не ошибка сеанса: кнопка просто ничего не меняет.
        if (res.code !== 'NO_EFFECT') this.setError(res.code)
        return { ok: false, code: res.code }
      }
      return { ok: false, code: 'STALE_SEQUENCE' }
    })
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    this.queued++
    this.emit()
    const run = this.tail.then(job)
    this.tail = run.catch(() => undefined)
    return run.finally(() => {
      this.queued--
      this.emit()
    })
  }

  private async resync(): Promise<void> {
    try {
      this.apply(await this.client.get(), this.error)
    } catch {
      // Сеть недоступна: остаёмся на последнем известном состоянии, ошибка уже записана.
    }
  }

  private apply(view: SimView, error: string | null): void {
    this.view = view
    this.error = error
    this.emit()
  }

  private setError(code: string | null): void {
    this.error = code
    this.emit()
  }

  private emit(): void {
    this.onChange(this.snapshot())
  }
}

function errorCode(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : 'NETWORK'
}
