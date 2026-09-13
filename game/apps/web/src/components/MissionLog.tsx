import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, Send, Play, Gift, CalendarCheck } from 'lucide-react'
import { PrizeRevealShow } from '../ui/PrizeRevealShow'
import { LiquidBar } from './ares/LiquidBar'
import { haptics } from '../utils/haptic'
import { useSolana, BACKEND_URL } from '../contexts/SolanaContext'
import { useGame, GameStats } from '../contexts/GameContext'
import { isTelegram } from '../utils/telegram'
import { MICRO } from '../utils/constants'

const TELEGRAM_CHANNEL_URL = 'https://t.me/solana_potato'
const todayUtc = () => new Date().toISOString().slice(0, 10)

interface Achievement {
 id: string
 icon: string
 title: string
 desc: string
 progress: number
 target: number
 reward: number
}

/** Same ids and amounts as apps/backend/src/routes/reward.ts (the backend re-verifies progress on-chain). */
function getAchievements(stats: GameStats): Achievement[] {
 const potato = stats.potatoBalance / MICRO
 return [
  { id: 'a1', icon: '', title: 'Первый росток', desc: 'Создай первое поле', progress: Math.min(stats.totalFields, 1), target: 1, reward: 50 },
  { id: 'a2', icon: '', title: 'Первый урожай', desc: 'Накопи 100 POTATO', progress: Math.min(potato, 100), target: 100, reward: 50 },
  { id: 'a3', icon: '', title: 'Тысячник', desc: 'Накопи 1 000 POTATO', progress: Math.min(potato, 1000), target: 1000, reward: 100 },
  { id: 'a4', icon: '', title: 'Фермер-магнат', desc: 'Владей 5 полями', progress: Math.min(stats.totalFields, 5), target: 5, reward: 100 },
  { id: 'a5', icon: '', title: 'Картофельный барон', desc: 'Накопи 10 000 POTATO', progress: Math.min(potato, 10000), target: 10000, reward: 200 },
  { id: 'a6', icon: '', title: 'Ветеран', desc: 'Достигни 3 уровня (6 полей)', progress: Math.min(stats.playerLevel, 3), target: 3, reward: 50 },
 ]
}

function formatProgress(v: number): string {
 return v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K` : `${Math.floor(v)}`
}

export function MissionLog() {
 const { connected } = useSolana()
 const { stats, claimReward, claimed } = useGame()
 const [claiming, setClaiming] = useState<string | null>(null)
 const [adOpen, setAdOpen] = useState(false)
 const [adSeconds, setAdSeconds] = useState(0)
 const [earlyAch, setEarlyAch] = useState<Achievement | null>(null)
 const [showConfetti, setShowConfetti] = useState(false)
 const [lastRewardMicro, setLastRewardMicro] = useState(0)

 const questsAvailable = connected && (import.meta.env.DEV || (isTelegram() && Boolean(BACKEND_URL)))
 const dailyId = `daily_checkin:${todayUtc()}`
 const adId = `ad_bonus:${todayUtc()}`

 const handleClaim = async (id: string) => {
  if (claiming) return
  const rewardPotato =
   getAchievements(stats).find((x) => x.id === id)?.reward ??
   (id === 'starter_pack' ? 100 : id === 'social_channel' ? 10 : id.startsWith('daily_checkin:') ? 5 : id.startsWith('ad_bonus:') ? 25 : undefined)
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

 const startAd = () => {
  setAdOpen(true)
  setAdSeconds(15)
  const timer = window.setInterval(() => {
   setAdSeconds((s) => {
    if (s <= 1) {
     window.clearInterval(timer)
     return 0
    }
    return s - 1
   })
  }, 1000)
 }

 const achievements = getAchievements(stats)

 return (
  <>
   <PrizeRevealShow
    trigger={showConfetti}
    amount={lastRewardMicro / 1000000}
    title="НАГРАДА ПОЛУЧЕНА"
    message="Груз доставлен в твою колонию."
    unit="POTATO"
    haptics={true}
    onComplete={() => setShowConfetti(false)}
   />

   <div className="pf-card hull-skin" style={{ padding: 20, borderRadius: 20, marginBottom: 16 }}>
    <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Задачи смены</h3>
    <p style={{ fontSize: 11, color: 'var(--pf-text-muted)', marginBottom: 12 }}>
     {questsAvailable
      ? 'Награды начисляет защищённый сервер от имени администратора игры.'
      : !connected ? 'Подключи кошелёк, чтобы получать награды.'
      : 'Задачи смены доступны только внутри Telegram Mini App.'}
    </p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
     <Quest
      icon={<Gift size={18} color="var(--pf-gold)" />} color="var(--pf-gold)"
      title="Стартовый бонус" subtitle="Награда: 100 POTATO — хватит на первый Common-модуль"
      done={Boolean(claimed['starter_pack'])} busy={claiming === 'starter_pack'} disabled={!questsAvailable}
      onClaim={() => handleClaim('starter_pack')}
     />
     <Quest
      icon={<CalendarCheck size={18} color="var(--pf-teal)" />} color="var(--pf-teal)"
      title="Ежедневный чек-ин" subtitle="Награда: 5 POTATO, раз в день"
      done={Boolean(claimed[dailyId])} busy={claiming === dailyId} disabled={!questsAvailable}
      onClaim={() => handleClaim(dailyId)}
     />
     <Quest
      icon={<Send size={18} color="var(--ares-blueset, #6B93D6)" />} color="var(--ares-blueset, #6B93D6)"
      title="Подпишись на наш канал" subtitle="Награда: 10 POTATO"
      done={Boolean(claimed['social_channel'])} busy={claiming === 'social_channel'} disabled={!questsAvailable}
      onClaim={() => handleClaim('social_channel')}
      extra={
       <button onClick={() => window.open(TELEGRAM_CHANNEL_URL, '_blank', 'noopener')} style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(107, 147, 214, 0.3)', color: 'var(--ares-blueset, #6B93D6)', fontSize: 11, fontWeight: 600 }}>
        Подписаться
       </button>
      }
     />
     <Quest
      icon={<Play size={18} color="var(--ares-grow-violet, #B85CFF)" />} color="var(--ares-grow-violet, #B85CFF)"
      title="Посмотри рекламу (15 сек)" subtitle="Награда: 25 POTATO, раз в день"
      done={Boolean(claimed[adId])} busy={claiming === adId} disabled={!questsAvailable}
      claimLabel="Смотреть" onClaim={startAd}
     />
    </div>
   </div>

   <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Нашивки экипажа</h2>
   <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
    {achievements.map((ach, i) => {
     const done = ach.progress >= ach.target
     const isClaimed = Boolean(claimed[ach.id])
     const pct = Math.min(100, (ach.progress / ach.target) * 100)
     return (
      <motion.div key={ach.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
       className="pf-card hull-skin" style={{ padding: 16, borderRadius: 16, opacity: done ? 1 : 0.75 }}>
       <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
         <div className="ares-stencil" style={{ fontSize: 13, marginBottom: 2, color: 'var(--ares-hud-amber, #FFB347)', textShadow: '0 0 10px rgba(255,179,71,0.3)' }}>{ach.title}</div>
         <div style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 6 }}>{ach.desc}</div>
         <LiquidBar value={pct} label={ach.title} />
         <div style={{ fontSize: 10, color: 'var(--pf-text-muted)', marginTop: 3 }}>
          {formatProgress(ach.progress)} / {formatProgress(ach.target)}
         </div>
        </div>
        <div style={{ textAlign: 'right' }}>
         {isClaimed ? (
          <CheckCircle size={22} color="var(--pf-teal)" aria-label="Получено" />
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
      <div style={{ fontSize: 56, marginBottom: 12 }} aria-hidden="true">{earlyAch.icon}</div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Ещё рано получать награду</h3>
      <div style={{ padding: 14, borderRadius: 14, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', marginBottom: 16 }}>
       <p style={{ fontSize: 13, color: 'var(--pf-gold)', lineHeight: 1.5 }}>{earlyAch.desc}. Приходи, когда индикатор заполнится.</p>
       <div style={{ marginTop: 10 }}><LiquidBar value={(earlyAch.progress / earlyAch.target) * 100} /></div>
       <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)', marginTop: 6 }}>{formatProgress(earlyAch.progress)} / {formatProgress(earlyAch.target)}</div>
      </div>
      <button onClick={() => setEarlyAch(null)} style={{ width: '100%', padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: 14, fontWeight: 600 }}>
       Понятно
      </button>
     </Overlay>
    )}
   </AnimatePresence>

   <AnimatePresence>
    {adOpen && (
     <Overlay onClose={adSeconds > 0 ? () => setAdOpen(false) : undefined}>
      <div style={{ fontSize: 56, marginBottom: 16 }} aria-hidden="true"></div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Реклама</h3>
      <p style={{ fontSize: 13, color: 'var(--pf-text-secondary)', marginBottom: 20 }}>Лучшие удобрения в метавселенной! </p>
      {adSeconds > 0 ? (
       <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--ares-grow-violet, #B85CFF)' }} aria-live="polite">{adSeconds}</div>
      ) : (
       <motion.button whileTap={{ scale: 0.95 }}
        onClick={async () => { setAdOpen(false); await handleClaim(adId) }}
        className="gradient-primary" style={{ width: '100%', padding: 14, borderRadius: 12, color: 'white', fontWeight: 700 }}>
        Забрать 25 POTATO
       </motion.button>
      )}
      {adSeconds > 0 && (
       <button onClick={() => setAdOpen(false)} style={{ marginTop: 16, color: 'var(--pf-text-muted)', fontSize: 12, background: 'none' }}>
        Закрыть без награды
       </button>
      )}
     </Overlay>
    )}
   </AnimatePresence>
  </>
 )
}

interface QuestProps {
 icon: React.ReactNode
 color: string
 title: string
 subtitle: string
 done: boolean
 busy: boolean
 disabled: boolean
 claimLabel?: string
 onClaim: () => void
 extra?: React.ReactNode
}

function Quest({ icon, color, title, subtitle, done, busy, disabled, claimLabel = 'Забрать', onClaim, extra }: QuestProps) {
 return (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, background: `${color}1a`, border: `1px solid ${color}33` }}>
   <span aria-hidden="true">{icon}</span>
   <div style={{ flex: 1 }}>
    <div className="ares-stencil" style={{ fontSize: 12, color: 'var(--ares-hud-amber, #FFB347)', textShadow: '0 0 10px rgba(255,179,71,0.3)' }}>{title}</div>
    <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)' }}>{subtitle}</div>
   </div>
   {done ? (
    <CheckCircle size={20} color="var(--pf-teal)" aria-label="Получено" />
   ) : (
    <div style={{ display: 'flex', gap: 6 }}>
     {extra}
     <button onClick={onClaim} disabled={busy || disabled}
      style={{ padding: '8px 10px', borderRadius: 8, background: disabled ? 'rgba(255,255,255,0.1)' : color, color: 'white', fontSize: 11, fontWeight: 600 }}>
      {busy ? '…' : claimLabel}
     </button>
    </div>
   )}
  </div>
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
