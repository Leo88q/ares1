import { motion } from 'framer-motion';
import { t } from '../i18n';
import { usePrefersReducedMotion } from '../components/ares/effects';
import { RollingNumber } from './RollingNumber';

/** Тот самый прыгающий астронавт-картофелина с лендинга (ТЮБЕР-9) */
export function TuberAstronaut({ size = 220, jumping = true }: { size?: number; jumping?: boolean }): JSX.Element {
 const reduced = usePrefersReducedMotion();
 const animate = jumping && !reduced;

 return (
  <motion.div
   style={{ width: size, transformOrigin: '50% 92%' }}
   animate={
    animate
     ? { y: [0, -18, 0], scaleY: [1, 1.06, 0.94, 1], scaleX: [1, 0.96, 1.05, 1] }
     : { y: 0, scaleY: 1, scaleX: 1 }
   }
   transition={
    animate
     ? { duration: 1.15, repeat: Infinity, ease: [0.33, 0, 0.67, 1], times: [0, 0.42, 0.72, 1] }
     : { duration: 0 }
   }
  >
   <img
     src="/ares/tuber9-happy.webp"
     alt=""
     aria-hidden="true"
     style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
    />
  </motion.div>
 );
}

/** Астронавт + hull-индикатор загрузки вместо смайла картошки */
export function AstronautLoader({ progress, label }: { progress: number; label?: string }): JSX.Element {
 const pct = Math.max(0, Math.min(100, Math.round(progress)));

 return (
  <div className="astronaut-loader">
   <div className="astronaut-loader-shadow" aria-hidden="true" />
   <TuberAstronaut size={210} jumping />
   <div className="astronaut-loader-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? t('Загрузка колонии')}>
    <div className="astronaut-loader-fill" style={{ width: `${pct}%` }} />
   </div>
   <div className="astronaut-loader-meta">
    <span>{label ?? t('РАСПАКОВКА ГИДРОПОНИКИ')}</span>
    <strong>
     <RollingNumber value={pct} minimumDigits={2} />%
    </strong>
   </div>
  </div>
 );
}
