// Серверный режим колонии (F4): состояние и тики приходят с сервера, вход — по кошельку.
// Подключается в App только при VITE_COLONY_SIM=true. Без флага этот модуль не используется.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { applyAction, freshSession } from '@ares/colony-engine/colony/actions'
import type { SimAction } from '@ares/colony-engine/colony/actions'
import { PARAMETERS } from '@ares/colony-engine/colony/simulation'
import type { Scenario } from '@ares/colony-engine/colony/simulation'
import { BACKEND_URL } from '../contexts/SolanaContext'
import { COLONY_TICK_MS, SCENARIO_DEBOUNCE_MS, SERVER_TICK_DAYS, ColonyStoreProvider } from './ColonyContext'
import type { ColonySessionInfo, ColonyStore } from './ColonyContext'
import { ColonyServerLink } from './serverLink'
import type { LinkSnapshot, PerformResult } from './serverLink'
import { createSimClient } from './simClient'
import type { SimView } from './simClient'
import { useColonySession } from './useColonySession'
import type { ColonySessionState } from './useColonySession'

const EMPTY: LinkSnapshot = { view: null, busy: false, error: null }
// Заглушки только для типов: пока состояние не загружено, экран его не показывает (ready = false).
const PLACEHOLDER = freshSession()

function sessionInfo(session: ColonySessionState): ColonySessionInfo {
  const status: ColonySessionInfo['status'] = !session.connected ? 'no-wallet'
    : !session.canSign ? 'unsupported'
      : session.busy ? 'busy'
        : session.token ? 'signed-in' : 'signed-out'
  return { status, error: session.error, signIn: () => { void session.signIn() } }
}

function useServerColonyStore(session: ColonySessionState): ColonyStore {
  const token = session.token
  const client = useMemo(() => (token ? createSimClient({ baseUrl: `${BACKEND_URL}/api/colony-sim`, token }) : null), [token])
  const [snap, setSnap] = useState<LinkSnapshot>(EMPTY)
  const link = useMemo(() => (client ? new ColonyServerLink(client, () => crypto.randomUUID(), setSnap) : null), [client])
  const [running, setRunning] = useState(false)
  const [draft, setDraft] = useState<Scenario | null>(null)
  const draftTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!link) {
      setSnap(EMPTY)
      return undefined
    }
    void link.load()
    return undefined
  }, [link])

  useEffect(() => () => window.clearTimeout(draftTimer.current), [])

  const view: SimView | null = snap.view
  const ready = view !== null
  const ended = view ? view.state.day >= PARAMETERS.maxDays : false

  // Серверный тик: неделя за запрос, пока предыдущий запрос не закончился.
  useEffect(() => {
    if (!running || !link || !ready || ended) return undefined
    const timer = window.setInterval(() => {
      if (!link.snapshot().busy) void link.perform({ type: 'advance', days: SERVER_TICK_DAYS })
    }, COLONY_TICK_MS * SERVER_TICK_DAYS)
    const pauseHidden = (): void => { if (document.hidden) setRunning(false) }
    document.addEventListener('visibilitychange', pauseHidden)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', pauseHidden)
    }
  }, [running, link, ready, ended])

  useEffect(() => { if (ended) setRunning(false) }, [ended])

  const perform = useCallback(
    (action: SimAction, options?: { spendSignature?: string }): Promise<PerformResult> => (
      link ? link.perform(action, options) : Promise.resolve({ ok: false as const, code: 'NOT_LOADED' })
    ),
    [link],
  )

  const canPerform = useCallback(
    (action: SimAction): boolean => (view ? applyAction({ state: view.state, scenario: view.scenario }, action).ok : false),
    [view],
  )

  const setScenario = useCallback((next: Scenario): void => {
    if (!link) return
    setDraft(next)
    window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      void link.perform({ type: 'scenario', scenario: next }).finally(() => {
        setDraft(current => (current === next ? null : current))
      })
    }, SCENARIO_DEBOUNCE_MS)
  }, [link])

  const advance = useCallback((days: number): void => {
    if (link) void link.perform({ type: 'advance', days })
  }, [link])

  const reset = useCallback((): void => {
    setRunning(false)
    setDraft(null)
    if (link) void link.perform({ type: 'reset' })
  }, [link])

  return {
    mode: 'server',
    state: view?.state ?? PLACEHOLDER.state,
    scenario: draft ?? view?.scenario ?? PLACEHOLDER.scenario,
    running,
    ended,
    ready,
    pending: snap.busy,
    error: snap.error,
    session: sessionInfo(session),
    setRunning,
    perform,
    canPerform,
    setScenario,
    advance,
    reset,
  }
}

/** Серверный провайдер: вход по кошельку и общий стор колонии для /base и /lab. */
export function ServerColonyProvider({ children }: { children: ReactNode }): JSX.Element {
  const session = useColonySession()
  const store = useServerColonyStore(session)
  return <ColonyStoreProvider store={store}>{children}</ColonyStoreProvider>
}
