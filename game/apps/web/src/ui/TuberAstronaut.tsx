import { useId } from 'react';
import { motion } from 'framer-motion';
import { usePrefersReducedMotion } from '../components/ares/effects';
import { RollingNumber } from './RollingNumber';

/** Тот самый прыгающий астронавт-картофелина с лендинга (ТЮБЕР-9) */
export function TuberAstronaut({ size = 220, jumping = true }: { size?: number; jumping?: boolean }): JSX.Element {
 const id = useId().replace(/:/g, '');
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
   <svg viewBox="0 0 420 460" width="100%" aria-hidden="true" focusable="false">
    <defs>
     <linearGradient id={`${id}-suit`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="#ffbd62" />
      <stop offset=".45" stopColor="#f47c23" />
      <stop offset="1" stopColor="#b63e16" />
     </linearGradient>
     <radialGradient id={`${id}-visor`} cx="35%" cy="20%">
      <stop stopColor="#434367" />
      <stop offset="1" stopColor="#0b0d20" />
     </radialGradient>
     <linearGradient id={`${id}-potato`} x2=".8" y2="1">
      <stop stopColor="#efc689" />
      <stop offset="1" stopColor="#bb7e49" />
     </linearGradient>
    </defs>

    <rect x="102" y="193" width="215" height="152" rx="40" fill="#57343a" stroke="#ab6953" strokeWidth="7" />
    <path d="M139 326 127 400c-2 27 58 31 61 6l18-70M222 336l16 67c7 30 65 18 57-7l-22-74" fill={`url(#${id}-suit)`} stroke="#6c352b" strokeWidth="5" />
    <path d="M123 393c-30 25-9 41 38 33l28-9-4-27M236 395l4 23c24 15 77 13 69-9l-17-21" fill="#292b38" stroke="#6f6671" strokeWidth="5" />
    <path d="M128 226c-27-4-43 17-57 45l-24 29c-15 21 15 45 35 27l31-32 29-37M290 226c21-5 35-28 42-48l7-22c8-24 43-12 38 12l-9 37c-11 42-35 71-65 74" fill={`url(#${id}-suit)`} stroke="#6c352b" strokeWidth="5" />
    <path d="m46 292-9 13c-17 25 12 46 34 27l13-12M337 162l-1-18c0-20 29-28 40-10l8 15c10 18-1 32-12 35" fill="#30323f" stroke="#74707b" strokeWidth="5" />

    <path d="M128 211c-12 24-20 86-2 122 17 35 136 40 166 0 18-25 8-99-8-122Z" fill={`url(#${id}-suit)`} stroke="#6c352b" strokeWidth="6" />
    <path d="M160 233v105m100-105v105" stroke="#ffc686" strokeWidth="8" />
    <path d="M126 302h170" stroke="#4b3a44" strokeWidth="15" />
    <rect x="174" y="250" width="72" height="69" rx="10" fill="#333341" stroke="#d2b3a0" strokeWidth="4" />
    <rect x="186" y="262" width="47" height="18" rx="3" fill="#102522" />
    <path d="M190 272h7l4-5 7 9 5-6h16" fill="none" stroke="#7cff6b" strokeWidth="2" />
    <circle cx="190" cy="297" r="5" fill="#7cff6b" />
    <circle cx="209" cy="297" r="5" fill="#ffb347" />
    <circle cx="229" cy="297" r="5" fill="#ff2e93" />

    <circle cx="207" cy="158" r="108" fill="#e1d8d4" stroke="#71636d" strokeWidth="7" />
    <circle cx="207" cy="158" r="92" fill={`url(#${id}-visor)`} stroke="#2d2b3e" strokeWidth="7" />
    <path d="M159 169c-14-63 30-94 63-75 24 12 44 43 43 76-1 43-91 54-106-1Z" fill={`url(#${id}-potato)`} />
    <g fill="#a66b42" opacity=".6">
     <ellipse cx="180" cy="123" rx="4" ry="3" />
     <ellipse cx="244" cy="170" rx="4" ry="5" />
     <ellipse cx="183" cy="182" rx="3" ry="4" />
     <ellipse cx="219" cy="110" rx="3" ry="2" />
    </g>
    <ellipse cx="190" cy="150" rx="7" ry="10" fill="#241728" />
    <ellipse cx="229" cy="150" rx="7" ry="10" fill="#241728" />
    <circle cx="192" cy="147" r="2" fill="white" />
    <circle cx="231" cy="147" r="2" fill="white" />
    <path d="M195 177q15 17 30-2" fill="none" stroke="#6a3536" strokeWidth="4" strokeLinecap="round" />
    <path d="M151 117c13-26 32-36 54-37" stroke="white" strokeOpacity=".5" strokeWidth="9" strokeLinecap="round" fill="none" />

    <rect x="94" y="137" width="21" height="46" rx="8" fill="#827b87" />
    <rect x="300" y="137" width="21" height="46" rx="8" fill="#827b87" />
    <path d="M310 135V75" stroke="#bab0bc" strokeWidth="5" />
    <circle cx="310" cy="70" r="7" fill="#7cff6b" />
   </svg>
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
   <div className="astronaut-loader-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? 'Загрузка колонии'}>
    <div className="astronaut-loader-fill" style={{ width: `${pct}%` }} />
   </div>
   <div className="astronaut-loader-meta">
    <span>{label ?? 'РАСПАКОВКА ГИДРОПОНИКИ'}</span>
    <strong>
     <RollingNumber value={pct} minimumDigits={2} />%
    </strong>
   </div>
  </div>
 );
}
