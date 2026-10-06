/**
 * Фаза 1 (оффчейн-предоплата) в игре — требование RFC §4.4.
 *
 * Тестировщики devnet-беты не должны решить, что купленный пак действует в
 * текущей бете: пак Фазы 1 оплачивается оффчейн (лендинг), POTATO выдаётся в
 * день листинга на mainnet, devnet-прогресс покупка не меняет. Поэтому здесь
 * только условия и явная пометка, а оформление — на лендинге, где живёт форма
 * и живой счётчик остатка.
 *
 * Счётчик остатка здесь необязательный: он берётся из того же публичного
 * контракта, что читает баннер лендинга (`GET /api/presale/runs/:runId`,
 * camelCase — см. publicRunStatus() в backend). Если BACKEND_URL не задан или
 * бэкенд недоступен, блок показывает условия без счётчика — это не ошибка.
 */
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { BACKEND_URL } from '../contexts/SolanaContext'

/** Цена пака Фазы 1 (решение владельца 2026-10-06). Фаза 2 — 1053 SKR. */
const PHASE1_PRICE_SKR = 888
const PHASE1_RUN = (import.meta.env.VITE_PRESALE_RUN as string | undefined) || 'wave1'
const LANDING_URL = (
  (import.meta.env.VITE_LANDING_URL as string | undefined) || 'https://ares1-7e1.pages.dev'
).replace(/\/+$/, '')

interface Phase1Run {
  remaining: number
  cap: number
}

export default function Phase1Notice() {
  const [run, setRun] = useState<Phase1Run | null>(null)

  useEffect(() => {
    if (!BACKEND_URL) return
    let cancelled = false
    fetch(`${BACKEND_URL}/api/presale/runs/${PHASE1_RUN}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.run) return
        setRun({ remaining: d.run.remaining, cap: d.run.cap })
      })
      .catch(() => {
        /* счётчик необязателен: условия показываем и так */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      role="note"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '12px 14px',
        margin: '0 0 16px',
        border: '1px dashed rgba(245,190,114,0.5)',
        borderRadius: 2,
        background: 'rgba(245,190,114,0.06)',
        fontSize: 11,
        lineHeight: 1.55,
      }}
    >
      <div
        className="po-spray"
        style={{ fontSize: 9, letterSpacing: '0.14em', color: '#F5BE72' }}
      >
        {t('ФАЗА 1 · ПРЕДОПЛАТА (ОФФЧЕЙН)')}
      </div>
      <div style={{ color: '#EFD9AC' }}>
        {t('Пак Фазы 1 — {price} SKR за 1 000 POTATO.', { price: PHASE1_PRICE_SKR })}
      </div>
      <div style={{ color: 'var(--pf-text-muted)' }}>
        {t('POTATO выдаётся в день листинга на mainnet.')}
      </div>
      <div style={{ color: '#E8A3A3' }}>
        {t('Покупка не влияет на devnet-прогресс: пак не действует в текущей бете.')}
      </div>
      {run && (
        <div className="ares-mono" style={{ color: 'var(--pf-text-muted)', letterSpacing: '0.06em' }}>
          {t('Осталось: {n} из {cap}', { n: run.remaining, cap: run.cap })}
        </div>
      )}
      <a
        href={`${LANDING_URL}/#presale`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#F5BE72', textDecoration: 'underline', alignSelf: 'flex-start' }}
      >
        {t('Оформить на лендинге →')}
      </a>
    </div>
  )
}
