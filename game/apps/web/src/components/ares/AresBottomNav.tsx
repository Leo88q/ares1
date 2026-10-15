import { memo, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useI18n } from '../../i18n';

import { haptics } from '../../utils/haptic';
import './section-art.css';

export type AresTab = 'main' | 'market' | 'stats' | 'profile' | 'operation';

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

/**
 * Пульт секций (MK-редизайн, 2026-09-28): вместо плоской панели иконок —
 * ряд клавиш пульта. Активная клавиша защёлкнута в нажатом положении
 * (mk-key--engaged: утоплена, грань подсвечена), над ней горит лампа реле.
 * Пропсы: `active` / `onChange`. Динамический i18n перевод на всех языках.
 */
export const AresBottomNav = memo(function AresBottomNav({
 active,
 onChange,
}: AresBottomNavProps): JSX.Element {
 const reducedMotion = useReducedMotion();
 const { t, lang } = useI18n();

 const navItems: NavItem[] = useMemo(() => [
  { id: 'main', label: t('АГРО'), code: 'K1', lamp: 'green' },
  { id: 'market', label: t('СНАБ'), code: 'K2', lamp: 'amber' },
  { id: 'stats', label: t('ЖУРНАЛ'), code: 'K3', lamp: 'amber' },
  { id: 'profile', label: t('КАЮТА'), code: 'K4', lamp: 'green' },
  { id: 'operation', label: t('ОПЕРАЦИЯ'), code: 'K5', lamp: 'magenta' },
 ], [t, lang]);

 return (
  <div className="hull-nav-wrap">
   <nav className="hull-panel hull-nav ship-nav" aria-label={t("Разделы колонии")}>
    <div className="hull-panel-content">
     {navItems.map((item) => {
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
        <img className="ship-nav-icon" src={item.id === 'main' ? '/ares/icons/sprout.webp' : item.id === 'market' ? '/ares/icons/crate.webp' : item.id === 'stats' ? '/ares/icons/clipboard.webp' : item.id === 'profile' ? '/ares/icons/bunk.webp' : '/ares/icons/license.webp'} alt="" aria-hidden="true" />
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
