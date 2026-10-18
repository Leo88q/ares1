import { createContext, useContext, useEffect, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { DEFAULT_SCENARIO, PARAMETERS, advanceDays, initialColony } from './simulation'
import type { ColonyState, Scenario } from './simulation'

/**
 * Одна экспедиция на всю игровую сессию (2026-10-17, продакт-версия FIELD LAB).
 *
 * Раньше состояние колонии жило в `useState` внутри ColonyScreen: переход в другую
 * секцию размонтировал экран и обнулял воду/энергию/еду. Теперь стор общий — его
 * читают КОЛОНИЯ (`/base`) и ПОЛЕВАЯ ЛАБОРАТОРИЯ (`/lab`), поэтому литры, киловатты,
 * питание, запчасти и килограммы еды — одни и те же числа в обеих секциях.
 *
 * Границы сохранены: это локальная песочница дизайна (CR, литры, кг), она не пишет
 * в persistent storage, не минтит POTATO и не отправляет транзакции. Перезагрузка
 * страницы начинает новую экспедицию — как и раньше.
 */
export const COLONY_TICK_MS = 1200

export interface ColonyStore {
  state: ColonyState
  scenario: Scenario
  running: boolean
  /** 365-дневное исследование завершено: часы стоят, кнопки времени выключены. */
  ended: boolean
  setState: Dispatch<SetStateAction<ColonyState>>
  setScenario: Dispatch<SetStateAction<Scenario>>
  setRunning: Dispatch<SetStateAction<boolean>>
  advance: (days: number) => void
  reset: () => void
}

const ColonyContext = createContext<ColonyStore | null>(null)

/**
 * Expedition clock. `active === false` keeps the hook legal (hooks are not
 * conditional) but idle: no timers, no state churn — used when a shared store
 * from ColonyProvider already owns the session.
 */
export function useColonyStore(active = true): ColonyStore {
  const [state, setState] = useState<ColonyState>(initialColony)
  const [scenario, setScenario] = useState<Scenario>({ ...DEFAULT_SCENARIO })
  const [running, setRunning] = useState(false)
  const ended = state.day >= PARAMETERS.maxDays

  useEffect(() => {
    if (!active || !running || ended) return
    const timer = window.setInterval(() => setState(s => advanceDays(s, 1, scenario)), COLONY_TICK_MS)
    const pauseHidden = (): void => { if (document.hidden) setRunning(false) }
    document.addEventListener('visibilitychange', pauseHidden)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', pauseHidden) }
  }, [active, running, scenario, ended])

  useEffect(() => { if (active && ended) setRunning(false) }, [active, ended])

  const advance = (days: number): void => setState(s => advanceDays(s, days, scenario))
  const reset = (): void => {
    setRunning(false)
    setState(initialColony())
    setScenario({ ...DEFAULT_SCENARIO })
  }

  return { state, scenario, running, ended, setState, setScenario, setRunning, advance, reset }
}

/** Mounts one shared expedition for every section of the game shell. */
export function ColonyProvider({ children }: { children: ReactNode }): JSX.Element {
  const store = useColonyStore(true)
  return <ColonyContext.Provider value={store}>{children}</ColonyContext.Provider>
}

/**
 * Shared store inside the game shell; a private one for the standalone
 * wallet-free `/colony` sandbox, which mounts without providers.
 */
export function useColony(): ColonyStore {
  const shared = useContext(ColonyContext)
  const local = useColonyStore(shared === null)
  return shared ?? local
}
