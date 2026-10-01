import { useState } from 'react'
import { useI18n } from '../i18n'

import { Copy, Check, Users, Gift, Share2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { useSolana } from '../contexts/SolanaContext'
import { useToast } from './Toast'
import { buildRefLink } from '../utils/referral'
import { sounds } from '../utils/sounds'
import { haptics } from '../utils/haptic'

/**
 * Рефералка — on-chain (PDA Referral, instruction register_referrer / fill_order).
 * Экономика в программе: приглашённый получает −1 % комиссии за сделки,
 * рефереру — 0.5 % от суммы сделки (не больше burn-доли комиссии).
 * Без Telegram и backend: идентичность — кошелёк, ссылка — ?ref=<wallet>.
 */
export function ReferralSection() {
 const { t } = useI18n()
 const { publicKey } = useSolana()
 const { show } = useToast()
 const [copied, setCopied] = useState(false)

 const referralLink = publicKey ? buildRefLink(publicKey.toBase58()) : ''

 const handleCopy = async () => {
  if (!publicKey) return
  try {
   await navigator.clipboard.writeText(referralLink)
   setCopied(true)
   sounds.success()
   haptics.tap()
   show({ type: 'success', title: t('Ссылка скопирована!'), message: t('Отправь другу') })
   setTimeout(() => setCopied(false), 2000)
  } catch {
   show({ type: 'error', title: t('Ошибка'), message: t('Не удалось скопировать') })
  }
 }

 const handleShare = async () => {
  if (!publicKey) return
  const text = t('Играю в Solana Potato — выращиваю картофель на Solana. Присоединяйся!')
  try {
   if (navigator.share) {
    await navigator.share({ title: 'Solana Potato', text, url: referralLink })
   } else {
    await navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
   }
   sounds.click()
   haptics.buttonPress()
  } catch {
   /* пользователь отменил share — не ошибка */
  }
 }

 return (
  <div style={{ marginBottom: 20 }}>
   {/* Карточка терминала рекрутинга */}
   <div
    className="po-card"
    style={{
     padding: 20,
    }}
   >
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
     <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Users size={18} color="#FFB347" />
      <span className="ares-stencil" style={{ fontSize: 13, color: '#FFB347', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
       {t("ВЫЗОВ ПОСЕЛЕНЦЕВ")}
      </span>
     </div>
     <span className="po-lamp po-lamp--green" aria-hidden="true" />
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
     <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, #8A2E08, #C1440E)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
      <Gift size={24} color="#FFD166" />
     </div>
     <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#F6F1ED' }}>
       {t('Вызови поселенца — дели комиссию!')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ares-dust, #E0A183)', marginTop: 2, lineHeight: 1.4 }}>
       {t('Продавцу −1 % от сделки, когда покупатель пришёл по ссылке; рефереру — 0.5 % от суммы каждой такой сделки (on-chain)')}
      </div>
     </div>
    </div>

    {/* Правила в утопленном слоте */}
    <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 8, background: '#120B07', border: '1px solid #3E2413' }}>
     {[
      t('Ссылка бесплатна — приглашающий платит ничего'),
      t('Приглашённый открывает ссылку с ?ref= — регистрируется автоматически (on-chain, одноразово)'),
      t('Антиспам: 5 🥔 сгорает с баланса приглашённого, разово').replace('🥔', 'POTATO'),
      t('−1 % продавцу на сделках приглашённого — на каждой покупке'),
      t('Твоя награда: 0.5 % от комиссии маркета по его сделкам'),
     ].map((rule, i) => (
      <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 11, color: 'rgba(255,179,71,0.8)', lineHeight: 1.5 }} className="ares-mono">
       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ares-hud-amber, #FFB347)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg> {rule}
      </div>
     ))}
    </div>

    {!publicKey && (
     <p style={{ fontSize: 12, color: 'var(--ares-dust, #E0A183)', marginBottom: 12, textAlign: 'center' }}>
      {t('Подключи кошелёк, чтобы получить свою реферальную ссылку.')}
     </p>
    )}

    {publicKey && (
     <div style={{
      marginBottom: 14,
      padding: '10px 12px',
      borderRadius: 8,
      background: '#100A05',
      border: '1px solid #3A2312',
      fontFamily: 'monospace',
      fontSize: 11,
      color: '#F6F1ED',
      wordBreak: 'break-all',
     }}>
      {referralLink}
     </div>
    )}

    {/* Кнопки */}
    <div style={{ display: 'flex', gap: 10 }}>
     <motion.button
      whileTap={{ y: 2 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      onClick={handleCopy}
      className="mk-key mk-key--paint"
      style={{
       flex: 1,
       padding: '12px 16px',
       fontSize: 13,
       fontWeight: 700,
       cursor: 'pointer',
       display: 'flex',
       alignItems: 'center',
       justifyContent: 'center',
       gap: 8,
      }}
     >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? t('Скопировано!') : t('Скопировать ссылку')}
     </motion.button>

     <motion.button
      whileTap={{ y: 2 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      onClick={handleShare}
      className="mk-key"
      style={{
       padding: '12px 18px',
       fontSize: 13,
       fontWeight: 700,
       cursor: 'pointer',
       display: 'flex',
       alignItems: 'center',
       gap: 8,
      }}
     >
      <Share2 size={16} />
      {t('Поделиться')}
     </motion.button>
    </div>
   </div>
  </div>
 )
}
