import { memo } from 'react';
import { t } from '../../i18n'

import { haptics } from '../../utils/haptic';
import { AresHullFrame } from '../../ui/AresHullFrame';
import { MotionIcon } from '../../ui/MotionIcon';
import { IconTuber, IconCrate, IconLog, IconBunk } from './icons';

export type AresTab = 'main' | 'market' | 'stats' | 'profile';

export interface AresBottomNavProps {
 active: AresTab;
 onChange: (tab: AresTab) => void;
}

interface NavItem {
 id: AresTab;
 label: string;
}

const NAV_ITEMS: NavItem[] = [
 { id: 'main', label: t('АГРО') },
 { id: 'market', label: t('СНАБ') },
 { id: 'stats', label: t('ЖУРНАЛ') },
 { id: 'profile', label: t('КАЮТА') },
];

function renderIcon(tab: AresTab, active: boolean): JSX.Element {
 const accent = active ? 'var(--ares-grow-pink, #E86A3C)' : undefined;
 switch (tab) {
  case 'main':
   return <IconTuber size={18} accent={accent} glow={active} />;
  case 'market':
   return <IconCrate size={18} accent={accent} glow={active} />;
  case 'stats':
   return <IconLog size={18} accent={accent} glow={active} />;
  case 'profile':
   return <IconBunk size={18} accent={accent} glow={active} />;
  default:
   return <IconTuber size={18} accent={accent} glow={active} />;
 }
}

export const AresBottomNav = memo(function AresBottomNav({
 active,
 onChange,
}: AresBottomNavProps): JSX.Element {
 return (
  <div className="hull-nav-wrap">
   <nav className="hull-panel hull-nav" aria-label={t("Разделы колонии")}>
    <AresHullFrame variant="default" runningLight />
    <div className="hull-panel-content">
     {NAV_ITEMS.map((item) => {
      const isActive = item.id === active;
      return (
       <button
        key={item.id}
        type="button"
        className="hull-nav-button"
        aria-current={isActive ? 'page' : undefined}
        onClick={() => {
         haptics.navigate();
         onChange(item.id);
        }}
       >
        <MotionIcon active={isActive}>{renderIcon(item.id, isActive)}</MotionIcon>
        <span>{item.label}</span>
       </button>
      );
     })}
    </div>
   </nav>
  </div>
 );
});
