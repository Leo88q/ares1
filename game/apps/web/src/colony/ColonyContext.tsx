import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { applyAction, freshSession, MAX_ADVANCE_DAYS } from '@ares/colony-engine/colony/actions'
import type { SimAction, SimSession } from '@ares/colony-engine/colony/actions'
import { PARAMETERS } from '@ares/colony-engine/colony/simulation'
import type { ColonyState, Scenario } from '@ares/colony-engine/colony/simulation'
import type { PerformResult } from './serverLink'

/**
 * Одна экспедиция на всю игровую сессию (2026-10-17, продакт-версия FIELD LAB).
 *
 * Два режима одного стора:
 *  - local  (по умолчанию): движок работает в браузере; POTATO не тратится, сеть не нужна;
 *  - server (VITE_COLONY_SIM=true, см. ColonySimProvider): авторитетное состояние на сервере.
 *    Клиент шлёт действия через `perform` и показывает ответ сервера. Локальной мутации нет.
 *
 * Во всех режимах мутация идёт через `perform(action)`: одно и то же действие движка.
 * Поэтому правило одно, а расхождение локальной и серверной логики невозможно.
 */
export const COLONY_TICK_MS = 1200
/** Серверный тик: за один запрос продвигается неделя (паритет скорости: COLONY_TICK_MS на день). */
export const SERVER_TICK_DAYS = MAX_ADVANCE_DAYS
export const SCENARIO_DEBOUNCE_MS = 350

export interface ColonySessionInfo {
  status: 'no-wallet' | 'unsupported' | 'signed-out' | 'busy' | 'signed-in'
  error: string | null
  signIn: () => void
}

export interface ColonyStore {
  mode: 'local' | 'server'
  state: ColonyState
  scenario: Scenario
  running: boolean
  /** 365-дневное исследование завершено: часы стоят, кнопки времени выключены. */
  ended: boolean
  /** Состояние получено и готово к показу. В локальном режиме всегда true. */
  ready: boolean
  /** Действие или загрузка в очереди: кнопки блокируются. */
  pending: boolean
  /** Код последней ошибки сервера (кроме NO_EFFECT); null в локальном режиме. */
  error: string | null
  /** Вход по кошельку (только серверный режим). */
  session: ColonySessionInfo | null
  setRunning: Dispatch<SetStateAction<boolean>>
  /** Единственный путь изменения колонии. */
  perform: (action: SimAction, options?: { spendSignature?: string }) => Promise<PerformResult>
  /** Проверка до оплаты: применилось бы действие к текущему состоянию. */
  canPerform: (action: SimAction) => boolean
  setScenario: (scenario: Scenario) => void
  advance: (days: number) => void
  reset: () => void
}

export const ColonyContext = createContext<ColonyStore | null>(null)

/** Локальный стор: состояние сеанса в браузере. `active === false` — без таймеров (стор общий). */
export function useLocalColonyStore(active = true): ColonyStore {
  const [session, setSession] = useState<SimSession>(freshSession)
  const sessionRef = useRef(session)
  const [running, setRunning] = useState(false)
  const ended = session.state.day >= PARAMETERS.maxDays

  const commit = useCallback((next: SimSession) => {
    sessionRef.current = next
    setSession(next)
  }, [])

  const perform = useCallback(async (action: SimAction): Promise<PerformResult> => {
    const result = applyAction(sessionRef.current, action)
    if (!result.ok) return { ok: false, code: result.code }
    commit(result.session)
    return { ok: true, state: result.session.state, scenario: result.session.scenario }
  }, [commit])

  const canPerform = useCallback((action: SimAction): boolean => applyAction(sessionRef.current, action).ok, [])

  useEffect(() => {
    if (!active || !running || ended) return undefined
    const timer = window.setInterval(() => { void perform({ type: 'advance', days: 1 }) }, COLONY_TICK_MS)
    const pauseHidden = (): void => { if (document.hidden) setRunning(false) }
    document.addEventListener('visibilitychange', pauseHidden)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', pauseHidden) }
  }, [active, running, ended, perform])

  useEffect(() => { if (active && ended) setRunning(false) }, [active, ended])

  return {
    mode: 'local',
    state: session.state,
    scenario: session.scenario,
    running,
    ended,
    ready: true,
    pending: false,
    error: null,
    session: null,
    setRunning,
    perform,
    canPerform,
    setScenario: (scenario: Scenario) => { void perform({ type: 'scenario', scenario }) },
    advance: (days: number) => { void perform({ type: 'advance', days }) },
    reset: () => { setRunning(false); void perform({ type: 'reset' }) },
  }
}

/** Предоставляет стор всей игровой оболочке (App). */
export function ColonyStoreProvider({ store, children }: { store: ColonyStore; children: ReactNode }): JSX.Element {
  return <ColonyContext.Provider value={store}>{children}</ColonyContext.Provider>
}

/** Локальный провайдер: используется, пока VITE_COLONY_SIM выключен. */
export function ColonyProvider({ children }: { children: ReactNode }): JSX.Element {
  const store = useLocalColonyStore(true)
  return <ColonyStoreProvider store={store}>{children}</ColonyStoreProvider>
}

/**
 * Общий стор в оболочке игры; для отдельной песочницы /colony без провайдеров —
 * собственный локальный стор.
 */
export function useColony(): ColonyStore {
  const shared = useContext(ColonyContext)
  const local = useLocalColonyStore(shared === null)
  return shared ?? local
}
