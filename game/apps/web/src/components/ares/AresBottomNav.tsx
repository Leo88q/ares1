import { memo } from 'react';
import { t } from '../../i18n'

import { haptics } from '../../utils/haptic';
import { AresHullFrame } from '../../ui/AresHullFrame';
import { MotionIcon } from '../../ui/MotionIcon';
import { Emblem } from '../../ui/Emblem';

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
 // эмблемы единого арт-сета; активная вкладка подсвечивается рамкой клавиши
 const filter = active ? 'brightness(1.25) drop-shadow(0 0 5px rgba(255,170,60,0.45))' : 'brightness(0.82)'
 switch (tab) {
  case 'main':
   return <Emblem name="sprout" size={18} style={{ filter }} />;
  case 'market':
   return <Emblem name="crate" size={18} style={{ filter }} />;
  case 'stats':
   return <Emblem name="clipboard" size={18} style={{ filter }} />;
  case 'profile':
   return <Emblem name="bunk" size={18} style={{ filter }} />;
  default:
   return <Emblem name="sprout" size={18} style={{ filter }} />;
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
