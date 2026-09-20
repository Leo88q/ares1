import { useReferral } from '../hooks/useReferral'
import { PENDING_REFERRER_KEY } from '../hooks/useReferralRegistration'
import { skrCost, formatSkrCost } from '../utils/skrPayments'
import { useState } from 'react'
import { t } from '../i18n'

import { Copy, Check, Users, Gift, Share2 } from 'lucide-react'
import { useSolana } from '../contexts/SolanaContext'
import { useToast } from './Toast'
import { buildRefLink } from '../utils/referral'
import { sounds } from '../utils/sounds'
import { haptics } from '../utils/haptic'

/**
 * Рефералка — on-chain (PDA Referral, instruction register_referrer / fill_order).
 * Экономика в программе: приглашённый получает −1 % комиссии за сделки,
 * Referrer receives 0.5% of the SKR quote, from the treasury share of the fee.
 * Без Telegram и backend: идентичность — кошелёк, ссылка — ?ref=<wallet>.
 */
export function ReferralSection() {
 const { publicKey, skrPricing } = useSolana()
 const { registerReferrer, loading } = useReferral()
 const [pending, setPending] = useState(() => { try { return localStorage.getItem(PENDING_REFERRER_KEY) || '' } catch { return '' } })
 const registrationCost = skrCost(skrPricing, 5)
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
  <div style={{ marginBottom: 24 }}>
   {/* Заголовок секции */}
   <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
    <Users size={20} color="var(--pf-teal)" />
    <h2 className="ares-stencil" style={{ fontSize: 16, margin: 0, color: 'var(--ares-hud-amber, #FFB347)', textShadow: '0 0 10px rgba(255,179,71,0.35)' }}>{t("ВЫЗОВ ПОСЕЛЕНЦЕВ")}</h2>
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
       {t('Вызови поселенца — дели комиссию!')}
      </div>
      <div style={{ fontSize: 13, color: 'var(--pf-text-secondary)', marginTop: 4 }}>
       {t('Реферальные сделки: −1 п.п. комиссии продавца; рефереру — 0.5 % суммы в SKR (on-chain).')}
      </div>
     </div>
    </div>

    {/* Правила: кто и что платит (раньше было отдельным блоком в «Журнале») */}
    <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}>
     {[
      t('Ссылка бесплатна — приглашающий платит ничего'),
      t('Ссылка не списывает токены. Регистрация — только после подтверждения стоимости в SKR.'),
      t('Регистрация оплачивается в SKR один раз; SOL нужен для комиссии сети и rent.'),
      t('Реферальная скидка уменьшает комиссию продавца на 1 процентный пункт. Цена покупки не меняется.'),
      t('Твоя награда: 0.5 % суммы сделки в SKR из комиссии, при наличии подходящего SKR-счёта.'),
     ].map((t, i) => (
      <div key={i} style={{ display: 'flex', gap: 6, padding: '2px 0', fontSize: 11, color: 'var(--pf-text-secondary)', lineHeight: 1.5 }}>
       <span style={{ color: 'var(--ares-hud-amber, #FFB347)', flexShrink: 0 }} aria-hidden="true">✓</span> {t}
      </div>
     ))}
    </div>

    {!publicKey && (
     <p style={{ fontSize: 12, color: 'var(--pf-text-secondary)', marginBottom: 12 }}>
      {t('Подключи кошелёк, чтобы получить свою реферальную ссылку.')}
     </p>
    )}

    {publicKey && (
     <div style={{
      marginBottom: 12,
      padding: '10px 12px',
      borderRadius: 10,
      background: 'rgba(0,0,0,0.25)',
      border: '1px solid rgba(255,255,255,0.08)',
      fontFamily: 'monospace',
      fontSize: 11,
      color: 'var(--pf-text-secondary)',
      wordBreak: 'break-all',
     }}>
      {referralLink}
     </div>
    )}

    {publicKey && <div style={{ marginBottom: 16 }}>
     <label>Реферер (адрес кошелька)<input aria-label="Referrer wallet" value={pending} onChange={e => setPending(e.target.value)} style={{ width: '100%' }} /></label>
     <button disabled={loading || !pending || registrationCost === null} onClick={async () => {
      if (await registerReferrer(pending)) { setPending(''); try { localStorage.removeItem(PENDING_REFERRER_KEY) } catch { /* storage unavailable */ } }
     }}>Зарегистрировать · {formatSkrCost(registrationCost)} SKR</button>
    </div>}
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
      {copied ? t('Скопировано!') : t('Скопировать ссылку')}
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
       display: 'flex',
       alignItems: 'center',
       gap: 8,
      }}
     >
      <Share2 size={16} />
      {t('Поделиться')}
     </button>
    </div>
   </div>
  </div>
 )
}
