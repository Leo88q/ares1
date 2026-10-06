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
import { decodePresaleState } from '../utils/presaleState'
import CaseReveal from './CaseReveal'

// Фолбэк только на время загрузки: истинный cap читается из on-chain
// PresaleState (его задаёт оператор при init_presale, а не эта константа).
const PRESALE_CAP_FALLBACK = 500
const PRESALE_PRICE_SKR = 1053

/**
 * Карточка пресейла полей за SKR в стиле Vice Potato.
 * Использует PotatoCard rare="gold" + GlowIcon + AnimatedNumber + PotatoButton glow="none"
 */
export default function PresaleSection() {
 const { buyFieldPresale, purchasing } = useGame()
 const { connected, connection } = useSolana()
 const [sold, setSold] = useState(0)
 const [cap, setCap] = useState(PRESALE_CAP_FALLBACK)
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
    // Layout: 8 (disc) + 32 (authority) + 4 (sold) + 4 (cap) + 8 (price) + 1 (bump)
    const state = decodePresaleState(info.data)
    if (state) {
     setSold(state.sold)
     if (state.cap > 0) setCap(state.cap)
    }
    setLoading(false)
   } catch (err) {
    if (!cancelled) setLoading(false)
   }
  }

  load()
  const sub = connection.onAccountChange(pda, (info) => {
   const state = decodePresaleState(info.data)
   if (!state) return
   setSold(state.sold)
   if (state.cap > 0) setCap(state.cap)
  })
  return () => {
   cancelled = true
   connection.removeAccountChangeListener(sub)
  }
 }, [connection])

 const remaining = Math.max(0, cap - sold)
 const progressPct = cap > 0 ? Math.min(100, (sold / cap) * 100) : 0
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
   className="po-plate po-plate--presale ares-presale"
   style={{
    gridColumn: '1 / -1',
    padding: '24px 20px 20px',
    marginBottom: 12,
    position: 'relative',
    overflow: 'hidden',
   }}
  >
   {/* Hazard-лента по верхнему срезу плиты пресейла */}
   <div className="po-hazard" aria-hidden="true" />
   <span className="po-screw po-screw--tl" aria-hidden="true" />
   <span className="po-screw po-screw--tr" aria-hidden="true" />
   <span className="po-screw po-screw--bl" aria-hidden="true" />
   <span className="po-screw po-screw--br" aria-hidden="true" />
   <span className="po-chip po-chip--tl" aria-hidden="true" />

   {/* Тиснёный латунный бейдж "LIMITED" */}
   <div className="po-badge-brass" style={{
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 3,
   }}>
     LIMITED · 5 MAX
   </div>

   {/* Иконка + заголовок в стиле трафарета */}
   <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
    <div>
     <h2 className="pf-h2 po-spray" style={{ fontSize: 24, margin: 0, letterSpacing: '0.15em', color: '#EFD9AC' }}>
      PRESALE
     </h2>
     <div className="pf-subtitle" style={{ fontSize: 11, margin: 0, color: '#B3946A' }}>
      {t('Растение за SKR · Лимит 5 на кошелёк')}
     </div>
    </div>
   </div>

   {/* Внутренняя клёпаная рама с кассетами трёх тиров */}
   <div className="po-rim" style={{ padding: '8px 12px 12px', margin: '6px 0 14px', borderRadius: 2 }} aria-hidden="true">
    <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
     {FIELD_TYPES.map((ft) => (
      <img key={ft.id} src={ft.image} alt="" loading="lazy" style={{ width: 72, height: 84, objectFit: 'contain', filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.6))' }} />
     ))}
    </div>
   </div>

   {/* Счётчики в тактильных LCD-окошках */}
   <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
   }}>
    <div style={{ flex: 1, minWidth: 140 }}>
     <div className="po-spray" style={{ fontSize: 9, fontFamily: 'var(--ares-font-stencil)', color: '#A8895C', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>
      {t('Осталось')}
     </div>
     <div className="po-lcd" style={{ display: 'block', padding: '6px 12px', fontSize: 24, fontWeight: 700, color: soldOut ? 'var(--pf-red)' : '#F5BE72', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
      {loading ? '—' : String(remaining).padStart(4, '0')}
      <span style={{ fontSize: 12, color: 'rgba(255,214,170,0.5)', marginLeft: 6 }}>
       / {String(cap).padStart(4, '0')}
      </span>
     </div>
    </div>
    <div style={{ flex: 1, minWidth: 140 }}>
     <div className="po-spray" style={{ fontSize: 9, fontFamily: 'var(--ares-font-stencil)', color: '#A8895C', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4, textAlign: 'right' }}>
      {t('Цена')}
     </div>
     <div className="po-lcd" style={{ display: 'block', padding: '6px 12px', fontSize: 22, fontWeight: 700, color: '#F5BE72', textAlign: 'center' }}>
      {String(PRESALE_PRICE_SKR).padStart(4, '0')} SKR
     </div>
    </div>
   </div>

   {/* Прогресс-бар */}
   <div style={{
    height: 6,
    background: '#170E05',
    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8), 0 1px 0 rgba(255,214,160,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 16,
   }}>
    <motion.div
     initial={{ width: 0 }}
     animate={{ width: `${progressPct}%` }}
     transition={{ duration: 0.8, ease: 'easeOut' }}
     style={{
      height: '100%',
      background: progressPct > 80 ? 'linear-gradient(90deg, #D9441E, #F25D3B)' : 'linear-gradient(90deg, #D4893B, #F5BE72)',
      boxShadow: progressPct > 80 ? '0 0 10px #D9441E' : '0 0 10px #D4893B',
     }}
    />
   </div>

   {/* Сварная заплатка в правом углу */}
   <span className="po-patch" style={{ right: 8, bottom: 8, width: 50, height: 20 }} aria-hidden="true" />

   {/* Кнопка покупки: тактильная клавиша пульта */}
   <motion.button
    whileTap={disabled ? undefined : { y: 3 }}
    transition={{ type: 'spring', stiffness: 520, damping: 26 }}
    disabled={disabled}
    onClick={() => handleBuy()}
    className={soldOut || disabled ? 'mk-key' : 'mk-key mk-key--paint'}
    style={{
     width: '100%',
     padding: '14px 22px',
     fontSize: 14,
     display: 'flex',
     alignItems: 'center',
     justifyContent: 'center',
     gap: 10,
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

   <CaseReveal
    open={lastDrop !== null}
    tier={lastDrop ?? 0}
    mode="field"
    onClose={() => setLastDrop(null)}
   />
  </motion.div>
 )
}
