import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export function usePrefersReducedMotion(): boolean {
 const [reduced, setReduced] = useState(false);
 useEffect(() => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  setReduced(query.matches);
  const listener = (event: MediaQueryListEvent): void => setReduced(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
 }, []);
 return reduced;
}

export interface ParticleBurstProps {
 x: number;
 y: number;
 color: string;
 count?: number;
 onDone?: () => void;
}

interface BurstParticle {
 id: number;
 angle: number;
 distance: number;
 scale: number;
 delay: number;
}

const MAX_BURST_PARTICLES = 30;

function buildBurstParticles(count: number): BurstParticle[] {
 const clamped = Math.min(count, MAX_BURST_PARTICLES);
 return Array.from({ length: clamped }, (_, index) => ({
  id: index,
  angle: (Math.PI * 2 * index) / clamped + Math.random() * 0.4,
  distance: 24 + Math.random() * 28,
  scale: 0.5 + Math.random() * 0.7,
  delay: Math.random() * 0.08,
 }));
}

export const ParticleBurst = memo(function ParticleBurst({
 x,
 y,
 color,
 count = 14,
 onDone,
}: ParticleBurstProps): JSX.Element {
 const particles = useMemo(() => buildBurstParticles(count), [count]);

 return (
  <div
   aria-hidden="true"
   style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, pointerEvents: 'none' }}
  >
   {particles.map((particle) => {
    const dx = Math.cos(particle.angle) * particle.distance;
    const dy = Math.sin(particle.angle) * particle.distance;
    return (
     <motion.span
      key={particle.id}
      initial={{ opacity: 1, x: 0, y: 0, scale: particle.scale }}
      animate={{ opacity: 0, x: dx, y: dy, scale: particle.scale * 0.3 }}
      transition={{ duration: 0.5, delay: particle.delay, ease: 'easeOut' }}
      onAnimationComplete={particle.id === particles.length - 1 ? onDone : undefined}
      style={{
       position: 'absolute',
       width: 5,
       height: 5,
       borderRadius: '50%',
       background: color,
       boxShadow: `0 0 6px ${color}`,
      }}
     />
    );
   })}
  </div>
 );
});

export interface Point2D {
 x: number;
 y: number;
}

export interface BezierFlightProps {
 from: Point2D;
 to: Point2D;
 onDone?: () => void;
 sprite: ReactNode;
 duration?: number;
}

export const BezierFlight = memo(function BezierFlight({
 from,
 to,
 onDone,
 sprite,
 duration = 0.6,
}: BezierFlightProps): JSX.Element {
 const midX = (from.x + to.x) / 2;
 const liftY = Math.min(from.y, to.y) - 60;

 return (
  <motion.div
   aria-hidden="true"
   initial={{ x: from.x, y: from.y, opacity: 1, scale: 1 }}
   animate={{
    x: [from.x, midX, to.x],
    y: [from.y, liftY, to.y],
    opacity: [1, 1, 0.9],
    scale: [1, 1.1, 0.6],
   }}
   transition={{ duration, ease: 'easeInOut' }}
   onAnimationComplete={onDone}
   style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
  >
   {sprite}
  </motion.div>
 );
});

export interface MistSprayProps {
 active: boolean;
}

interface MistParticle {
 id: number;
 offsetX: number;
 delay: number;
}

const MIST_PARTICLES: MistParticle[] = Array.from({ length: 12 }, (_, index) => ({
 id: index,
 offsetX: (index - 5.5) * 6,
 delay: index * 0.02,
}));

export const MistSpray = memo(function MistSpray({ active }: MistSprayProps): JSX.Element | null {
 if (!active) return null;
 return (
  <div
   aria-hidden="true"
   style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
  >
   {MIST_PARTICLES.map((particle) => (
    <motion.span
     key={particle.id}
     initial={{ opacity: 0, y: 0, x: particle.offsetX }}
     animate={{ opacity: [0, 0.5, 0], y: -30 }}
     transition={{ duration: 0.9, delay: particle.delay, ease: 'easeOut' }}
     style={{
      position: 'absolute',
      left: '50%',
      bottom: '30%',
      width: 3,
      height: 10,
      borderRadius: 2,
      background: 'rgba(180,220,255,0.55)',
     }}
    />
   ))}
  </div>
 );
});

export interface CondensationWipeProps {
 trigger: number;
}

export const CondensationWipe = memo(function CondensationWipe({
 trigger,
}: CondensationWipeProps): JSX.Element {
 return (
  <AnimatePresence>
   <motion.div
    key={trigger}
    aria-hidden="true"
    initial={{ x: '-100%', opacity: 0.9 }}
    animate={{ x: '100%', opacity: 0 }}
    transition={{ duration: 0.7, ease: 'easeInOut' }}
    style={{
     position: 'absolute',
     inset: 0,
     background:
      'linear-gradient(100deg, transparent, rgba(180,220,255,0.35), transparent)',
     pointerEvents: 'none',
    }}
   />
  </AnimatePresence>
 );
});

export interface HexShieldProps {
 active: boolean;
 color?: string;
}

export const HexShield = memo(function HexShield({
 active,
 color = 'var(--ares-bio-cyan, #12E7C4)',
}: HexShieldProps): JSX.Element | null {
 if (!active) return null;
 return (
  <motion.div
   aria-hidden="true"
   initial={{ opacity: 0, scale: 0.8 }}
   animate={{ opacity: [0, 0.6, 0], scale: [0.8, 1.15, 1.3] }}
   transition={{ duration: 0.6, ease: 'easeOut' }}
   style={{
    position: 'absolute',
    inset: 0,
    border: `1.5px solid ${color}`,
    clipPath:
     'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
    pointerEvents: 'none',
   }}
  />
 );
});

export interface BreathingGlowProps {
 color: string;
 active: boolean;
 children?: ReactNode;
}

export const BreathingGlow = memo(function BreathingGlow({
 color,
 active,
 children,
}: BreathingGlowProps): JSX.Element {
 const reducedMotion = usePrefersReducedMotion();
 const shouldAnimate = active && !reducedMotion;
 return (
  <motion.div
   className={shouldAnimate ? 'ares-anim' : undefined}
   animate={
    shouldAnimate
     ? { opacity: [0.7, 1, 0.7], scale: [1, 1.03, 1] }
     : { opacity: 1, scale: 1 }
   }
   transition={shouldAnimate ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } : undefined}
   style={{ filter: `drop-shadow(0 0 6px ${color})` }}
  >
   {children}
  </motion.div>
 );
});

export interface StarFieldProps {
 count?: number;
}

interface Star {
 id: number;
 top: number;
 left: number;
 size: number;
 delay: number;
}

function buildStars(count: number): Star[] {
 const clamped = Math.min(count, MAX_BURST_PARTICLES);
 return Array.from({ length: clamped }, (_, index) => ({
  id: index,
  top: Math.random() * 100,
  left: Math.random() * 100,
  size: Math.random() < 0.15 ? 2 : 1,
  delay: Math.random() * 3,
 }));
}

export const StarField = memo(function StarField({ count = 24 }: StarFieldProps): JSX.Element {
 const stars = useMemo(() => buildStars(count), [count]);
 const reducedMotion = usePrefersReducedMotion();
 return (
  <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
   {stars.map((star) =>
    reducedMotion ? (
     <span
      key={star.id}
      style={{
       position: 'absolute',
       top: `${star.top}%`,
       left: `${star.left}%`,
       width: star.size,
       height: star.size,
       borderRadius: '50%',
       background: '#FFFFFF',
       opacity: 0.6,
      }}
     />
    ) : (
     <motion.span
      key={star.id}
      animate={{ opacity: [0.2, 1, 0.2] }}
      transition={{ duration: 2.4, delay: star.delay, repeat: Infinity, ease: 'easeInOut' }}
      style={{
       position: 'absolute',
       top: `${star.top}%`,
       left: `${star.left}%`,
       width: star.size,
       height: star.size,
       borderRadius: '50%',
       background: '#FFFFFF',
      }}
     />
    )
   )}
  </div>
 );
});

export interface PhobosTransitProps {
 active: boolean;
}

export const PhobosTransit = memo(function PhobosTransit({
 active,
}: PhobosTransitProps): JSX.Element | null {
 if (!active) return null;
 return (
  <motion.div
   aria-hidden="true"
   initial={{ x: '-10%', y: '8%', opacity: 0 }}
   animate={{ x: '110%', y: '2%', opacity: [0, 1, 1, 0] }}
   transition={{ duration: 9, ease: 'linear' }}
   style={{
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: '46% 54% 60% 40% / 50% 45% 55% 50%',
    background: '#9AA0AC',
    boxShadow: 'inset -2px -2px 3px rgba(0,0,0,0.5)',
    pointerEvents: 'none',
   }}
  />
 );
});

export interface DustStormProps {
 active: boolean;
}

export const DustStorm = memo(function DustStorm({ active }: DustStormProps): JSX.Element | null {
 if (!active) return null;
 return (
  <motion.div
   aria-hidden="true"
   className="ares-anim"
   initial={{ opacity: 0 }}
   animate={{ opacity: [0, 0.55, 0.4, 0.55, 0] }}
   transition={{ duration: 6, ease: 'easeInOut' }}
   style={{
    position: 'absolute',
    inset: 0,
    background:
     'linear-gradient(100deg, rgba(193,68,14,0.05), rgba(193,68,14,0.5), rgba(193,68,14,0.05))',
    pointerEvents: 'none',
   }}
  />
 );
});

export interface ScanRingProps {
 active: boolean;
 color?: string;
}

export const ScanRing = memo(function ScanRing({
 active,
 color = 'var(--ares-hud-amber, #FFB347)',
}: ScanRingProps): JSX.Element | null {
 if (!active) return null;
 return (
  <motion.div
   aria-hidden="true"
   initial={{ opacity: 0, scale: 0.4 }}
   animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1, 1, 1.1] }}
   transition={{ duration: 0.9, ease: 'easeOut' }}
   style={{
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: `2px solid ${color}`,
    boxShadow: `0 0 12px ${color}`,
    pointerEvents: 'none',
   }}
  />
 );
});

export function useLongPress(onLongPress: () => void, delayMs = 600): {
 onPointerDown: () => void;
 onPointerUp: () => void;
 onPointerLeave: () => void;
} {
 const timerRef = useRef<number | null>(null);

 const clear = (): void => {
  if (timerRef.current !== null) {
   window.clearTimeout(timerRef.current);
   timerRef.current = null;
  }
 };

 const onPointerDown = (): void => {
  clear();
  timerRef.current = window.setTimeout(onLongPress, delayMs);
 };

 useEffect(() => clear, []);

 return { onPointerDown, onPointerUp: clear, onPointerLeave: clear };
}

export function useDoubleTap(onDoubleTap: () => void, maxDelayMs = 300): () => void {
 const lastTapRef = useRef(0);
 return (): void => {
  const now = Date.now();
  if (now - lastTapRef.current < maxDelayMs) {
   onDoubleTap();
   lastTapRef.current = 0;
  } else {
   lastTapRef.current = now;
  }
 };
}

export function useHoldProgress(durationMs = 900): {
 progress: number;
 holding: boolean;
 start: () => void;
 cancel: () => void;
} {
 const [progress, setProgress] = useState(0);
 const [holding, setHolding] = useState(false);
 const rafRef = useRef<number | null>(null);
 const startTimeRef = useRef(0);

 const cancel = (): void => {
  if (rafRef.current !== null) {
   window.cancelAnimationFrame(rafRef.current);
   rafRef.current = null;
  }
  setHolding(false);
  setProgress(0);
 };

 const start = (): void => {
  setHolding(true);
  startTimeRef.current = performance.now();
  const step = (now: number): void => {
   const elapsed = now - startTimeRef.current;
   const next = Math.min(1, elapsed / durationMs);
   setProgress(next);
   if (next < 1) {
    rafRef.current = window.requestAnimationFrame(step);
   }
  };
  rafRef.current = window.requestAnimationFrame(step);
 };

 useEffect(() => {
  return () => {
   if (rafRef.current !== null) {
    window.cancelAnimationFrame(rafRef.current);
   }
  };
 }, []);

 return { progress, holding, start, cancel };
}
