import { lazy, Suspense, useState } from 'react'
import { useI18n } from '../../i18n'
import './farm-tab.css'

// Real on-chain fields stay exactly as they were; the wallet-free field lab is embedded beside them.
const MainScreen = lazy(() => import('../MainScreen'))
const DemoScreen = lazy(() => import('../DemoScreen'))

type FarmMode = 'fields' | 'lab'

/**
 * АГРО tab: two views of the same farm inside one phone column.
 * «ПОЛЯ» — the actual game (wallet, on-chain accounts, unchanged callbacks).
 * «ЛАБОРАТОРИЯ» — the local training field lab (no wallet, no transactions).
 */
export default function FarmTab(): JSX.Element {
  const { t } = useI18n()
  const [mode, setMode] = useState<FarmMode>('fields')
  return (
    <section className="farm-tab" data-mode={mode}>
      <div className="farm-switch" role="group" aria-label={t('Режим фермы')}>
        <button type="button" aria-pressed={mode === 'fields'} onClick={() => setMode('fields')}>
          {t('ПОЛЯ')}<small>{t('ИГРА · SOLANA')}</small>
        </button>
        <button type="button" aria-pressed={mode === 'lab'} onClick={() => setMode('lab')}>
          {t('ЛАБОРАТОРИЯ')}<small>{t('БЕЗ КОШЕЛЬКА')}</small>
        </button>
      </div>
      <Suspense fallback={<div style={{ padding: 20 }} aria-busy="true"><div className="mk-skel" style={{ height: 120 }} /></div>}>
        {mode === 'fields' ? <MainScreen /> : <DemoScreen embedded />}
      </Suspense>
    </section>
  )
}
