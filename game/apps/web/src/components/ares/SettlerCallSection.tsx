import { memo } from 'react';
import { t } from '../../i18n'

import { ConsolePanel, StencilPlate } from './panels';
import { IconEarth } from './icons';

export interface CrewMember {
 id: string;
 name: string;
 status: string;
}

export interface SettlerCallSectionProps {
 referralCode: string;
 crew: CrewMember[];
 onInvite: () => void;
}

export const SettlerCallSection = memo(function SettlerCallSection({
 referralCode,
 crew,
 onInvite,
}: SettlerCallSectionProps): JSX.Element {
 return (
  <ConsolePanel title={t('ВЫЗВАТЬ ПОСЕЛЕНЦА')} tone="amber">
   <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
     <span className="ares-mono" style={{ fontSize: 11, color: 'rgba(255,179,71,0.85)' }}>
      {t('КОД: {code}', { code: referralCode })}
     </span>
     <button
      type="button"
      onClick={onInvite}
      className="ares-stencil ares-metal-edge"
      style={{
       display: 'flex',
       alignItems: 'center',
       gap: 6,
       padding: '6px 12px',
       borderRadius: 6,
       background: 'rgba(0,0,0,0.35)',
       color: 'var(--ares-hud-amber, #FFB347)',
       fontSize: 11,
       cursor: 'pointer',
       border: 'none',
      }}
     >
      <IconEarth size={14} accent="var(--ares-hud-amber, #FFB347)" />
      ВЫЗВАТЬ
     </button>
    </div>

    {crew.length > 0 ? (
     <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {crew.map((member) => (
       <div
        key={member.id}
        style={{
         display: 'flex',
         alignItems: 'center',
         justifyContent: 'space-between',
         padding: '4px 8px',
         borderRadius: 4,
         background: 'rgba(0,0,0,0.25)',
        }}
       >
        <span style={{ fontSize: 12, color: 'rgba(255,179,71,0.9)' }}>{member.name}</span>
        <StencilPlate tone="neutral">{member.status}</StencilPlate>
       </div>
      ))}
     </div>
    ) : (
     <span className="ares-mono" style={{ fontSize: 10, color: 'rgba(255,179,71,0.5)' }}>
      {t('ЭКИПАЖ ПУСТ')}
     </span>
    )}
   </div>
  </ConsolePanel>
 );
});
