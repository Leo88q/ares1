import { useState } from 'react'
import { ArrowLeft, Droplets, Leaf, RotateCcw, Sprout } from 'lucide-react'
import { useI18n } from '../i18n'
import { Tuber9 } from './ares/mascot'
import FieldsPanel from '../fields/FieldsPanel'
import { fieldCopy } from '../fields/copy'
import { FIELD_PROFILES } from '../fields/model'
import type { FieldVisual } from '../fields/model'
import { AresBottomNav } from './ares/AresBottomNav'
import type { AresTab } from './ares/AresBottomNav'
import SectionArtPreview from './ares/SectionArtPreview'
import '../ui/hull-ui.css'

export default function DemoScreen(): JSX.Element {
  const { t, lang, setLang } = useI18n()
  const c = fieldCopy(lang)
  const [artSection, setArtSection] = useState<AresTab>(() => {
    const section = new URLSearchParams(window.location.search).get('section')
    return section === 'market' || section === 'stats' || section === 'profile' ? section : 'main'
  })
  // A planted example makes the new art visible immediately. Reset starts the
  // original plant -> water -> harvest lesson. These are NOT on-chain accounts.
  const [planted, setPlanted] = useState(true)
  const [water, setWater] = useState(2)
  const [harvested, setHarvested] = useState(0)
  const [selectedTier, setSelectedTier] = useState<0 | 1 | 2>(0)
  const [worn, setWorn] = useState(false)

  const plant = (): void => { setPlanted(true); setWater(0); setHarvested(0) }
  const waterCrop = (): void => { if (planted) setWater(value => Math.min(3, value + 1)) }
  const harvestCrop = (): void => {
    if (planted && water >= 2) { setHarvested(value => value + 1); setWater(0) }
  }
  const reset = (): void => { setPlanted(false); setWater(0); setHarvested(0); setWorn(false) }
  const fields: FieldVisual[] = ([0, 1, 2] as const).map(tier => ({
    id: `demo-${tier}`, tier, level: [1, 8, 23][tier], condition: worn ? 0.38 : 1,
    active: planted, ready: planted && water >= 2, fertilized: planted && water >= 3,
    taxExpired: false, mutation: 0, growth: !planted ? 0 : water >= 2 ? 1 : 0.4,
    pendingMicro: 0,
  }))
  const lesson = (
      <div className="po-plate po-plate--market mf-demo-lesson" style={{ padding: 16, position: 'relative', overflow: 'hidden' }}>
        <span className="po-hazard-corner" aria-hidden="true" />
        <div className="mf-eyebrow" style={{ marginBottom: 12 }}>{t('ПОПРОБУЙ ПЕРВУЮ ТЕПЛИЦУ')}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 15 }}>
          <div>
            <div className="ares-mono" style={{ color: '#C9A176', fontSize: 9 }}>{t('УЧЕБНЫЙ МОДУЛЬ')}</div>
            <h2 className="ares-stencil" style={{ color: '#F6F1ED', fontSize: 17, margin: '4px 0 0' }}>{selectedTier === 0 ? t('КАССЕТА № 01 · COMMON') : `${FIELD_PROFILES[selectedTier].name} · ${c.lesson}`}</h2>
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
  )

  return <div className="mf-demo-shell"><div className="mf-demo">
    <nav className="mf-demo-nav">
      <div className="mf-demo-brand">ARES—1 / FIELD LAB</div>
      <div className="mf-demo-lang" aria-label={c.language}>
        <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>RU</button>
        <button type="button" aria-pressed={lang !== 'ru'} onClick={() => setLang('en')}>EN</button>
      </div>
      <a href="/" style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}><ArrowLeft size={14} />{t('НАЗАД В КОЛОНИЮ')}</a>
    </nav>
    <div className="mf-demo-view" hidden={artSection !== 'main'}>
    <header className="mf-demo-hero">
      <img className="mf-hero-panorama" src="/ares/plantation.webp" alt="" aria-hidden="true" />
      <div className="mf-hero-copy">
        <span className="mf-eyebrow">{t('ОБУЧАЮЩИЙ СИМУЛЯТОР · БЕЗ КОШЕЛЬКА')}</span>
        <h1>{c.demoTitle}</h1>
        <p>{c.demoLead}</p>
      </div>
      <img className="mf-hero-mascot" src="/ares/tuber9-happy.webp" alt="" aria-hidden="true" />
      <p className="mf-hero-disclaimer">{t('Это локальная демо-сцена: кнопки меняют только состояние в браузере. Здесь нет токенов, транзакций, кошелька или сохранения прогресса.')}</p>
    </header>
    <div className="mf-eyebrow">{c.example}</div>
    <FieldsPanel fields={fields} language={lang} demo initialLayer="engineering"
      onSelection={selected => setSelectedTier(selected.tier)}
      renderInspector={() => <>{lesson}<button type="button" className="mf-button" style={{ marginTop: 10 }} aria-pressed={worn} onClick={() => setWorn(value => !value)}>{worn ? c.restored : c.wear}</button></>}
    />
    </div>
    {artSection !== 'main' && artSection !== 'operation' && <SectionArtPreview section={artSection === 'market' ? 'supply' : artSection === 'stats' ? 'journal' : 'cabin'} />}
    <div className="mf-demo-actions">
      <a href="/" className="mf-button">{t('ОТКРЫТЬ НАСТОЯЩУЮ ИГРУ')} →</a>
      <a href="/market" className="mf-button">{c.market} →</a>
      <a href="/operation" className="mf-button">{t('ПЕРЕЙТИ К ОПЕРАЦИИ')} →</a>
    </div>
    <details className="mf-demo-archive"><summary>{c.archive}</summary><a href="/colony">{t('Открыть 3D-колонию')} →</a></details>
    <AresBottomNav active={artSection} onChange={tab => { if (tab === 'operation') window.location.assign('/operation'); else setArtSection(tab) }} />
  </div></div>
}
