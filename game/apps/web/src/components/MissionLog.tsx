import { useState } from 'react'
import { useI18n } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle } from 'lucide-react'
import { PrizeRevealShow } from '../ui/PrizeRevealShow'
import { LiquidBar } from './ares/LiquidBar'
import { haptics } from '../utils/haptic'
import { useSolana } from '../contexts/SolanaContext'
import { useGame } from '../contexts/GameContext'
import { getAchievements, type Achievement } from '../utils/achievements'

import { MICRO } from '../utils/constants'

function PatchImg({ src, title, done }: { src: string; title: string; done: boolean }): JSX.Element | null {
 const [failed, setFailed] = useState(false)
 if (failed) return null
 return (
  <img
   src={src}
   alt={title}
   width={52}
   height={52}
   loading="lazy"
   onError={() => setFailed(true)}
   style={{
    width: 52,
    height: 52,
    objectFit: 'contain',
    flexShrink: 0,
    opacity: done ? 1 : 0.55,
    filter: done ? 'drop-shadow(0 0 10px rgba(255,179,71,0.45))' : 'grayscale(0.6)',
   }}
  />
 )
}

function formatProgress(v: number): string {
 return v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K` : `${Math.floor(v)}`
}

export function MissionLog() {
 const { t } = useI18n()
 const { connected, ready } = useSolana()
 const { stats, claimReward, claimed } = useGame()
 const [claiming, setClaiming] = useState<string | null>(null)
 const [earlyAch, setEarlyAch] = useState<Achievement | null>(null)
 const [showConfetti, setShowConfetti] = useState(false)
 const [lastRewardMicro, setLastRewardMicro] = useState(0)

 const questsAvailable = connected && ready

 const handleClaim = async (id: string) => {
  if (claiming) return
  const rewardPotato = getAchievements(stats).find((x) => x.id === id)?.reward
  setClaiming(id)
  const rewardMicro = rewardPotato !== undefined ? rewardPotato * MICRO : 0
  setLastRewardMicro(rewardMicro)
  const ok = await claimReward(id, rewardMicro || undefined)
  if (ok) {
   haptics.achievement()
   setShowConfetti(true)
  }
  setClaiming(null)
 }

 const achievements = getAchievements(stats)

 return (
  <>
   <PrizeRevealShow
    trigger={showConfetti}
    amount={lastRewardMicro / 1000000}
    title={t("НАГРАДА ПОЛУЧЕНА")}
    message={t("Груз доставлен в твою колонию.")}
    unit="POTATO"
    haptics={true}
    onComplete={() => setShowConfetti(false)}
   />

   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
    <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--ares-font-stencil)', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#F6F1ED', margin: 0 }}>
     {t("Нашивки экипажа")}
    </h2>
    <span className="po-lamp po-lamp--green" aria-hidden="true" />
   </div>
   <p style={{ fontSize: 11, color: 'var(--ares-dust, #E0A183)', marginBottom: 16 }}>
    {questsAvailable
     ? t('Условия проверяются on-chain в программе, награды — из квест-казны (пул 550 POTATO). Одноразово.')
     : t('Подключи кошелёк, чтобы получать награды.') }
   </p>

   <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
    {achievements.map((ach, i) => {
     const done = ach.progress >= ach.target
     const isClaimed = Boolean(claimed[ach.id])
     const pct = Math.min(100, (ach.progress / ach.target) * 100)
     return (
      <motion.div
       key={ach.id}
       initial={{ opacity: 0, x: -20 }}
       animate={{ opacity: 1, x: 0 }}
       transition={{ delay: i * 0.06 }}
       style={{
        padding: '14px 16px',
        borderRadius: 8,
        border: done && !isClaimed
         ? '1px solid rgba(255, 179, 71, 0.55)'
         : isClaimed
         ? '1px solid rgba(159, 190, 122, 0.35)'
         : '1px solid rgba(255, 179, 71, 0.18)',
        background: done && !isClaimed
         ? 'radial-gradient(120% 80% at 50% 0%, rgba(255, 160, 50, 0.08) 0%, transparent 60%), linear-gradient(180deg, #1D140E 0%, #120D09 100%)'
         : 'linear-gradient(180deg, #17100A 0%, #0F0A06 100%)',
        boxShadow: done && !isClaimed
         ? '0 0 16px -2px rgba(255, 179, 71, 0.25), inset 0 1px 0 rgba(255, 224, 170, 0.2)'
         : 'inset 0 1px 0 rgba(255, 214, 170, 0.08), 0 4px 12px rgba(0,0,0,0.5)',
        opacity: isClaimed ? 0.75 : 1,
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
       }}
      >
       <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <PatchImg src={ach.patch} title={ach.title} done={done || isClaimed} />
        <div style={{ flex: 1, minWidth: 0 }}>
         <div className="ares-stencil" style={{ fontSize: 13, marginBottom: 3, color: '#FFB347', letterSpacing: '0.1em' }}>{ach.title}</div>
         <div style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 8, lineHeight: 1.4 }}>{ach.desc}</div>
         <LiquidBar value={pct} label={ach.title} />
         <div style={{ fontSize: 10, color: 'rgba(255,179,71,0.7)', marginTop: 5 }} className="ares-mono">
          {ach.customProgressText ?? `${formatProgress(ach.progress)} / ${formatProgress(ach.target)}`}
         </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
         {isClaimed ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#9FBE7A', fontSize: 11, fontWeight: 700 }} className="ares-mono">
           <CheckCircle size={16} color="#9FBE7A" aria-label={t("Получено")} />
           <span>{t("ПОЛУЧЕНО")}</span>
          </span>
         ) : done ? (
          <motion.button
           whileTap={{ y: 2 }}
           transition={{ type: 'spring', stiffness: 520, damping: 26 }}
           onClick={() => handleClaim(ach.id)}
           disabled={claiming === ach.id || !questsAvailable}
           className="mk-key mk-key--paint"
           style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
          >
           {claiming === ach.id ? '…' : `+${ach.reward} POTATO`}
          </motion.button>
         ) : (
          <button
           onClick={() => setEarlyAch(ach)}
           className="mk-key"
           style={{ fontSize: 11, padding: '6px 10px', opacity: 0.75, cursor: 'pointer' }}
          >
           +{ach.reward} POTATO
          </button>
         )}
        </div>
       </div>
      </motion.div>
     )
    })}
   </div>

   <AnimatePresence>
    {earlyAch && (
     <Overlay onClose={() => setEarlyAch(null)}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, fontFamily: 'var(--ares-font-stencil)', letterSpacing: '0.08em', color: '#F6F1ED' }}>
       {t('Ещё рано получать награду')}
      </h3>
      <div style={{ padding: 16, borderRadius: 10, background: 'linear-gradient(180deg, #1C120B 0%, #120A06 100%)', border: '1px solid #5A3218', marginBottom: 16 }}>
       <p style={{ fontSize: 13, color: '#FFB347', lineHeight: 1.5, margin: 0 }}>
        {earlyAch.id === 'a6' && stats.totalFields >= 6
         ? t('Требуется владеть 6 делянками, и хотя бы одна должна быть 3-го уровня (сейчас макс. ур. {lvl}).', { lvl: stats.maxFieldLevel ?? 1 })
         : t('Приходи, когда индикатор заполнится.', { desc: earlyAch.desc })}
       </p>
       <div style={{ marginTop: 12 }}><LiquidBar value={(earlyAch.progress / earlyAch.target) * 100} /></div>
       <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)', marginTop: 8 }} className="ares-mono">
        {earlyAch.customProgressText ?? `${formatProgress(earlyAch.progress)} / ${formatProgress(earlyAch.target)}`}
       </div>
      </div>
      <button
       onClick={() => setEarlyAch(null)}
       className="mk-key mk-key--paint"
       style={{ width: '100%', padding: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
      >
       {t('Понятно')}
      </button>
     </Overlay>
    )}
   </AnimatePresence>
  </>
 )
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
 return (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
   style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(6px)' }}
   onClick={onClose}>
   <motion.div role="dialog" aria-modal="true" initial={{ scale: 0.9 }} animate={{ scale: 1 }}
    style={{
     width: '100%',
     maxWidth: 360,
     maxHeight: 'min(90vh, 560px)',
     overflowY: 'auto',
     WebkitOverflowScrolling: 'touch',
     padding: 24,
     textAlign: 'center',
     borderRadius: 14,
     background: 'linear-gradient(180deg, #261A11 0%, #160E08 100%)',
     border: '1px solid #5A381E',
     boxShadow: '0 16px 40px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,214,170,0.14)',
    }}
    onClick={(e) => e.stopPropagation()}>
    {children}
   </motion.div>
  </motion.div>
 )
}
