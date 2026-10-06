import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { PRESALE_DROP } from '../utils/constants'
import { t } from '../i18n'
import { sounds } from '../utils/sounds'
import { haptic } from '../utils/haptic'
import './case-reveal.css'

export interface CaseRevealProps {
 open: boolean
 /** 0 = COMMON, 1 = RARE, 2 = EPIC */
 tier: number
 /** Режим: дроп модуля при покупке поля или кредит при предоплате POTATO. */
 mode?: 'field' | 'potato'
 /** Для режима potato: сколько POTATO начислено. */
 amount?: number
 onClose: () => void
}

const TIER_NAME = ['common', 'rare', 'epic'] as const

type Phase = 'shake' | 'burst' | 'reveal'

const SHAKE_MS = 1400
const BURST_MS = 900

export default function CaseReveal({ open, tier, mode = 'field', amount = 0, onClose }: CaseRevealProps) {
 const [phase, setPhase] = useState<Phase>('shake')
 const timers = useRef<number[]>([])

 useEffect(() => {
  if (!open) return
  setPhase('shake')
  try { sounds.click() } catch { /* звук опционален */ }

  const t1 = window.setTimeout(() => {
   setPhase('burst')
   try { sounds.buyField() } catch {}
   try { haptic('heavy') } catch {}
  }, SHAKE_MS)
  const t2 = window.setTimeout(() => {
   setPhase('reveal')
   try { sounds.reward() } catch {}
   try { haptic('achievement') } catch {}
  }, SHAKE_MS + BURST_MS)
  timers.current = [t1, t2]
  return () => { timers.current.forEach(clearTimeout); timers.current = [] }
 }, [open])

 const info = PRESALE_DROP[tier] ?? PRESALE_DROP[0]
 const color = info.color
 const name = info.label

 return createPortal(
  <AnimatePresence>
   {open && (
    <motion.div
     className="cr-overlay"
     initial={{ opacity: 0 }}
     animate={{ opacity: 1 }}
     exit={{ opacity: 0 }}
     onClick={onClose}
    >
     <div className="cr-stage" onClick={e => e.stopPropagation()}>
      {/* Запечатанный кейс: трясётся, потом «взрывается». */}
      {phase !== 'reveal' && (
       <motion.img
        src="/ares/case-sealed.png"
        alt=""
        className="cr-sealed"
        animate={phase === 'shake'
         ? { x: [0, -10, 10, -8, 8, -4, 4, 0], rotate: [0, -2, 2, -1.5, 1.5, 0], scale: [1, 1.02, 1.04, 1.06] }
         : { scale: [1.06, 1.4], opacity: [1, 0] }}
        transition={phase === 'shake'
         ? { duration: SHAKE_MS / 1000, ease: 'easeInOut' }
         : { duration: BURST_MS / 1000, ease: 'easeOut' }}
       />
      )}

      {/* Вспышка в момент вскрытия. */}
      {phase !== 'shake' && (
       <motion.img
        src="/ares/case-burst.png"
        alt=""
        className="cr-burst"
        initial={{ opacity: 0, scale: 0.4, rotate: 0 }}
        animate={{ opacity: phase === 'burst' ? 1 : 0.5, scale: phase === 'burst' ? 1.6 : 1.2, rotate: 20 }}
        transition={{ duration: BURST_MS / 1000, ease: 'easeOut' }}
       />
      )}

      {/* Раскрытый модуль с редкостью. */}
      {phase === 'reveal' && (
       <motion.div className="cr-reveal" style={{ ['--cr-color' as string]: color }}>
        <motion.img
         src={`/ares/cassette-${TIER_NAME[tier] ?? 'common'}.webp`}
         alt={name}
         className="cr-cassette"
         initial={{ scale: 0.2, rotate: -12, opacity: 0 }}
         animate={{ scale: 1, rotate: 0, opacity: 1 }}
         transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        />
        <motion.div
         className="cr-rarity"
         initial={{ opacity: 0, y: 16 }}
         animate={{ opacity: 1, y: 0 }}
         transition={{ delay: 0.25 }}
        >
         <span className="cr-rarity-badge">{name}</span>
         <span className="cr-title">
          {mode === 'field'
           ? t('Гидропонный модуль раскрыт')
           : t('Предоплата зачислена')}
         </span>
         {mode === 'potato' && amount > 0 && (
          <span className="cr-amount">+{amount} POTATO</span>
         )}
         <span className="cr-chance">{t('Шанс дропа: {c}%', { c: String(info.chance) })}</span>
        </motion.div>
       </motion.div>
      )}

      <button className="cr-close" onClick={onClose}>{t('Продолжить')}</button>
     </div>
    </motion.div>
   )}
  </AnimatePresence>,
  document.body,
 )
}
