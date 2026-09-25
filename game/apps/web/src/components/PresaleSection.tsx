import { FIELD_TYPES, PRESALE_DROP } from '../utils/constants'
import { t } from '../i18n'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp  } from 'lucide-react'
import { useGame } from '../contexts/GameContext'
import { useSolana, PROGRAM_ID } from '../contexts/SolanaContext'
import { sounds } from '../utils/sounds'
import { haptics } from '../utils/haptic'
import { presaleStatePda } from '../utils/anchorClient'

const PRESALE_CAP = 500
const PRESALE_PRICE_SKR = 1053

/**
 * Карточка пресейла полей за SKR в стиле Vice Potato.
 * Использует PotatoCard rare="gold" + GlowIcon + AnimatedNumber + PotatoButton glow="none"
 */
export default function PresaleSection() {
 const { buyFieldPresale, purchasing } = useGame()
 const { connected, connection } = useSolana()
 const [sold, setSold] = useState(0)
 const [loading, setLoading] = useState(true)

 // Читаем PresaleState с on-chain
 useEffect(() => {
  if (!connection) return
  const pda = presaleStatePda(PROGRAM_ID)
  let cancelled = false

  async function load() {
   try {
    const info = await connection.getAccountInfo(pda)
    if (cancelled) return
    if (!info) {
     setLoading(false)
     return
    }
    // Layout: 8 (disc) + 32 (authority) + 4 (sold) + ...
    const soldU32 = info.data.readUInt32LE(8 + 32)
    setSold(soldU32)
    setLoading(false)
   } catch (err) {
    if (!cancelled) setLoading(false)
   }
  }

  load()
  const sub = connection.onAccountChange(pda, (info) => {
   const soldU32 = info.data.readUInt32LE(8 + 32)
   setSold(soldU32)
  })
  return () => {
   cancelled = true
   connection.removeAccountChangeListener(sub)
  }
 }, [connection])

 const remaining = PRESALE_CAP - sold
 const progressPct = Math.min(100, (sold / PRESALE_CAP) * 100)
 const soldOut = remaining <= 0
 const disabled = !connected || purchasing || soldOut || loading

 const [lastDrop, setLastDrop] = useState<number | null>(null)

 const handleBuy = async () => {
  sounds.buy()
  haptics.purchaseField()
  // Тир кидает сама программа (keccak(buyer ‖ sold ‖ slot)); результат
  // читаем из on-chain состояния созданного поля.
  const tier = await buyFieldPresale?.()
  if (tier !== null && tier !== undefined) setLastDrop(tier)
 }

 return (
  <motion.div
   initial={{ opacity: 0, y: 20 }}
   animate={{ opacity: 1, y: 0 }}
   transition={{ duration: 0.5 }}
   className="pf-card hull-skin ares-presale"
   style={{
    gridColumn: '1 / -1',
    padding: 24,
    marginBottom: 8,
   }}
  >

   {/* Бейдж "LIMITED" */}
   <div className="gradient-gold" style={{
    position: 'absolute',
    top: 16,
    right: 16,
    fontSize: 10,
    fontWeight: 800,
    padding: '4px 10px',
    borderRadius: 999,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
   }}>
     LIMITED
   </div>

   {/* Иконка + заголовок */}
   <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
    <div>
     <h2 className="pf-h2" style={{ fontSize: 22, margin: 0 }}>
      PRESALE
     </h2>
     <div className="pf-subtitle" style={{ fontSize: 12, margin: 0 }}>
      {t('Растение за SKR · Лимит 5 на кошелёк')}
     </div>
    </div>
   </div>

   {/* Кассеты трёх тиров */}
   <div style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '2px 0 14px' }} aria-hidden="true">
    {FIELD_TYPES.map((ft) => (
     <img key={ft.id} src={ft.image} alt="" loading="lazy" style={{ width: 76, height: 88, objectFit: 'contain', filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.5))' }} />
    ))}
   </div>

   {/* Счётчик оставшихся */}
   <div style={{
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
   }}>
    <div>
     <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
      {t('Осталось')}
     </div>
     <div className="pf-mono lcd-readout" style={{ fontSize: 32, fontWeight: 700, color: soldOut ? 'var(--pf-red)' : 'var(--ares-hud-amber, #FFB347)', fontVariantNumeric: 'tabular-nums' }}>
      {loading ? '—' : String(remaining).padStart(4, '0')}
      <span style={{ fontSize: 14, color: 'var(--pf-text-muted)', marginLeft: 6 }}>
       / {String(PRESALE_CAP).padStart(4, '0')}
      </span>
     </div>
    </div>
    <div style={{ textAlign: 'right' }}>
     <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
      {t('Цена')}
     </div>
     <div className="pf-mono lcd-readout" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ares-hud-amber, #FFB347)' }}>
      {String(PRESALE_PRICE_SKR).padStart(4, '0')} SKR
     </div>
    </div>
   </div>

   {/* Прогресс-бар */}
   <div style={{
    height: 6,
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 18,
   }}>
    <motion.div
     initial={{ width: 0 }}
     animate={{ width: `${progressPct}%` }}
     transition={{ duration: 0.8, ease: 'easeOut' }}
     style={{
      height: '100%',
      background: progressPct > 80 ? 'var(--pf-red)' : 'var(--ares-action)',
      boxShadow: progressPct > 80 ? '0 0 12px var(--pf-red)' : '0 0 12px var(--pf-orange)',
     }}
    />
   </div>

   {/* Кнопка покупки */}
   <motion.button
    whileTap={disabled ? {} : { scale: 0.96 }}
    whileHover={disabled ? {} : { scale: 1.02 }}
    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
    disabled={disabled}
    onClick={() => handleBuy()}
    style={{
     width: '100%',
     padding: '14px 22px',
     borderRadius: 14,
     border: '1px solid rgba(255,255,255,0.25)',
     background: soldOut
      ? 'rgba(255,255,255,0.05)'
      : 'var(--ares-btn-bg)',
     color: soldOut ? 'var(--pf-text-muted)' : '#FFFFFF',
     fontSize: 15,
     fontWeight: 800,
     textTransform: 'uppercase',
     letterSpacing: '0.05em',
     cursor: disabled ? 'not-allowed' : 'pointer',
     opacity: disabled && !soldOut ? 0.6 : 1,
     boxShadow: soldOut ? 'none' : '0 0 16px rgba(184, 92, 255, 0.45)',
     display: 'flex',
     alignItems: 'center',
     justifyContent: 'center',
     gap: 8,
     fontFamily: 'var(--pf-font-ui)',
    }}
   >
    {soldOut ? (
     t('РАСПРОДАНО')
    ) : loading ? (
     t('Загрузка…')
    ) : !connected ? (
     t('Подключи кошелёк')
    ) : (
     <>
      <TrendingUp size={18} />
       {t('Купить растения за {price} SKR', { price: PRESALE_PRICE_SKR })}
     </>
    )}
   </motion.button>

   {/* Подсказка */}
   {!soldOut && connected && (
    <div style={{
     fontSize: 11,
     color: 'var(--pf-text-muted)',
     textAlign: 'center',
     margin: '12px 0 0 0',
    }}>
     <div className="ares-mono" style={{ marginTop: 10, textAlign: 'center', fontSize: 9, color: 'rgba(255,179,71,0.55)', letterSpacing: '0.14em' }}>
      {t('ШАНСЫ ДРОПА МОДУЛЯ')}
     </div>
     <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 8, marginBottom: 8, flexWrap: 'wrap' }}>
      {PRESALE_DROP.map(d => (
       <span key={d.type} className="ares-mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: d.color }}>
        {d.label} · {d.chance}%
       </span>
      ))}
     </div>
     {lastDrop !== null && (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 4 }}>
       <motion.img
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        src={FIELD_TYPES[lastDrop].image}
        alt={PRESALE_DROP[lastDrop].label}
        style={{ width: 88, height: 100, objectFit: 'contain', filter: `drop-shadow(0 0 18px ${PRESALE_DROP[lastDrop].color}88)` }}
       />
       <div className="ares-mono" style={{ textAlign: 'center', fontSize: 11, color: PRESALE_DROP[lastDrop].color, letterSpacing: '0.1em' }}>
        {t('ВЫПАЛО: {label}', { label: PRESALE_DROP[lastDrop].label })}
       </div>
      </div>
     )}
     {t('80% SKR → казна · 20% → казна команды')}
    </div>
   )}
  </motion.div>
 )
}
