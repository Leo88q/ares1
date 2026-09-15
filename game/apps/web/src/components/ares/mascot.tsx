import { memo, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n'

import { AnimatePresence, motion } from 'framer-motion';
import { ParticleBurst } from './effects';
import { IconEarth } from './icons';

export type TuberMood = 'happy' | 'warn' | 'sleep' | 'jump';

export interface Tuber9Props {
 mood: TuberMood;
 size?: number;
 onEasterEgg?: () => void;
 className?: string;
}

const MOOD_IMAGE: Record<TuberMood, string> = {
 happy: '/ares/tuber9-happy.png',
 warn: '/ares/tuber9-warn.png',
 sleep: '/ares/tuber9-sleep.png',
 jump: '/ares/tuber9-jump.png',
};

const VISOR_COLOR: Record<TuberMood, string> = {
 happy: 'var(--ares-bio-green, #7CFF6B)',
 warn: 'var(--ares-hud-amber, #FFB347)',
 sleep: 'rgba(180,220,255,0.35)',
 jump: 'var(--ares-grow-pink, #FF2E93)',
};

const JUMP_OVERRIDE_MS = 480;
const TAP_WINDOW_MS = 1500;
const EASTER_EGG_TAP_COUNT = 5;

interface TuberFallbackProps {
 mood: TuberMood;
 size: number;
}

function TuberFallback({ mood, size }: TuberFallbackProps): JSX.Element {
 const visor = VISOR_COLOR[mood];
 const bounce = mood === 'jump';
 const asleep = mood === 'sleep';

 return (
  <svg
   width={size}
   height={size}
   viewBox="0 0 64 64"
   style={{ transform: bounce ? 'translateY(-4px)' : undefined }}
  >
   <ellipse cx="32" cy="40" rx="18" ry="15" fill="#FFB347" />
   <circle cx="26" cy="36" r="1.6" fill="#8A2E08" />
   <circle cx="36" cy="38" r="1.4" fill="#8A2E08" />
   <circle cx="30" cy="44" r="1.4" fill="#8A2E08" />
   <circle cx="32" cy="34" r="20" fill="rgba(180,220,255,0.16)" stroke="rgba(180,220,255,0.5)" strokeWidth="1.5" />
   <circle cx="24" cy="26" r="3" fill="rgba(255,255,255,0.4)" />
   {asleep ? (
    <text x="40" y="18" fontSize="10" fill={visor}>Z</text>
   ) : (
    <circle cx="32" cy="34" r="4" fill={visor} opacity={0.9} />
   )}
  </svg>
 );
}

export const Tuber9 = memo(function Tuber9({
 mood,
 size = 72,
 onEasterEgg,
 className,
}: Tuber9Props): JSX.Element {
 const [imageFailed, setImageFailed] = useState(false);
 const [jumpOverride, setJumpOverride] = useState(false);
 const [burstKey, setBurstKey] = useState<number | null>(null);
 const tapCountRef = useRef(0);
 const tapWindowTimerRef = useRef<number | null>(null);
 const jumpTimerRef = useRef<number | null>(null);

 useEffect(() => {
  return () => {
   if (tapWindowTimerRef.current !== null) window.clearTimeout(tapWindowTimerRef.current);
   if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current);
  };
 }, []);

 const handleTap = (): void => {
  setJumpOverride(true);
  if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current);
  jumpTimerRef.current = window.setTimeout(() => setJumpOverride(false), JUMP_OVERRIDE_MS);

  tapCountRef.current += 1;
  if (tapWindowTimerRef.current !== null) window.clearTimeout(tapWindowTimerRef.current);
  tapWindowTimerRef.current = window.setTimeout(() => {
   tapCountRef.current = 0;
  }, TAP_WINDOW_MS);

  if (tapCountRef.current >= EASTER_EGG_TAP_COUNT) {
   tapCountRef.current = 0;
   setBurstKey(Date.now());
   onEasterEgg?.();
  }
 };

 const effectiveMood: TuberMood = jumpOverride ? 'jump' : mood;
 const src = MOOD_IMAGE[effectiveMood];

 return (
  <motion.button
   type="button"
   onClick={handleTap}
   whileTap={{ scale: 0.92 }}
   animate={jumpOverride ? { y: [0, -10, 0] } : { y: 0 }}
   transition={{ duration: JUMP_OVERRIDE_MS / 1000, ease: 'easeOut' }}
   className={className}
   aria-label={t("Тюбер-9")}
   style={{
    position: 'relative',
    width: size,
    height: size,
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
   }}
  >
   {imageFailed ? (
    <TuberFallback mood={effectiveMood} size={size} />
   ) : (
    <img
     key={src}
     src={src}
     alt={t("Тюбер-9")}
     onError={() => setImageFailed(true)}
     style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
   )}

   {burstKey !== null ? (
    <ParticleBurst
     x={size / 2}
     y={size / 2}
     color="var(--ares-grow-pink, #FF2E93)"
     count={18}
     onDone={() => setBurstKey(null)}
    />
   ) : null}
  </motion.button>
 );
});

export interface HomeBeaconProps {
 size?: number;
 className?: string;
}

const HOME_TOOLTIP_TEXT = 'ДОМ. 225 МЛН КМ. ШЛЁМ КАРТОШКУ.';
const HOME_TOOLTIP_VISIBLE_MS = 2400;

export const HomeBeacon = memo(function HomeBeacon({
 size = 20,
 className,
}: HomeBeaconProps): JSX.Element {
 const [visible, setVisible] = useState(false);
 const hideTimerRef = useRef<number | null>(null);

 useEffect(() => {
  return () => {
   if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
  };
 }, []);

 const handleClick = (): void => {
  setVisible(true);
  if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
  hideTimerRef.current = window.setTimeout(() => setVisible(false), HOME_TOOLTIP_VISIBLE_MS);
 };

 return (
  <button
   type="button"
   onClick={handleClick}
   className={className}
   aria-label={t("Дом")}
   style={{
    position: 'relative',
    background: 'transparent',
    border: 'none',
    padding: 4,
    cursor: 'pointer',
    color: 'var(--ares-blueset, #6B93D6)',
   }}
  >
   <IconEarth size={size} accent="var(--ares-blueset, #6B93D6)" glow={visible} />
   <AnimatePresence>
    {visible ? (
     <motion.span
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="ares-mono"
      style={{
       position: 'absolute',
       bottom: '100%',
       left: '50%',
       transform: 'translateX(-50%)',
       marginBottom: 6,
       padding: '4px 8px',
       borderRadius: 4,
       background: 'rgba(5,3,8,0.9)',
       border: '1px solid var(--ares-blueset, #6B93D6)55',
       fontSize: 9,
       whiteSpace: 'nowrap',
       color: 'var(--ares-blueset, #6B93D6)',
      }}
     >
      {HOME_TOOLTIP_TEXT}
     </motion.span>
    ) : null}
   </AnimatePresence>
  </button>
 );
});
