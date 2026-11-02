import { useEffect, useState } from 'react'

/**
 * Публичные фича-флаги бэкенда (`GET /api/features`).
 *
 * Зачем отдельный хук. Раздел «Колония» существует как экран статуса, но при
 * `COLONIES_ENABLED=false` на сервере он не должен выглядеть как рабочая
 * функция. Флаги читаются один раз при старте; сеть и RPC здесь не нужны.
 *
 * Флаги — только для интерфейса. Они НЕ разрешают операции: каждое действие
 * проверяется своим серверным гейтом, поэтому подделанный ответ не открывает
 * ни покупок, ни грантов.
 *
 * Fail-open для «Колонии»: если бэкенд не ответил (локальная сборка, dev-стенд
 * без API), экран статуса остаётся доступным, как и раньше. Обратное (fail-closed)
 * спрятало бы существующий раздел из-за сетевого сбоя.
 */

export interface FeatureFlags {
  colonies: boolean
  coloniesReleaseReady: boolean
  rewardsRail: boolean
  presalePayments: boolean
}

const DEFAULTS: FeatureFlags = {
  colonies: true,
  coloniesReleaseReady: false,
  rewardsRail: false,
  presalePayments: false,
}

// esbuild-фикстуры не подставляют import.meta.env: без optional chaining
// модуль падал бы при загрузке ещё до первого запроса.
const ENV = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env
const BACKEND = (ENV?.VITE_BACKEND_URL || '').replace(/\/$/, '')

function parse(value: unknown): FeatureFlags | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<FeatureFlags>
  if (typeof raw.colonies !== 'boolean') return null
  return {
    colonies: raw.colonies,
    coloniesReleaseReady: raw.coloniesReleaseReady === true,
    rewardsRail: raw.rewardsRail === true,
    presalePayments: raw.presalePayments === true,
  }
}

export function useFeatures(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULTS)
  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    void fetch(`${BACKEND}/api/features`, { signal: controller.signal, headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) return null
        return parse(await response.json())
      })
      .then((parsed) => { if (alive && parsed) setFlags(parsed) })
      .catch(() => { /* оставляем значения по умолчанию */ })
    return () => { alive = false; controller.abort() }
  }, [])
  return flags
}
