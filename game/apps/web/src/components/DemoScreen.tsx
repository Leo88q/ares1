import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Droplets, Leaf, RotateCcw, Sprout } from 'lucide-react'
import { useI18n } from '../i18n'
import { Tuber9 } from './ares/mascot'

export default function DemoScreen(): JSX.Element {
  const { t } = useI18n()
  const [planted, setPlanted] = useState(false)
  const [water, setWater] = useState(0)
  const [harvested, setHarvested] = useState(0)

  const plant = (): void => {
    setPlanted(true)
    setWater(0)
    setHarvested(0)
  }

  const waterCrop = (): void => {
    if (planted) setWater((value) => Math.min(3, value + 1))
  }

  const harvestCrop = (): void => {
    if (planted && water >= 2) {
      setHarvested((value) => value + 1)
      setWater(0)
    }
  }

  const reset = (): void => {
    setPlanted(false)
    setWater(0)
    setHarvested(0)
  }

  return (
    <div className="main-screen-container" style={{ paddingBottom: 100 }}>
      <Link to="/" className="mk-key" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 11px', textDecoration: 'none', fontSize: 10, marginBottom: 16 }}>
        <ArrowLeft size={14} aria-hidden="true" /> {t('НАЗАД В КОЛОНИЮ')}
      </Link>

      <div style={{ border: '1px solid rgba(255,179,71,0.42)', borderRadius: 9, padding: '18px 16px', background: 'radial-gradient(circle at 80% 10%, rgba(193,68,14,0.17), transparent 35%), linear-gradient(180deg,#21150d,#100b07)', marginBottom: 14 }}>
        <div className="ares-mono" style={{ color: '#FFC94A', fontSize: 9, letterSpacing: '0.15em', marginBottom: 7 }}>{t('ОБУЧАЮЩИЙ СИМУЛЯТОР · БЕЗ КОШЕЛЬКА')}</div>
        <h1 className="pf-h1" style={{ fontSize: 25, margin: 0 }}>{t('ПОПРОБУЙ ПЕРВУЮ ТЕПЛИЦУ')}</h1>
        <p style={{ color: 'var(--pf-text-secondary)', fontSize: 12, lineHeight: 1.55, margin: '8px 0 0' }}>
          {t('Это локальная демо-сцена: кнопки меняют только состояние в браузере. Здесь нет токенов, транзакций, кошелька или сохранения прогресса.')}
        </p>
      </div>

      <div className="po-plate po-plate--market" style={{ padding: 16, position: 'relative', overflow: 'hidden' }}>
        <span className="po-hazard-corner" aria-hidden="true" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 15 }}>
          <div>
            <div className="ares-mono" style={{ color: '#C9A176', fontSize: 9 }}>{t('УЧЕБНЫЙ МОДУЛЬ')}</div>
            <h2 className="ares-stencil" style={{ color: '#F6F1ED', fontSize: 17, margin: '4px 0 0' }}>{t('КАССЕТА № 01 · COMMON')}</h2>
          </div>
          <div style={{ width: 66, height: 66, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,179,71,.14),transparent 72%)' }}>
            <Tuber9 mood={planted && water >= 2 ? 'happy' : 'sleep'} size={56} />
          </div>
        </div>

        <div style={{ padding: 13, border: '1px solid rgba(255,179,71,0.18)', borderRadius: 8, background: 'rgba(8,6,4,0.55)', marginBottom: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, marginBottom: 8 }}>
            <span className="ares-mono" style={{ color: '#C9A176' }}>{t('СОСТОЯНИЕ РОСТКА')}</span>
            <span className="ares-mono" style={{ color: planted ? '#9FBE7A' : '#E0A183' }}>{planted ? t('ПОСАЖЕН') : t('КАССЕТА ПУСТА')}</span>
          </div>
          <div style={{ height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${planted ? Math.min(100, (water / 2) * 100) : 0}%`, background: 'linear-gradient(90deg,#9FBE7A,#FFC94A)', transition: 'width .25s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, color: 'var(--pf-text-muted)', fontSize: 9 }}>
            <span className="ares-mono">{t('ВОДНЫЕ ЦИКЛЫ: {n}/2', { n: water })}</span>
            <span className="ares-mono">{t('ДЕМО-УРОЖАЙ: {n}', { n: harvested })}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <button type="button" className="mk-key mk-key--paint" onClick={plant} disabled={planted} style={{ minHeight: 64, padding: '8px 5px', display: 'grid', placeItems: 'center', gap: 3, fontSize: 9 }}>
            <Sprout size={16} aria-hidden="true" />{t('ПОСАДИТЬ')}
          </button>
          <button type="button" className="mk-key" onClick={waterCrop} disabled={!planted || water >= 3} style={{ minHeight: 64, padding: '8px 5px', display: 'grid', placeItems: 'center', gap: 3, fontSize: 9 }}>
            <Droplets size={16} aria-hidden="true" />{t('ПОЛИТЬ')}
          </button>
          <button type="button" className="mk-key" onClick={harvestCrop} disabled={!planted || water < 2} style={{ minHeight: 64, padding: '8px 5px', display: 'grid', placeItems: 'center', gap: 3, fontSize: 9 }}>
            <Leaf size={16} aria-hidden="true" />{t('СОБРАТЬ')}
          </button>
        </div>

        <button type="button" className="mk-key" onClick={reset} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 9px', marginTop: 12, fontSize: 9 }}>
          <RotateCcw size={13} aria-hidden="true" /> {t('СБРОСИТЬ ДЕМО')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 9, marginTop: 13, flexWrap: 'wrap' }}>
        <Link to="/operation" className="mk-key" style={{ textDecoration: 'none', padding: '10px 12px', fontSize: 10 }}>{t('ПЕРЕЙТИ К ОПЕРАЦИИ')}</Link>
        <Link to="/" className="mk-key mk-key--paint" style={{ textDecoration: 'none', padding: '10px 12px', fontSize: 10 }}>{t('ОТКРЫТЬ НАСТОЯЩУЮ ИГРУ')}</Link>
      </div>
    </div>
  )
}
