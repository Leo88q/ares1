import { motion } from 'framer-motion'
import { t } from '../i18n'

import { MiniHydroModules } from '../ui/MiniHydroModules'
import { useGame } from '../contexts/GameContext'
import { useSolana } from '../contexts/SolanaContext'
import FieldCardVice from './FieldCardVice'
import PresaleSection from './PresaleSection'
import Header from './Header'
import { FIELD_TYPES, fieldPriceMicro, fmtPotato, HARVEST_THRESHOLD_MICRO } from '../utils/constants'
import { sounds } from '../utils/sounds'
import { haptics } from '../utils/haptic'
import { AgroBay } from './ares/AgroBay'
import { FieldGestureLayer } from './ares/FieldGestureLayer'
import { ErrorState } from '../ui/states'
import { Tuber9 } from './ares/mascot'

export default function MainScreen() {
 const { fields, stats, loading, fieldsError, reload, purchasing, harvest, purchaseField, upgradeField, repairField, payTax, applyFertilizer } = useGame()
 const { ready, rpcError, connected } = useSolana()

 return (
  <AgroBay>
   <div style={{ padding: 20, paddingBottom: 140, position: 'relative' }}>
    <div style={{ position: 'relative' }}>
     <Header stats={stats} />
    </div>
            <PresaleSection />
        <BuyFieldCard
         onPurchase={purchaseField}
         purchasing={purchasing}
         balanceMicro={stats.potatoBalance}
         firstField={fields.length === 0}
        />
<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
     <div
      data-tutorial="fields"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 16, marginTop: 20, alignItems: 'start' }}
     >
      {!ready ? (
       <InitStatus error={rpcError} />
      ) : !connected ? (
       <ConnectHint />
      ) : !loading && fieldsError && fields.length === 0 ? (
       <div style={{ gridColumn: '1 / -1' }}>
        <ErrorState message={fieldsError} onRetry={() => void reload()} />
       </div>
      ) : loading && fields.length === 0 ? (
       Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="mk-skel" style={{ height: 320 }} aria-hidden="true" />
       ))
      ) : (
       <>
        {fieldsError && fields.length > 0 && (
         <div style={{ gridColumn: '1 / -1' }}>
          <ErrorState inline message={fieldsError} onRetry={() => void reload()} />
         </div>
        )}
        {fields.map((field, i) => (
         <FieldGestureLayer
          key={field.publicKey.toString()}
          canHarvest={field.accumulated >= HARVEST_THRESHOLD_MICRO}
          onHarvest={() => harvest(field.publicKey)}
          scanData={[
           { label: 'LVL', value: String(field.level) },
           { label: 'DUR', value: `${field.durability}%` },
          ]}
         >
          <FieldCardVice
           field={field}
           index={i}
           onHarvest={harvest}
           onUpgrade={upgradeField}
           onRepair={repairField}
           onPayTax={payTax}
           onApplyFertilizer={applyFertilizer}
          />
         </FieldGestureLayer>
        ))}

       </>
      )}
     </div>
    </motion.div>
   </div>
  </AgroBay>
 )
}

function InitStatus({ error }: { error: string | null }) {
 return (
  <div role="status" style={{ gridColumn: '1 / -1', padding: '60px 20px', textAlign: 'center' }}>
   {error ? (
    <>
     <span className="mk-lamp mk-lamp--blink" style={{ width: 18, height: 18, marginBottom: 22 }} aria-hidden="true" />
     <h2 style={{ fontSize: 20, marginBottom: 12 }}>{t("Нет связи с блокчейном")}</h2>
     <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14 }}>{error}</p>
     <p style={{ color: 'var(--pf-text-muted)', fontSize: 12, marginTop: 8 }}>{t("Повторяем автоматически…")}</p>
    </>
   ) : (
    <>
     <span className="mk-lamp" style={{ width: 18, height: 18, marginBottom: 22 }} aria-hidden="true" />
     <h2 style={{ fontSize: 20, marginBottom: 12 }}>{t("Инициализация игры…")}</h2>
     <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14 }}>{t("Подключаемся к блокчейну")}</p>
    </>
   )}
  </div>
 )
}

function ConnectHint() {
 return (
  <div style={{ gridColumn: '1 / -1' }}>
   <div className="mk-plate mk-plate--quiet" style={{ padding: '36px 24px', textAlign: 'center' }}>
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
     <Tuber9 mood="sleep" size={96} />
    </div>
    <h2 style={{ fontSize: 19, marginBottom: 8, fontFamily: 'var(--ares-font-stencil)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{t("Подключи кошелёк")}</h2>
    <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14 }}>{t("Поля хранятся on-chain — чтобы увидеть ферму, нажми «Подключить кошелёк» сверху.")}</p>
   </div>
  </div>
 )
}

interface BuyProps {
 onPurchase: (type: number) => Promise<boolean>
 purchasing: boolean
 balanceMicro: number
 firstField: boolean
}

const RARE_LABELS = ['COMMON', 'RARE', 'EPIC']

function BuyFieldCard({ onPurchase, purchasing, balanceMicro, firstField }: BuyProps) {
 const styles = [
  { background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(138, 74, 34, 0.6)', color: 'var(--ares-dust, #E0A183)' },
  { background: 'linear-gradient(180deg, #7E2E56, #571F3C)', color: '#F2D3E4', borderColor: 'rgba(0,0,0,0.5)' },
  { background: 'linear-gradient(180deg, #E8B45A, #B97F24)', color: '#2A1A06', borderColor: 'rgba(0,0,0,0.45)' },
 ]
 return (
  <motion.div
   initial={{ opacity: 0, y: 20 }}
   animate={{ opacity: 1, y: 0 }}
   className="mk-plate"
   style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}
  >
   <div className="mk-tag" style={{ fontSize: 12, marginBottom: 12 }}>{t("КУПИ РАСТЕНИЕ")}</div>
   <MiniHydroModules />
   <p style={{ fontSize: 14, color: 'var(--pf-text-secondary)', marginBottom: 4, textAlign: 'center' }}>
    {firstField ? t('Заложи первую делянку') : t('Заложи новую жизнь')}
   </p>
   {firstField && (
    <p style={{ fontSize: 11, color: 'var(--pf-text-muted)', marginBottom: 12, textAlign: 'center' }}>
     {t('Стартовый паёк — в «Каюте» (задачи смены) или на бирже за SKR.')}
    </p>
   )}
   <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
    {FIELD_TYPES.map((type) => {
     const price = fieldPriceMicro(type.id)
     const affordable = balanceMicro >= price
     return (
      <motion.button
       key={type.id}
       whileTap={{ scale: 0.95 }}
       disabled={purchasing || !affordable}
       aria-label={t('Купить {name} за {price} POTATO', { name: type.name, price: fmtPotato(price, 0) })}
       onClick={() => {
        sounds.buy()
        haptics.purchaseField()
        void onPurchase(type.id)
       }}
       style={{ padding: 10, borderRadius: 10, fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', ...styles[type.id] }}
      >
       <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src={type.image} alt={RARE_LABELS[type.id]} width={26} height={30} loading="lazy" style={{ width: 26, height: 30, objectFit: 'contain' }} />
        <span><span className="ares-mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em' }}>{RARE_LABELS[type.id]}</span> <span className="ares-mono" style={{ fontSize: 10, opacity: 0.75 }}>(×{(type.yieldBps / 10_000).toFixed(2)})</span></span>
       </span>
       <span>{fmtPotato(price, 0)} POTATO</span>
      </motion.button>
     )
    })}
   </div>
  </motion.div>
 )
}
