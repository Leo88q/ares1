import { motion } from 'framer-motion'
import { useI18n, t } from '../i18n'

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
   <div className="main-screen-container">
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
  <div className="po-plate po-plate--comm" style={{ padding: '36px 20px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
   <span className="po-hazard-corner" aria-hidden="true" />
   <span className="po-screw po-screw--tl" aria-hidden="true" />
   <span className="po-screw po-screw--tr" aria-hidden="true" />
   <span className="po-screw po-screw--bl" aria-hidden="true" />
   <span className="po-screw po-screw--br" aria-hidden="true" />
   <div
    style={{
     width: 100,
     height: 100,
     borderRadius: '50%',
     background: 'radial-gradient(circle, rgba(232, 160, 60, 0.14) 0%, transparent 70%)',
     display: 'flex',
     alignItems: 'center',
     justifyContent: 'center',
     margin: '0 auto 16px',
    }}
   >
     <Tuber9 mood="sleep" size={90} />
    </div>
    <div
     style={{
      fontFamily: 'var(--ares-font-stencil)',
      fontSize: 11,
      letterSpacing: '0.2em',
      color: '#D4A576',
      marginBottom: 8,
      textTransform: 'uppercase',
     }}
    >
     {t("ТЕРМИНАЛ ЭКИПАЖА // ОЖИДАНИЕ АВТОРИЗАЦИИ")}
    </div>
    <h2
     style={{
      fontSize: 21,
      marginBottom: 10,
      fontFamily: 'var(--ares-font-stencil)',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#F6F1ED',
     }}
    >
     {t("Подключи кошелёк")}
    </h2>
    <p
     style={{
      color: 'var(--ares-dust, #E0A183)',
      fontSize: 13,
      maxWidth: 380,
      margin: '0 auto 20px',
      lineHeight: 1.5,
     }}
    >
     {t("Делянки и биомасса хранятся on-chain на Solana. Авторизуй бортовой интерфейс для доступа к гидропонике.")}
    </p>

    <motion.button
     whileTap={{ scale: 0.96 }}
     onClick={handleConnect}
     disabled={connecting}
     className="mk-key mk-key--paint"
     style={{
      padding: '12px 26px',
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

    <div
     style={{
      display: 'flex',
      justifyContent: 'center',
      gap: 16,
      marginTop: 22,
      fontSize: 10,
      color: 'rgba(255, 179, 71, 0.55)',
      letterSpacing: '0.08em',
     }}
     className="ares-mono"
    >
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
 { label: 'TIER I · ОБЫЧНАЯ КАССЕТА', tag: 'COMMON', borderColor: '#4D331D', accentColor: '#C9A176' },
 { label: 'TIER II · ФИТО-РЕАКТОР', tag: 'RARE', borderColor: '#6E4522', accentColor: '#ED8A45' },
 { label: 'TIER III · БИО-КАССЕТА', tag: 'EPIC', borderColor: '#8A5826', accentColor: '#FFC94A' },
]

function BuyFieldCard({ onPurchase, purchasing, balanceMicro, firstField }: BuyProps) {
 const { t } = useI18n()
 return (
  <motion.div
   initial={{ opacity: 0, y: 20 }}
   animate={{ opacity: 1, y: 0 }}
   className="po-plate po-plate--incubator"
   style={{
    padding: '20px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    position: 'relative',
    overflow: 'hidden',
    marginTop: 8,
   }}
  >
   <div className="po-hazard" style={{ height: 5 }} aria-hidden="true" />
   <span className="po-screw po-screw--tl" aria-hidden="true" />
   <span className="po-screw po-screw--tr" aria-hidden="true" />
   <span className="po-screw po-screw--bl" aria-hidden="true" />
   <span className="po-screw po-screw--br" aria-hidden="true" />
   <span className="po-patch" style={{ right: 8, bottom: 8, width: 44, height: 16 }} aria-hidden="true" />

   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <div>
     <div
      style={{
       fontFamily: 'var(--ares-font-stencil)',
       fontSize: 11,
       fontWeight: 600,
       letterSpacing: '0.2em',
       color: '#D4A576',
       textTransform: 'uppercase',
      }}
     >
      {t("ИНКУБАТОР АГРО-ОТСЕКА")}
     </div>
     <div style={{ fontSize: 12, color: 'var(--ares-dust, #E0A183)', marginTop: 2 }}>
      {firstField ? t('Заложи первую делянку марсианского пайка') : t('Развёртывание дополнительного гидропонного контура')}
     </div>
    </div>
    <span className="po-lamp po-lamp--green" aria-hidden="true" />
   </div>

   <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
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
        background: 'linear-gradient(180deg, rgba(34,22,14,0.8) 0%, rgba(18,12,8,0.9) 100%)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: 'inset 0 1px 0 rgba(255,214,170,0.06), 0 3px 8px rgba(0,0,0,0.3)',
       }}
      >
       <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img
         src={type.image}
         alt={meta.tag}
         width={40}
         height={44}
         loading="lazy"
         style={{ width: 40, height: 44, objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.6))' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--ares-font-stencil)', fontSize: 12, letterSpacing: '0.12em', color: meta.accentColor }}>
           {t(meta.label)}
          </span>
          <span className="ares-mono" style={{ fontSize: 9, color: '#C9A176', background: 'rgba(0,0,0,0.35)', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)' }}>
           ×{yieldMul} {t('КПД')}
          </span>
         </div>
         <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 10, color: 'var(--pf-text-secondary)' }} className="ares-mono">
          <span>{t('СБОР: ~{n} POTATO / СОЛ', { n: ((type.yieldBps / 10_000) * 100).toFixed(0) })}</span>
          <span>{t('РЕСУРС: 100%')}</span>
         </div>
        </div>
       </div>

       <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
        <div className="ares-mono" style={{ fontSize: 12, fontWeight: 700, color: affordable ? '#EFD9AC' : 'rgba(255,179,71,0.5)' }}>
         {fmtPotato(price, 0)} <span style={{ fontSize: 9, opacity: 0.8 }}>POTATO</span>
        </div>

        <motion.button
         whileTap={purchasing || !affordable ? undefined : { y: 2 }}
         transition={{ type: 'spring', stiffness: 520, damping: 26 }}
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
          fontSize: 11,
          fontWeight: 800,
          cursor: affordable ? 'pointer' : 'not-allowed',
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
