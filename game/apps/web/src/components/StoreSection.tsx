import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSolana } from '../contexts/SolanaContext'
import { useFeatures } from '../hooks/useFeatures'
import { useGame } from '../contexts/GameContext'
import { useI18n } from '../i18n'
import PresaleSection from './PresaleSection'

/**
 * Витрина магазина. Показывает ровно то, что отдаёт бэкенд: состав и цену
 * паков, состояние продаж и два бесплатных входа (стартовый набор и дейлик).
 *
 * Честность важнее вида:
 *  - каталог не хардкодится в UI, чтобы цена в браузере не разошлась с ценой
 *    на сервере;
 *  - пока `enabled=false`, кнопки оплаты не рисуются вообще, а не «рисуются
 *    но с disabled» — так нечего случайно нажать;
 *  - сетевой сбой — состояние «витрина недоступна», без console.error, чтобы
 *    не засорять консоль в smoke-прогонах.
 */

// esbuild-фикстуры не подставляют import.meta.env: без optional chaining
// модуль падал бы при загрузке ещё до первого запроса.
const ENV = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env
const BACKEND = (ENV?.VITE_BACKEND_URL || '').replace(/\/$/, '')

interface StorePack {
  id: string
  titleRu: string
  titleEn: string
  fields: Array<{ type: number; count: number; name: string }>
  potatoMicro: string
  potato: string
}

interface StorePayload {
  enabled: boolean
  reason: string | null
  currency: string
  packs: StorePack[]
}

type RequestState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string }

function isStorePayload(value: unknown): value is StorePayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StorePayload>
  return typeof candidate.enabled === 'boolean' && Array.isArray(candidate.packs)
}

export default function StoreSection(): JSX.Element {
  const { t, lang } = useI18n()
  const { publicKey, connected } = useSolana()
  // P0-2: рельса наград выключена константой запуска (REWARDS_RAIL_ENABLED=false).
  // Раньше кнопки стартового набора и дейлика рисовались всегда и падали в 503 —
  // интерфейс обещал бесплатный вход, которого нет. Теперь их видно только
  // тогда, когда сервер действительно отдаёт гранты.
  const { rewardsRail: railOn } = useFeatures()
  const { reload } = useGame()
  const [payload, setPayload] = useState<StorePayload | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [request, setRequest] = useState<RequestState>({ kind: 'idle' })
  const wallet = publicKey?.toBase58() ?? null
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    void fetch(`${BACKEND}/api/store`, { signal: controller.signal, headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`store ${response.status}`)
        const body: unknown = await response.json()
        if (!isStorePayload(body)) throw new Error('store payload')
        if (alive.current) setPayload(body)
      })
      .catch(() => { if (alive.current && !controller.signal.aborted) setUnavailable(true) })
    return () => { alive.current = false; controller.abort() }
  }, [])

  const claim = useCallback(async (kind: 'starter' | 'daily') => {
    if (!wallet) return
    setRequest({ kind: 'pending' })
    try {
      const response = await fetch(`${BACKEND}/api/rewards/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (response.status === 201) {
        setRequest({ kind: 'ok', message: kind === 'starter' ? t('Стартовый набор выдан: 250 POTATO.') : t('Ежедневный бонус выдан: 7 POTATO.') })
        void reload()
        return
      }
      if (response.status === 409) {
        setRequest({ kind: 'error', message: kind === 'starter' ? t('Стартовый набор уже выдан этому кошельку.') : t('Ежедневный бонус уже получен сегодня.') })
        return
      }
      if (response.status === 429) {
        setRequest({ kind: 'error', message: t('Кулдаун: повтори через 15 секунд.') })
        return
      }
      if (response.status === 503 && body.error === 'NOT_ENABLED') {
        setRequest({ kind: 'error', message: t('Выдача недоступна: рельса наград не включена на этом окружении.') })
        return
      }
      setRequest({ kind: 'error', message: t('Не удалось выдать набор. Попробуй позже.') })
    } catch {
      setRequest({ kind: 'error', message: t('Не удалось выдать набор. Попробуй позже.') })
    }
  }, [wallet, reload, t])

  const packs = payload?.packs ?? []
  const open = payload?.enabled === true
  const busy = request.kind === 'pending'
  const titleFor = useCallback((pack: StorePack) => (lang === 'en' ? pack.titleEn : pack.titleRu), [lang])

  const composition = useMemo(() => new Map(packs.map((pack) => [
    pack.id,
    pack.fields.map((field) => `${field.count}× ${field.name}`).join(' + '),
  ])), [packs])

  return (
    <section
      className="po-plate"
      data-testid="store-section"
      aria-labelledby="store-title"
      style={{ gridColumn: '1 / -1', padding: '18px', marginBottom: 12, border: '1px solid rgba(255,179,71,0.24)' }}
    >
      <p className="ares-mono" style={{ color: '#C9A176', fontSize: 9, letterSpacing: '.14em', margin: '0 0 6px' }}>
        ARES-1 / {t('МАГАЗИН ПОЛЕЙ')}
      </p>
      <h2 id="store-title" className="ares-stencil" style={{ color: '#EFD9AC', fontSize: 14, margin: '0 0 8px' }}>
        {railOn ? t('ВХОД БЕСПЛАТНЫЙ') : t('ВХОД ЧЕРЕЗ ОПЕРАТОРА')}
      </h2>
      <p style={{ color: 'var(--pf-text-secondary)', fontSize: 11, lineHeight: 1.55, margin: '0 0 12px' }}>
        {railOn
          ? t('Стартовый набор 250 POTATO выдаётся один раз на кошелёк подписантом оператора. Ежедневный бонус 7 POTATO — один раз в UTC-сутки. Реферальных наград нет.')
          : t('Бесплатная выдача выключена: рельса наград включается отдельным решением запуска. Первое поле выдаёт оператор. Не отправляй деньги ради теста.')}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {!railOn
          ? <p data-testid="store-rewards-off" style={{ margin: 0, color: 'var(--pf-text-muted)', fontSize: 10 }}>
            {t('Кнопок выдачи нет, пока рельса наград не включена: нажимать нечего, и «пустая» кнопка не должна выглядеть как работающая функция.')}
          </p>
          : connected && wallet
          ? <>
            <button
              type="button"
              className="mk-key"
              data-testid="store-claim-starter"
              onClick={() => void claim('starter')}
              disabled={busy}
              style={{ padding: '8px 11px', fontSize: 9 }}
            >{busy ? t('Отправляем…') : t('ПОЛУЧИТЬ СТАРТОВЫЙ НАБОР')}</button>
            <button
              type="button"
              className="mk-key"
              data-testid="store-claim-daily"
              onClick={() => void claim('daily')}
              disabled={busy}
              style={{ padding: '8px 11px', fontSize: 9 }}
            >{busy ? t('Отправляем…') : t('Получить ежедневные 7 POTATO')}</button>
          </>
          : <p style={{ margin: 0, color: 'var(--pf-text-muted)', fontSize: 10 }}>
            {t('Подключи кошелёк, чтобы получить бесплатный стартовый набор.')}
          </p>}
      </div>
      {request.kind !== 'idle' && request.kind !== 'pending' && (
        <p
          role="status"
          data-testid="store-claim-status"
          style={{ margin: '0 0 12px', fontSize: 10, lineHeight: 1.5, color: request.kind === 'ok' ? '#B7D98A' : '#F0A18E' }}
        >{request.message}</p>
      )}

      {unavailable
        ? <p role="status" style={{ margin: 0, color: '#F0A18E', fontSize: 10 }}>{t('Витрина недоступна: бэкенд не ответил. Это не ошибка кошелька.')}</p>
        : !payload
          ? <p aria-busy="true" style={{ margin: 0, color: 'var(--pf-text-muted)', fontSize: 10 }}>{t('Загружаем каталог…')}</p>
          : <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', flexWrap: 'wrap' }}>
              <span
                data-testid="store-state"
                style={{
                  font: '9px/1.5 var(--ares-font-mono, monospace)',
                  letterSpacing: '.12em',
                  padding: '3px 7px',
                  border: `1px solid ${open ? 'rgba(183,217,138,0.5)' : 'rgba(255,179,71,0.4)'}`,
                  color: open ? '#B7D98A' : '#EFD9AC',
                }}
              >{open ? t('ПРОДАЖИ ОТКРЫТЫ') : t('ВИТРИНА ЗАКРЫТА')}</span>
              <span style={{ color: 'var(--pf-text-muted)', fontSize: 10 }}>
                {open
                  ? t('Оплата паков доступна. Все суммы в POTATO.')
                  : t('Покупка паков за POTATO ещё не включена. Состав и цена показаны честно, кнопки оплаты нет.')}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 10 }}>
              {packs.map((pack) => (
                <article
                  key={pack.id}
                  data-testid={`store-pack-${pack.id}`}
                  style={{ border: '1px solid rgba(255,179,71,0.22)', padding: '12px', background: 'rgba(0,0,0,0.18)' }}
                >
                  <h3 style={{ margin: '0 0 4px', color: '#EFD9AC', fontSize: 11, letterSpacing: '.06em' }}>{titleFor(pack)}</h3>
                  <p className="ares-mono" style={{ margin: '0 0 6px', color: '#C9A176', fontSize: 9 }}>{pack.id}</p>
                  <p style={{ margin: '0 0 6px', color: 'var(--pf-text-secondary)', fontSize: 10 }}>{composition.get(pack.id)}</p>
                  <p style={{ margin: 0, color: '#FFC94A', fontSize: 12 }}>{pack.potato} POTATO</p>
                </article>
              ))}
            </div>
          </>}

      <PresaleSection />
    </section>
  )
}
