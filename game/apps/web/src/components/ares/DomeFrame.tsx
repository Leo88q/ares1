import { memo, useMemo, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import type { SolPhase } from '../../theme/ares';
import { StarField, PhobosTransit, DustStorm, usePrefersReducedMotion } from './effects';

export interface DomeFrameProps {
 children: ReactNode;
 phase: SolPhase;
 dustStormActive?: boolean;
 hud?: ReactNode;
 label?: string;
 className?: string;
}

interface PhaseVisuals {
 skyTop: string;
 skyBottom: string;
 domeTint: string;
 lampGlow: number;
 imgFilter: string;
}

const PHASE_VISUALS: Record<SolPhase, PhaseVisuals> = {
 dawn:  { skyTop: '#3A2A4A', skyBottom: '#FFB347', domeTint: 'rgba(232,106,60,0.10)', lampGlow: 0.55, imgFilter: 'none' },
 day:   { skyTop: '#D9A06B', skyBottom: '#E8C39A', domeTint: 'rgba(217,160,107,0.08)', lampGlow: 0.35, imgFilter: 'none' },
 blueset: { skyTop: '#2B3B63', skyBottom: '#6B93D6', domeTint: 'rgba(107,147,214,0.14)', lampGlow: 0.5, imgFilter: 'none' },
 night:  { skyTop: '#050308', skyBottom: '#130A1E', domeTint: 'rgba(232,106,60,0.18)', lampGlow: 0.85, imgFilter: 'none' },
};

const BAND_HEIGHT = 190;

interface ParallaxLayerProps {
 src: string;
 fallback: ReactNode;
 filter?: string;
}

const ParallaxLayer = memo(function ParallaxLayer({ src, fallback, filter }: ParallaxLayerProps): JSX.Element {
 const [failed, setFailed] = useState(false);
 return (
  <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', willChange: 'transform' }}>
   {failed ? fallback : (
    <img src={src} alt="" onError={() => setFailed(true)}
     style={{ position: 'absolute', left: '-10%', width: '120%', height: '100%', objectFit: 'cover', objectPosition: 'center 62%', filter, transition: 'filter 0.8s ease' }} />
   )}
  </div>
 );
});

function BandMedia({ filter }: { filter: string }): JSX.Element {
 const reducedMotion = usePrefersReducedMotion();
 const [videoFailed, setVideoFailed] = useState(false);
 const showVideo = !reducedMotion && !videoFailed;
 return (
  <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
   {showVideo ? (
    <video
     src="/ares/plantation.mp4"
     poster="/ares/plantation.webp"
     autoPlay
     muted
     loop
     playsInline
     preload="metadata"
     onError={() => setVideoFailed(true)}
     style={{ position: 'absolute', left: '-10%', width: '120%', height: '100%', objectFit: 'cover', objectPosition: 'center 62%', filter, transition: 'filter 0.8s ease' }}
    />
   ) : (
    <ParallaxLayer src="/ares/plantation.webp" fallback={<BandFallback />} filter={filter} />
   )}
  </div>
 );
}

function BandFallback(): JSX.Element {
 return (
  <svg viewBox="0 0 400 120" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
   <path d="M0 92 Q50 64 110 80 T230 72 T330 82 T400 76 V120 H0 Z" fill="#8A2E08" />
   <path d="M282 78 Q300 56 318 78 Z" fill="rgba(232,106,60,0.30)" />
   <circle cx="300" cy="70" r="2" fill="#E86A3C" opacity="0.9" />
   <path d="M0 104 Q55 88 115 100 T235 94 T345 102 T400 98 V120 H0 Z" fill="#C1440E" />
   <ellipse cx="70" cy="110" rx="7" ry="3" fill="#8A2E08" />
   <ellipse cx="330" cy="112" rx="9" ry="3.4" fill="#8A2E08" />
  </svg>
 );
}

interface CondensationDrop { id: number; left: number; top: number; size: number; }
function buildDrops(count: number): CondensationDrop[] {
 return Array.from({ length: count }, (_, i) => ({ id: i, left: Math.random() * 100, top: Math.random() * 55, size: 2 + Math.random() * 4 }));
}
const CONDENSATION_DROPS = buildDrops(14);

const GlassArc = memo(function GlassArc({ tint }: { tint: string }): JSX.Element {
 return (
  <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '60%', pointerEvents: 'none', overflow: 'hidden' }}>
   <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, rgba(255,255,255,0.10), ${tint} 55%, transparent)` }} />
   <div style={{ position: 'absolute', top: '8%', left: '10%', width: '30%', height: '22%', borderRadius: '50%', background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.22), transparent 70%)', filter: 'blur(2px)' }} />
   {CONDENSATION_DROPS.map((d) => (
    <span key={d.id} style={{ position: 'absolute', left: `${d.left}%`, top: `${d.top}%`, width: d.size, height: d.size * 1.3, borderRadius: '50%', background: 'rgba(200,225,255,0.22)', boxShadow: 'inset -1px -1px 1px rgba(255,255,255,0.35)' }} />
   ))}
  </div>
 );
});

const PARALLAX_MAX_OFFSET = 12;

export const DomeFrame = memo(function DomeFrame({ children, phase, dustStormActive = false, hud, className }: DomeFrameProps): JSX.Element {
 const visuals = useMemo(() => PHASE_VISUALS[phase], [phase]);
 const bandRef = useRef<HTMLDivElement | null>(null);
 const pointerX = useMotionValue(0);
 const smoothX = useSpring(pointerX, { stiffness: 60, damping: 18 });
 const farX = useTransform(smoothX, (v) => v * 0.6);

 const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
  const band = bandRef.current;
  if (!band) return;
  const rect = band.getBoundingClientRect();
  const relative = (event.clientX - rect.left) / rect.width - 0.5;
  pointerX.set(Math.max(-1, Math.min(1, relative)) * PARALLAX_MAX_OFFSET);
 };

 return (
  <div className={className} style={{ position: 'relative', minHeight: '100%', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
   {/* ОКНО-ИЛЛЮМИНАТОР: живая плантация */}
   <div ref={bandRef} onPointerMove={handlePointerMove}
    style={{ position: 'relative', height: BAND_HEIGHT, flexShrink: 0, overflow: 'hidden', background: `linear-gradient(180deg, ${visuals.skyTop}, ${visuals.skyBottom})` }}>
    <motion.div style={{ x: farX, position: 'absolute', inset: 0 }}>
     <BandMedia filter={visuals.imgFilter} />
    </motion.div>
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
     {phase === 'night' ? <StarField count={22} /> : null}
     {phase === 'night' ? <PhobosTransit active /> : null}
     <DustStorm active={dustStormActive} />
    </div>
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 88%, ${visuals.domeTint}, transparent 70%)`, opacity: visuals.lampGlow, pointerEvents: 'none' }} />
    <GlassArc tint={visuals.domeTint} />
    {hud ? (
     <div style={{ position: 'absolute', left: 12, right: 12, bottom: 18, display: 'flex', justifyContent: 'flex-end' }}>{hud}</div>
    ) : null}
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 -22px 30px -20px rgba(5,3,8,0.95)', pointerEvents: 'none' }} />
   </div>

   {/* ПАНЕЛЬ ОБИТАНИЯ: полупрозрачное стекло поверх интерьера */}
   <div style={{ position: 'relative', flex: 1, zIndex: 1, marginTop: -16, borderRadius: '20px 20px 0 0', background: 'linear-gradient(180deg, rgba(12,7,16,0.32) 0%, rgba(5,3,8,0.42) 40%, rgba(5,3,8,0.58) 100%)', borderTop: '1px solid rgba(180,220,255,0.14)', boxShadow: '0 -8px 30px rgba(0,0,0,0.5)' }}>
    {children}
   </div>
  </div>
 );
});
