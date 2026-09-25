import { useState } from 'react'
import { t } from '../i18n'

import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle } from 'lucide-react'
import { PrizeRevealShow } from '../ui/PrizeRevealShow'
import { LiquidBar } from './ares/LiquidBar'
import { haptics } from '../utils/haptic'
import { useSolana } from '../contexts/SolanaContext'
import { useGame, GameStats } from '../contexts/GameContext'

import { MICRO } from '../utils/constants'

interface Achievement {
 id: string
 title: string
 desc: string
 patch: string
 progress: number
 target: number
 reward: number
}

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
    width: 52, height: 52, objectFit: 'contain', flexShrink: 0,
    opacity: done ? 1 : 0.55,
    filter: done ? 'drop-shadow(0 0 10px rgba(255,179,71,0.45))' : 'grayscale(0.6)',
   }}
  />
 )
}

/**
 * Нашивки экипажа — on-chain квесты программы (claim_achievement).
 * Id a1–a6 = quest_id 0–5; условия верифицируются в программе (proof by ownership),
 * награды выдаются из квест-казны PDA (пул 550 POTATO, заправлен init-onchain).
 * Идентичность — кошелёк; backend и Telegram не участвуют.
 */
function getAchievements(stats: GameStats): Achievement[] {
 const potato = stats.potatoBalance / MICRO
 return [
  { id: 'a1', title: t('Первый росток'), desc: t('Создай первое поле'), patch: '/ares/patch-sprout.webp', progress: Math.min(stats.totalFields, 1), target: 1, reward: 50 },
  { id: 'a2', title: t('Первый урожай'), desc: t('Накопи на балансе 100 POTATO'), patch: '/ares/patch-harvest.webp', progress: Math.min(potato, 100), target: 100, reward: 50 },
  { id: 'a3', title: t('Тысячник'), desc: t('Накопи на балансе 1 000 POTATO'), patch: '/ares/patch-thousand.webp', progress: Math.min(potato, 1000), target: 1000, reward: 100 },
  { id: 'a4', title: t('Фермер-магнат'), desc: t('Владей 5 полями'), patch: '/ares/patch-magnat.webp', progress: Math.min(stats.totalFields, 5), target: 5, reward: 100 },
  { id: 'a5', title: t('Картофельный барон'), desc: t('Накопи на балансе 10 000 POTATO'), patch: '/ares/patch-baron.webp', progress: Math.min(potato, 10000), target: 10000, reward: 200 },
  { id: 'a6', title: t('Ветеран'), desc: t('Владей 6 полями, хотя бы одно 3-го уровня'), patch: '/ares/patch-veteran.webp', progress: Math.min(stats.totalFields, 6), target: 6, reward: 50 },
 ]
}

function formatProgress(v: number): string {
 return v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K` : `${Math.floor(v)}`
}

export function MissionLog() {
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

   <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{t("Нашивки экипажа")}</h2>
   <p style={{ fontSize: 11, color: 'var(--pf-text-muted)', marginBottom: 16 }}>
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
      <motion.div key={ach.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
       className="pf-card hull-skin" style={{ padding: 16, borderRadius: 16, opacity: done ? 1 : 0.75 }}>
       <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <PatchImg src={ach.patch} title={ach.title} done={done} />
        <div style={{ flex: 1 }}>
         <div className="ares-stencil" style={{ fontSize: 13, marginBottom: 2, color: 'var(--ares-hud-amber, #FFB347)', textShadow: '0 0 10px rgba(255,179,71,0.35)' }}>{ach.title}</div>
         <div style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 6 }}>{ach.desc}</div>
         <LiquidBar value={pct} label={ach.title} />
         <div style={{ fontSize: 10, color: 'var(--pf-text-muted)', marginTop: 3 }}>
          {formatProgress(ach.progress)} / {formatProgress(ach.target)}
         </div>
        </div>
        <div style={{ textAlign: 'right' }}>
         {isClaimed ? (
          <CheckCircle size={22} color="var(--pf-teal)" aria-label={t("Получено")} />
         ) : done ? (
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => handleClaim(ach.id)} disabled={claiming === ach.id || !questsAvailable}
           style={{ padding: '8px 12px', borderRadius: 10, background: 'linear-gradient(135deg, var(--pf-gold), var(--pf-orange))', color: 'white', fontSize: 11, fontWeight: 700 }}>
           {claiming === ach.id ? '…' : `+${ach.reward} POTATO`}
          </motion.button>
         ) : (
          <button onClick={() => setEarlyAch(ach)} style={{ fontSize: 11, color: 'var(--pf-text-muted)', background: 'none' }}>+{ach.reward} POTATO</button>
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
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{t('Ещё рано получать награду')}</h3>
      <div style={{ padding: 14, borderRadius: 14, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', marginBottom: 16 }}>
       <p style={{ fontSize: 13, color: 'var(--pf-gold)', lineHeight: 1.5 }}>{t('Приходи, когда индикатор заполнится.', { desc: earlyAch.desc })}</p>
       <div style={{ marginTop: 10 }}><LiquidBar value={(earlyAch.progress / earlyAch.target) * 100} /></div>
       <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)', marginTop: 6 }}>{formatProgress(earlyAch.progress)} / {formatProgress(earlyAch.target)}</div>
      </div>
      <button onClick={() => setEarlyAch(null)} style={{ width: '100%', padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: 14, fontWeight: 600 }}>
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
   style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
   onClick={onClose}>
   <motion.div role="dialog" aria-modal="true" initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="pf-card hull-skin"
    style={{ width: '100%', maxWidth: 320, padding: 28, borderRadius: 24, textAlign: 'center', background: '#1a1a2e' }}
    onClick={(e) => e.stopPropagation()}>
    {children}
   </motion.div>
  </motion.div>
 )
}
