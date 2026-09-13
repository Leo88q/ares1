import { useState, useEffect } from 'react'
import { Copy, Check, Users, Gift } from 'lucide-react'
import { useSolana } from '../contexts/SolanaContext'
import { useToast } from './Toast'
import { getReferralStats, getReferralConfig, buildReferralLink, ReferralStats, ReferralConfig } from '../utils/referral'
import { sounds } from '../utils/sounds'
import { haptics } from '../utils/haptic'

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || 'solana_potato_bot'

export function ReferralSection() {
 const { publicKey } = useSolana()
 const { show } = useToast()
 const [stats, setStats] = useState<ReferralStats | null>(null)
 const [config, setConfig] = useState<ReferralConfig | null>(null)
 const [copied, setCopied] = useState(false)
 const [loading, setLoading] = useState(true)

 useEffect(() => {
  if (!publicKey) return

  async function load() {
   setLoading(true)
   const [s, c] = await Promise.all([
    getReferralStats(publicKey!.toBase58()),
    getReferralConfig(),
   ])
   setStats(s)
   setConfig(c)
   setLoading(false)
  }

  load()
  // Обновляем статистику каждые 30 секунд
  const interval = setInterval(load, 30_000)
  return () => clearInterval(interval)
 }, [publicKey])

 if (loading) return null

 const referralLink = publicKey ? buildReferralLink(BOT_USERNAME, publicKey.toBase58()) : ''
 const referrerReward = config ? Number(config.referrerRewardMicro) / 1_000_000 : 20
 const invitedReward = config ? Number(config.invitedRewardMicro) / 1_000_000 : 10
 const totalEarned = stats ? Number(stats.totalEarnedMicro) / 1_000_000 : 0

 const handleCopy = async () => {
  if (!publicKey) return
  try {
   await navigator.clipboard.writeText(referralLink)
   setCopied(true)
   sounds.success()
   haptics.tap()
   show({ type: 'success', title: 'Ссылка скопирована!', message: 'Отправь другу' })
   setTimeout(() => setCopied(false), 2000)
  } catch (err) {
   show({ type: 'error', title: 'Ошибка', message: 'Не удалось скопировать' })
  }
 }

 const handleShare = () => {
  if (!publicKey) return
  const text = `Играю в Solana Potato! Присоединяйся и получи ${invitedReward} POTATO бонус при старте.`
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(text)}`
  window.open(shareUrl, '_blank')
  sounds.click()
  haptics.buttonPress()
 }

 return (
  <div style={{ marginBottom: 24 }}>
   {/* Заголовок секции */}
   <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
    <Users size={20} color="var(--pf-teal)" />
    <h2 className="ares-stencil" style={{ fontSize: 16, margin: 0, color: 'var(--ares-hud-amber, #FFB347)', textShadow: '0 0 10px rgba(255,179,71,0.35)' }}>ВЫЗОВ ПОСЕЛЕНЦЕВ</h2>
   </div>

   {/* Карточка с описанием */}
   <div className="pf-card hull-skin" style={{
    padding: 20,
    borderRadius: 16,
    background: 'linear-gradient(135deg, rgba(193,68,14,0.10) 0%, rgba(184,92,255,0.08) 100%)',
    border: '1px solid rgba(160,82,40,0.6)',
    marginBottom: 16,
   }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
     <Gift size={32} color="var(--pf-gold)" />
     <div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pf-text-primary)' }}>
       Вызови поселенца — получи паёк!
      </div>
      <div style={{ fontSize: 13, color: 'var(--pf-text-secondary)', marginTop: 4 }}>
       {referrerReward} POTATO тебе + {invitedReward} POTATO новобранцу после первой жатвы
      </div>
     </div>
    </div>

    {!publicKey && (
     <p style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 12 }}>
       Подключи кошелёк, чтобы получить свою реферальную ссылку.
     </p>
    )}

    {/* Кнопки */}
    <div style={{ display: 'flex', gap: 10 }}>
     <button
      onClick={handleCopy}
      style={{
       flex: 1,
       padding: '12px 16px',
       borderRadius: 12,
       background: copied ? 'var(--pf-green)' : 'var(--pf-grad-cta)',
       border: 'none',
       color: 'white',
       fontSize: 14,
       fontWeight: 700,
       cursor: 'pointer',
       display: 'flex',
       alignItems: 'center',
       justifyContent: 'center',
       gap: 8,
       transition: 'all 0.2s',
      }}
     >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? 'Скопировано!' : 'Скопировать код вызова'}
     </button>

     <button
      onClick={handleShare}
      style={{
       padding: '12px 20px',
       borderRadius: 12,
       background: 'rgba(255,255,255,0.08)',
       border: '1px solid rgba(255,255,255,0.15)',
       color: 'white',
       fontSize: 14,
       fontWeight: 600,
       cursor: 'pointer',
       transition: 'all 0.2s',
      }}
     >
      Передать по каналу
     </button>
    </div>
   </div>

   {/* Статистика */}
   {stats && (
    <div className="pf-card hull-skin" style={{
     padding: 16,
     borderRadius: 12,
     background: 'rgba(255,255,255,0.03)',
    }}>
     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      <div style={{ textAlign: 'center' }}>
       <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pf-teal)' }}>
        {stats.completed}
       </div>
       <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)', marginTop: 4 }}>
        Вызвано
       </div>
      </div>

      <div style={{ textAlign: 'center' }}>
       <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ares-grow-violet, #B85CFF)' }}>
        {stats.pending}
       </div>
       <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)', marginTop: 4 }}>
        В шлюзе
       </div>
      </div>

      <div style={{ textAlign: 'center' }}>
       <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pf-gold)' }}>
        {totalEarned.toFixed(1)}
       </div>
       <div style={{ fontSize: 11, color: 'var(--pf-text-secondary)', marginTop: 4 }}>
        Добыто POTATO
       </div>
      </div>
     </div>

     <div style={{
      marginTop: 12,
      paddingTop: 12,
      borderTop: '1px solid rgba(255,255,255,0.08)',
      fontSize: 11,
      color: 'var(--pf-text-muted)',
      textAlign: 'center',
     }}>
      Лимит: {stats.today}/{stats.dailyCap} поселенцев за сол
     </div>
    </div>
   )}
  </div>
 )
}
