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
     <span className="po-lamp" style={{ width: 18, height: 18, marginBottom: 22 }} aria-hidden="true" />
     <h2 style={{ fontSize: 20, marginBottom: 12 }}>{t("Нет связи с блокчейном")}</h2>
     <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14 }}>{error}</p>
     <p style={{ color: 'var(--pf-text-muted)', fontSize: 12, marginTop: 8 }}>{t("Повторяем автоматически…")}</p>
    </>
   ) : (
    <>
     <span className="po-lamp po-lamp--off" style={{ width: 18, height: 18, marginBottom: 22 }} aria-hidden="true" />
     <h2 style={{ fontSize: 20, marginBottom: 12 }}>{t("Инициализация игры…")}</h2>
     <p style={{ color: 'var(--pf-text-secondary)', fontSize: 14 }}>{t("Подключаемся к блокчейну")}</p>
    </>
   )}
  </div>
 )
}

import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { Wallet } from 'lucide-react'

function ConnectHint() {
 const { setVisible } = useWalletModal()
 const { wallet, connect, connecting } = useWallet()

 const handleConnect = () => {
  if (wallet && !connecting) {
   void connect().catch((e: unknown) => console.error('[wallet] direct connect failed:', e))
   return
  }
  setVisible(true)
 }

 return (
  <div style={{ gridColumn: '1 / -1' }}>
   <div className="po-card" style={{ padding: '32px 24px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
    <div className="po-hazard" aria-hidden="true" />
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, marginTop: 8 }}>
     <Tuber9 mood="sleep" size={96} />
    </div>
    <div className="po-spray" style={{ fontFamily: 'var(--ares-font-stencil)', fontSize: 11, letterSpacing: '0.22em', color: '#D4A576', marginBottom: 8 }}>
     {t("ТЕРМИНАЛ ЭКИПАЖА // ОЖИДАНИЕ АВТОРИЗАЦИИ")}
    </div>
    <h2 style={{ fontSize: 21, marginBottom: 10, fontFamily: 'var(--ares-font-stencil)', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#F6F1ED' }}>
     {t("Подключи кошелёк")}
    </h2>
    <p style={{ color: 'var(--ares-dust, #E0A183)', fontSize: 13, maxWidth: 380, margin: '0 auto 20px', lineHeight: 1.5 }}>
     {t("Делянки и биомасса хранятся on-chain на Solana. Авторизуй бортовой интерфейс для доступа к гидропонике.")}
    </p>

    <motion.button
     whileTap={{ scale: 0.96 }}
     onClick={handleConnect}
     disabled={connecting}
     className="mk-key mk-key--paint"
     style={{
      padding: '13px 28px',
      fontSize: 13,
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      cursor: 'pointer',
      margin: '0 auto',
     }}
    >
     <Wallet size={16} aria-hidden="true" />
     {connecting ? t('Авторизация…') : t('Подключить кошелёк')}
    </motion.button>

    <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 22, fontSize: 10, color: 'var(--pf-text-muted)', letterSpacing: '0.08em' }} className="ares-mono">
     <span>• SOLANA DEVNET</span>
     <span>• PHANTOM / SOLFLARE</span>
     <span>• ZERO-KNOWLEDGE</span>
    </div>
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

const TIER_META = [
 { label: 'TIER I · ОБЫЧНАЯ КАССЕТА', tag: 'COMMON', borderColor: '#5C4028', accentColor: '#C9A176' },
 { label: 'TIER II · ФИТО-РЕАКТОР', tag: 'RARE', borderColor: '#7E4C24', accentColor: '#ED8A45' },
 { label: 'TIER III · БИО-КАССЕТА', tag: 'EPIC', borderColor: '#96632B', accentColor: '#FFC94A' },
]

function BuyFieldCard({ onPurchase, purchasing, balanceMicro, firstField }: BuyProps) {
 return (
  <motion.div
   initial={{ opacity: 0, y: 20 }}
   animate={{ opacity: 1, y: 0 }}
   className="po-card"
   style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', overflow: 'hidden' }}
  >
   <div className="po-hazard" aria-hidden="true" />
   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
    <div>
     <div className="po-spray" style={{ fontFamily: 'var(--ares-font-stencil)', fontSize: 11, fontWeight: 600, letterSpacing: '0.2em', color: '#D4A576', textTransform: 'uppercase' }}>
      {t("ИНКУБАТОР АГРО-ОТСЕКА")}
     </div>
     <div style={{ fontSize: 12, color: 'var(--ares-dust, #E0A183)', marginTop: 2 }}>
      {firstField ? t('Заложи первую делянку марсианского пайка') : t('Развёртывание дополнительного гидропонного контура')}
     </div>
    </div>
    <span className="po-lamp po-lamp--green" aria-hidden="true" />
   </div>

   <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
    {FIELD_TYPES.map((type) => {
     const meta = TIER_META[type.id] ?? TIER_META[0]
     const price = fieldPriceMicro(type.id)
     const affordable = balanceMicro >= price
     const yieldMul = (type.yieldBps / 10_000).toFixed(2)

     return (
      <div
       key={type.id}
       style={{
        borderRadius: 8,
        border: `1px solid ${meta.borderColor}`,
        background: 'linear-gradient(170deg, rgba(38,26,17,0.7) 0%, rgba(22,14,9,0.85) 100%)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxShadow: 'inset 0 1px 0 rgba(255,214,170,0.08), 0 4px 12px rgba(0,0,0,0.4)',
       }}
      >
       <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <img
         src={type.image}
         alt={meta.tag}
         width={44}
         height={48}
         loading="lazy"
         style={{ width: 44, height: 48, objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--ares-font-stencil)', fontSize: 13, letterSpacing: '0.12em', color: meta.accentColor }}>
           {meta.label}
          </span>
          <span className="ares-mono" style={{ fontSize: 10, color: '#A8895C', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>
           ×{yieldMul} КПД
          </span>
         </div>
         <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 11, color: 'var(--pf-text-secondary)' }} className="ares-mono">
          <span>СБОР: ~{(type.baseYieldPerDayMicro / 1_000_000).toFixed(0)} 🥔 / СОЛ</span>
          <span>РЕСУРС: 100%</span>
         </div>
        </div>
       </div>

       <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
        <div className="ares-mono" style={{ fontSize: 13, fontWeight: 700, color: affordable ? '#EFD9AC' : 'var(--pf-text-muted)' }}>
         {fmtPotato(price, 0)} <span style={{ fontSize: 10, opacity: 0.8 }}>POTATO</span>
        </div>

        <motion.button
         whileTap={{ scale: 0.95 }}
         disabled={purchasing || !affordable}
         aria-label={t('Купить {name} за {price} POTATO', { name: type.name, price: fmtPotato(price, 0) })}
         onClick={() => {
          sounds.buy()
          haptics.purchaseField()
          void onPurchase(type.id)
         }}
         className={affordable ? 'mk-key mk-key--paint' : 'mk-key'}
         style={{
          padding: '8px 18px',
          fontSize: 12,
          fontWeight: 700,
          cursor: affordable ? 'pointer' : 'not-allowed',
          opacity: affordable ? 1 : 0.45,
         }}
        >
         {purchasing ? t('Монтаж…') : affordable ? t('Развернуть') : t('Нехватка пайка')}
        </motion.button>
       </div>
      </div>
     )
    })}
   </div>

   {firstField && (
    <div style={{ fontSize: 11, color: 'var(--ares-dust, #E0A183)', textAlign: 'center', lineHeight: 1.4, background: 'rgba(0,0,0,0.25)', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
     {t('Стартовый паёк выдаётся в «Каюте» (задачи смены) или доступен на бирже Снабжения за SKR.')}
    </div>
   )}
  </motion.div>
 )
}
