import { motion } from 'framer-motion'
import { t } from '../i18n'

import { MiniHydroModules } from '../ui/MiniHydroModules'
import { Loader2, WifiOff } from 'lucide-react'
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

export default function MainScreen() {
 const { fields, stats, loading, purchasing, harvest, purchaseField, upgradeField, repairField, payTax, applyFertilizer } = useGame()
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
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginTop: 20, alignItems: 'start' }}
     >
      {!ready ? (
       <InitStatus error={rpcError} />
      ) : !connected ? (
       <ConnectHint />
      ) : loading && fields.length === 0 ? (
       Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="pf-card hull-skin shimmer" style={{ height: 320, borderRadius: 20 }} aria-hidden="true" />
       ))
      ) : (
       <>
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
     <WifiOff size={48} color="var(--pf-red)" style={{ marginBottom: 20 }} />
     <h2 style={{ fontSize: 20, marginBottom: 12 }}>{t("Нет связи с блокчейном")}</h2>
     <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14 }}>{error}</p>
     <p style={{ color: 'var(--pf-text-muted)', fontSize: 12, marginTop: 8 }}>{t("Повторяем автоматически…")}</p>
    </>
   ) : (
    <>
     <Loader2 size={48} color="var(--pf-teal)" style={{ marginBottom: 20, animation: 'spin 1s linear infinite' }} />
     <h2 style={{ fontSize: 20, marginBottom: 12 }}>{t("Инициализация игры…")}</h2>
     <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14 }}>{t("Подключаемся к блокчейну")}</p>
    </>
   )}
  </div>
 )
}

function ConnectHint() {
 return (
  <div style={{ gridColumn: '1 / -1', padding: '40px 20px', textAlign: 'center' }}>
   <div style={{ fontSize: 56, marginBottom: 12 }}>POTATO</div>
   <h2 style={{ fontSize: 20, marginBottom: 8 }}>{t("Подключи кошелёк")}</h2>
   <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14 }}>{t("Поля хранятся on-chain — чтобы увидеть ферму, нажми «Подключить кошелёк» сверху.")}</p>
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
  { background: 'rgba(193, 68, 14, 0.12)', border: '1px solid rgba(160, 82, 40, 0.65)', color: 'var(--pf-teal)' },
  { background: 'var(--ares-btn-bg)', color: 'var(--ares-btn-text)', boxShadow: '0 0 14px rgba(184,92,255,0.45)' },
  { background: 'linear-gradient(135deg, var(--pf-gold) 0%, var(--pf-orange) 100%)', color: 'white' },
 ]
 return (
  <motion.div
   initial={{ opacity: 0, y: 20 }}
   animate={{ opacity: 1, y: 0 }}
   className="pf-card hull-skin"
   style={{ padding: 20, borderRadius: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, border: '1px dashed rgba(160, 82, 40, 0.7)', boxShadow: '0 0 0 1px rgba(0,0,0,0.45), 0 0 26px -6px rgba(193,68,14,0.6), 0 0 60px -20px rgba(255,179,71,0.35), inset 0 0 18px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,214,170,0.08)' }}
  >
   <div className="ares-stencil" style={{ fontSize: 13, color: 'var(--ares-hud-amber, #FFB347)', marginBottom: 10, textShadow: '0 0 10px rgba(255,179,71,0.4)' }}>{t("КУПИ РАСТЕНИЕ")}</div>
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
       <span><span className="ares-mono" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em' }}>{RARE_LABELS[type.id]}</span> <span className="ares-mono" style={{ fontSize: 10, opacity: 0.75 }}>(×{(type.yieldBps / 10_000).toFixed(2)})</span></span>
       <span>{fmtPotato(price, 0)} POTATO</span>
      </motion.button>
     )
    })}
   </div>
  </motion.div>
 )
}
