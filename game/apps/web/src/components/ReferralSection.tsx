import { useI18n } from '../i18n'

import { Users, Lock } from 'lucide-react'

/**
 * Реферальная программа закрыта вместе с легаси-рынком (P2-2).
 *
 * Награды рефереру и скидка покупателю начислялись исключительно в легаси
 * `fill_order` (см. `referrer_reward` в lib.rs). Легаси-рынок закрыт на запись,
 * значит новая регистрация (`register_referrer`) продавала бы обещание,
 * которое не может исполниться, — программа отвечает `ReferralProgramRetired`
 * (6059), а здесь нельзя показывать ни ссылку, ни проценты, ни кнопку
 * приглашения.
 *
 * Уже зарегистрированные пары продолжают получать выплаты, пока доигранная
 * книга V1 не опустеет: это честная часть, и она прямо написана в карточке.
 * Перенос наград в V2 (выплата из quote-комиссии) меняет доход казны и
 * требует отдельного решения владельца — `docs/ECONOMY.md` §5.
 */
export function ReferralSection() {
 const { t } = useI18n()

 return (
  <div style={{ marginBottom: 20 }}>
   <div className="po-card" style={{ padding: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
     <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Users size={18} color="#FFB347" />
      <span className="ares-stencil" style={{ fontSize: 13, color: '#FFB347', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
       {t('ВЫЗОВ ПОСЕЛЕНЦЕВ')}
      </span>
     </div>
     <span className="po-lamp po-lamp--off" aria-hidden="true" />
    </div>

    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
     <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, #4A301C, #2D1E13)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
      <Lock size={22} color="#FFC94A" />
     </div>
     <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#F6F1ED' }}>
       {t('Реферальная программа закрыта')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ares-dust, #E0A183)', marginTop: 2, lineHeight: 1.4 }}>
       {t('Новые регистрации не принимаются: награды платил только рынок V1, а он закрыт на запись.')}
      </div>
     </div>
    </div>

    <div style={{ padding: '12px 14px', borderRadius: 8, background: '#120B07', border: '1px solid #3E2413' }}>
     {[
      t('Новых приглашений и реферальных ссылок больше нет — регистрация отклоняется программой'),
      t('Уже зарегистрированные пары продолжают получать выплаты, пока доигрываются старые V1-ордера'),
      t('Перенос наград в рынок V2 — отдельное решение владельца экономики, а не автоматическое следствие'),
     ].map((rule, i) => (
      <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 11, color: 'rgba(255,179,71,0.8)', lineHeight: 1.5 }} className="ares-mono">
       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ares-hud-amber, #FFB347)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg> {rule}
      </div>
     ))}
    </div>
   </div>
  </div>
 )
}
