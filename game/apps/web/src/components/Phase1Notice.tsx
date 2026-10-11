/**
 * Phase 1 is a separate mainnet presale, not part of the free devnet beta.
 * Prices and availability come from the public run API; no test-network price
 * is presented as a real offer.
 */
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { BACKEND_URL } from '../contexts/SolanaContext'

const PHASE1_RUN = (import.meta.env.VITE_PRESALE_RUN as string | undefined) || 'wave1'
const LANDING_URL = (
  (import.meta.env.VITE_LANDING_URL as string | undefined) || 'https://ares1-7e1.pages.dev'
).replace(/\/+$/, '')

interface Phase1Run {
  remaining: number
  cap: number
  currency: 'sol' | 'skr'
  priceUnits: string
  cluster?: 'devnet' | 'mainnet-beta'
  isOpen: boolean
  paymentsEnabled?: boolean
}

function formatOfferPrice(units: string, currency: string): string {
  const decimals = currency === 'sol' ? 9 : 6
  const value = BigInt(units)
  const scale = 10n ** BigInt(decimals)
  const whole = value / scale
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${fraction ? `${whole}.${fraction}` : whole.toString()} ${currency.toUpperCase()}`
}

export default function Phase1Notice() {
  const [run, setRun] = useState<Phase1Run | null>(null)

  useEffect(() => {
    if (!BACKEND_URL) return
    let cancelled = false
    fetch(`${BACKEND_URL}/api/presale/runs/${PHASE1_RUN}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.run) return
        setRun(data.run)
      })
      .catch(() => { /* informational notice remains visible without API */ })
    return () => { cancelled = true }
  }, [])

  const mainnet = run?.cluster === 'mainnet-beta'
  const enabled = mainnet && run?.paymentsEnabled === true && run.isOpen

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
        {t('Фаза 1 — отдельный пресейл mainnet. Devnet-бета бесплатна, прогресс не переносится, тестовые SOL/SKR не имеют реальной стоимости.')}
      </div>

      {run?.cluster === 'devnet' && (
        <div style={{ color: '#E8A3A3' }}>
          {t('Этот сервер работает в devnet: не отправляйте сюда реальные средства.')}
        </div>
      )}
      {!enabled && (
        <div style={{ color: '#E8A3A3' }}>
          {t('Пресейл mainnet пока закрыт: не отправляйте средства.')}
        </div>
      )}
      {enabled && run && (
        <>
          <div style={{ color: '#EFD9AC' }}>
            {t('Цена пака: {price}', { price: formatOfferPrice(run.priceUnits, run.currency) })}
          </div>
          <div className="ares-mono" style={{ color: 'var(--pf-text-muted)', letterSpacing: '0.06em' }}>
            {t('Осталось: {n} из {cap}', { n: run.remaining, cap: run.cap })}
          </div>
        </>
      )}
      <a
        href={`${LANDING_URL}/#presale`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#F5BE72', textDecoration: 'underline', alignSelf: 'flex-start' }}
      >
        {t(enabled ? 'Оформить на лендинге →' : 'Посмотреть информацию о Фазе 1 →')}
      </a>
    </div>
  )
}
