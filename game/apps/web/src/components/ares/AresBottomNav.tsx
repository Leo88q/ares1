import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { t } from '../../i18n'

import { haptics } from '../../utils/haptic';
import { AresHullFrame } from '../../ui/AresHullFrame';

export type AresTab = 'main' | 'market' | 'stats' | 'profile';

export interface AresBottomNavProps {
 active: AresTab;
 onChange: (tab: AresTab) => void;
}

interface NavItem {
 id: AresTab;
 label: string;
 code: string;
 lamp: 'green' | 'amber' | 'magenta';
}

const NAV_ITEMS: NavItem[] = [
 { id: 'main', label: t('АГРО'), code: 'K1', lamp: 'green' },
 { id: 'market', label: t('СНАБ'), code: 'K2', lamp: 'amber' },
 { id: 'stats', label: t('ЖУРНАЛ'), code: 'K3', lamp: 'amber' },
 { id: 'profile', label: t('КАЮТА'), code: 'K4', lamp: 'green' },
];

/**
 * Пульт секций (MK-редизайн, 2026-09-28): вместо плоской панели иконок —
 * ряд клавиш пульта. Активная клавиша защёлкнута в нажатом положении
 * (mk-key--engaged: утоплена, грань подсвечена), над ней горит лампа реле.
 * Пропсы не менялись: `active` / `onChange`.
 */
export const AresBottomNav = memo(function AresBottomNav({
 active,
 onChange,
}: AresBottomNavProps): JSX.Element {
 const reducedMotion = useReducedMotion();
 return (
  <div className="hull-nav-wrap">
   <nav className="hull-panel hull-nav" aria-label={t("Разделы колонии")}>
    <AresHullFrame variant="default" runningLight={false} />
    <div className="hull-panel-content">
     {NAV_ITEMS.map((item) => {
      const isActive = item.id === active;
      return (
       <motion.button
        key={item.id}
        type="button"
        className={`mk-key hull-nav-key${isActive ? ' mk-key--engaged' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        aria-pressed={isActive}
        whileTap={reducedMotion || isActive ? undefined : { y: 3 }}
        transition={{ type: 'spring', stiffness: 520, damping: 26, mass: 0.9 }}
        onClick={() => {
         haptics.navigate();
         onChange(item.id);
        }}
       >
        <span className="hull-nav-key__lamp">
         <span className={`mk-lamp ${isActive ? `mk-lamp--${item.lamp}` : 'mk-lamp--off'}`} />
        </span>
        <span className="hull-nav-key__label">{item.label}</span>
        <span className="hull-nav-key__code" aria-hidden="true">{item.code}</span>
       </motion.button>
      );
     })}
    </div>
   </nav>
  </div>
 );
});
