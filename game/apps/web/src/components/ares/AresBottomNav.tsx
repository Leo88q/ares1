import { memo, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useI18n } from '../../i18n';

import { haptics } from '../../utils/haptic';
import './section-art.css';

export type AresTab = 'main' | 'lab' | 'colony' | 'market' | 'stats' | 'profile' | 'operation';

/** Настоящие иконки секций (те же файлы, что в ресурсах игры), по одной на клавишу. */
const NAV_ICON: Record<AresTab, string> = {
  main: '/ares/icons/sprout.webp',
  lab: '/ares/icons/gauge.webp',
  colony: '/ares/icons/gear.webp',
  market: '/ares/icons/crate.webp',
  stats: '/ares/icons/clipboard.webp',
  profile: '/ares/icons/bunk.webp',
  operation: '/ares/icons/license.webp',
};

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
 * Пульт секций (MK-редизайн, 2026-09-28; +ЛАБ 2026-10-17): вместо плоской панели
 * иконок — ряд клавиш пульта. Активная клавиша защёлкнута в нажатом положении
 * (mk-key--engaged: утоплена, грань подсвечена), над ней горит лампа реле.
 * Пропсы: `active` / `onChange`. Динамический i18n перевод на всех языках.
 */
export const AresBottomNav = memo(function AresBottomNav({
 active,
 onChange,
}: AresBottomNavProps): JSX.Element {
 const reducedMotion = useReducedMotion();
 const { t, lang } = useI18n();

 // Семь клавиш пульта (2026-10-17): ЛАБ — продуктовая полевая лаборатория /lab.
 const navItems: NavItem[] = useMemo(() => [
  { id: 'main', label: t('АГРО'), code: 'K1', lamp: 'green' },
  { id: 'lab', label: t('ЛАБ'), code: 'K2', lamp: 'amber' },
  { id: 'colony', label: t('КОЛОНИЯ'), code: 'K3', lamp: 'green' },
  { id: 'market', label: t('СНАБ'), code: 'K4', lamp: 'amber' },
  { id: 'stats', label: t('ЖУРНАЛ'), code: 'K5', lamp: 'amber' },
  { id: 'profile', label: t('КАЮТА'), code: 'K6', lamp: 'green' },
  { id: 'operation', label: t('ОПЕРАЦИЯ'), code: 'K7', lamp: 'magenta' },
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
        <img className="ship-nav-icon" src={NAV_ICON[item.id]} alt="" aria-hidden="true" />
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
