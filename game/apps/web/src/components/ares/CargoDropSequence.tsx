import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ParticleBurst, usePrefersReducedMotion } from './effects';

export type CargoDropStage = 'falling' | 'impact' | 'done';

export interface CargoDropSequenceProps {
 active: boolean;
 onComplete: () => void;
 fallDurationMs?: number;
}

const IMPACT_VISIBLE_MS = 500;

export const CargoDropSequence = memo(function CargoDropSequence({
 active,
 onComplete,
 fallDurationMs = 1400,
}: CargoDropSequenceProps): JSX.Element | null {
 const reducedMotion = usePrefersReducedMotion();
 const [stage, setStage] = useState<CargoDropStage>('falling');

 useEffect(() => {
  if (!active) {
   setStage('falling');
   return undefined;
  }
  const fallMs = reducedMotion ? 200 : fallDurationMs;
  const fallTimer = window.setTimeout(() => setStage('impact'), fallMs);
  return () => window.clearTimeout(fallTimer);
 }, [active, fallDurationMs, reducedMotion]);

 useEffect(() => {
  if (stage !== 'impact') return undefined;
  const impactMs = reducedMotion ? 100 : IMPACT_VISIBLE_MS;
  const impactTimer = window.setTimeout(() => {
   setStage('done');
   onComplete();
  }, impactMs);
  return () => window.clearTimeout(impactTimer);
 }, [stage, onComplete, reducedMotion]);

 if (!active || stage === 'done') return null;

 return (
  <div
   style={{
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 5,
   }}
  >
   <AnimatePresence>
    {stage === 'falling' ? (
     <motion.div
      key="parachute"
      initial={{ y: '-40%', x: 0, opacity: 0 }}
      animate={{ y: '58%', x: [0, 10, -10, 6, 0], opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: (reducedMotion ? 200 : fallDurationMs) / 1000, ease: 'easeIn' }}
      style={{ position: 'absolute' }}
     >
      <svg width={48} height={64} viewBox="0 0 48 64">
       <path
        d="M4 20 Q24 2 44 20 Q34 14 24 16 Q14 14 4 20 Z"
        fill="var(--ares-hud-amber, #FFB347)"
        opacity={0.9}
       />
       <line x1="6" y1="20" x2="18" y2="44" stroke="rgba(255,179,71,0.6)" strokeWidth="1" />
       <line x1="42" y1="20" x2="30" y2="44" stroke="rgba(255,179,71,0.6)" strokeWidth="1" />
       <rect x="16" y="44" width="16" height="12" rx="2" fill="var(--ares-metal-light, #4A4F5A)" />
      </svg>
     </motion.div>
    ) : null}
   </AnimatePresence>

   {stage === 'impact' ? (
    <div style={{ position: 'absolute', bottom: '20%' }}>
     <ParticleBurst x={0} y={0} color="var(--ares-rust, #C1440E)" count={20} />
    </div>
   ) : null}
  </div>
 );
});
