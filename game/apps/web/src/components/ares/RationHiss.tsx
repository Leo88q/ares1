import { memo, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export interface RationHissProps {
 trigger: number;
 children: ReactNode;
}

interface HissParticle {
 id: number;
 angle: number;
 distance: number;
 delay: number;
}

const HISS_PARTICLE_COUNT = 16;

function buildHissParticles(): HissParticle[] {
 return Array.from({ length: HISS_PARTICLE_COUNT }, (_, index) => ({
  id: index,
  angle: -40 + Math.random() * 80,
  distance: 18 + Math.random() * 26,
  delay: Math.random() * 0.1,
 }));
}

export const RationHiss = memo(function RationHiss({ trigger, children }: RationHissProps): JSX.Element {
 const [particles, setParticles] = useState<HissParticle[]>([]);
 const [shaking, setShaking] = useState(false);
 const shakeTimerRef = useRef<number | null>(null);
 const isFirstRenderRef = useRef(true);

 useEffect(() => {
  if (isFirstRenderRef.current) {
   isFirstRenderRef.current = false;
   return undefined;
  }
  setParticles(buildHissParticles());
  setShaking(true);
  if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
  shakeTimerRef.current = window.setTimeout(() => setShaking(false), 320);
  return undefined;
 }, [trigger]);

 useEffect(() => {
  return () => {
   if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
  };
 }, []);

 return (
  <motion.div
   animate={shaking ? { x: [0, -2, 2, -1, 1, 0] } : { x: 0 }}
   transition={{ duration: 0.3 }}
   style={{ position: 'relative', display: 'inline-block' }}
  >
   {children}

   <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
    {particles.map((particle) => {
     const radians = (particle.angle * Math.PI) / 180;
     const dx = Math.sin(radians) * particle.distance;
     const dy = -Math.cos(radians) * particle.distance;
     return (
      <motion.span
       key={particle.id}
       initial={{ opacity: 0.8, x: 0, y: 0, scale: 0.6 }}
       animate={{ opacity: 0, x: dx, y: dy, scale: 1.1 }}
       transition={{ duration: 0.5, delay: particle.delay, ease: 'easeOut' }}
       style={{
        position: 'absolute',
        width: 4,
        height: 4,
        borderRadius: '50%',
        background: 'rgba(200,225,255,0.6)',
        filter: 'blur(0.5px)',
       }}
      />
     );
    })}
   </div>
  </motion.div>
 );
});
