import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { StarField, usePrefersReducedMotion } from './effects';
import { AstronautLoader } from '../../ui/TuberAstronaut';

export type LandingStage =
 | 'space'
 | 'descent'
 | 'dome'
 | 'wipe'
 | 'telemetry'
 | 'ready';

export interface LandingSequenceProps {
 onLanded: () => void;
}

const STAGE_ORDER: LandingStage[] = ['space', 'descent', 'dome', 'wipe', 'telemetry', 'ready'];

const STAGE_DURATIONS_MS: Record<Exclude<LandingStage, 'ready'>, number> = {
 space: 1100,
 descent: 1600,
 dome: 900,
 wipe: 700,
 telemetry: 1800,
};

const TELEMETRY_LINES = [
 'O2 ................ 98.4%',
 'H2O ............... 76.2%',
 'Seeker .......... 0417',
 'RATION ............ ГОТОВ',
];

function useTypedLines(lines: string[], active: boolean, charIntervalMs = 14): string[] {
 const [revealed, setRevealed] = useState<string[]>(() => lines.map(() => ''));
 const timerRef = useRef<number | null>(null);

 useEffect(() => {
  if (!active) return undefined;

  let lineIndex = 0;
  let charIndex = 0;

  const step = (): void => {
   setRevealed((prev) => {
    const next = [...prev];
    const targetLine = lines[lineIndex];
    if (targetLine === undefined) return prev;
    charIndex += 1;
    next[lineIndex] = targetLine.slice(0, charIndex);
    return next;
   });

   if (charIndex >= (lines[lineIndex]?.length ?? 0)) {
    lineIndex += 1;
    charIndex = 0;
    if (lineIndex >= lines.length) {
     if (timerRef.current !== null) window.clearInterval(timerRef.current);
     return;
    }
   }
  };

  timerRef.current = window.setInterval(step, charIntervalMs);
  return () => {
   if (timerRef.current !== null) window.clearInterval(timerRef.current);
  };
 }, [active, lines, charIntervalMs]);

 return revealed;
}

const SPACE_STARS_COUNT = 22;

export const LandingSequence = memo(function LandingSequence({
 onLanded,
}: LandingSequenceProps): JSX.Element {
 const reducedMotion = usePrefersReducedMotion();
 const [stageIndex, setStageIndex] = useState(0);
 const stage = STAGE_ORDER[stageIndex] ?? 'ready';

 useEffect(() => {
  if (stage === 'ready') {
   const landId = window.setTimeout(onLanded, reducedMotion ? 150 : 700);
   return () => window.clearTimeout(landId);
  }
  const duration = reducedMotion ? 250 : STAGE_DURATIONS_MS[stage];
  const timeoutId = window.setTimeout(() => {
   setStageIndex((prev) => Math.min(prev + 1, STAGE_ORDER.length - 1));
  }, duration);
  return () => window.clearTimeout(timeoutId);
 }, [stage, reducedMotion, onLanded]);

 const loadPct = [8, 30, 52, 68, 88, 100][stageIndex] ?? 100;
 const telemetryActive = stage === 'telemetry' || stage === 'ready';
 const typedLines = useTypedLines(TELEMETRY_LINES, telemetryActive, reducedMotion ? 2 : 14);

 const stageProgress = useMemo(() => {
  return {
   showStars: stage !== 'space',
   showPlanet: stage === 'descent' || stage === 'dome' || stage === 'wipe' || stage === 'telemetry' || stage === 'ready',
   showDome: stage === 'dome' || stage === 'wipe' || stage === 'telemetry' || stage === 'ready',
   showWipe: stage === 'wipe',
   showTelemetry: stage === 'telemetry' || stage === 'ready',
  };
 }, [stage]);

 return (
  <div
   style={{
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: 480,
    overflow: 'hidden',
    background: 'radial-gradient(ellipse at 50% 30%, #130A1E, #050308 70%)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
   }}
  >
   {stageProgress.showStars ? <StarField count={SPACE_STARS_COUNT} /> : null}

   <AnimatePresence>
    {stageProgress.showPlanet ? (
     <motion.div
      key="planet"
      initial={{ scale: 0.2, y: 60, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={{ duration: reducedMotion ? 0.2 : 1.4, ease: 'easeOut' }}
      style={{
       position: 'absolute',
       bottom: '-30%',
       width: '160%',
       height: '70%',
       borderRadius: '50%',
       background: 'radial-gradient(circle at 40% 35%, #C1440E, #6E2408 70%)',
       boxShadow: '0 0 60px 10px rgba(193,68,14,0.35)',
      }}
     />
    ) : null}
   </AnimatePresence>

   <AnimatePresence>
    {stageProgress.showDome ? (
     <motion.div
      key="dome"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: reducedMotion ? 0.2 : 0.7, ease: 'easeOut' }}
      style={{
       position: 'absolute',
       bottom: '18%',
       width: 120,
       height: 70,
       borderTopLeftRadius: '50%',
       borderTopRightRadius: '50%',
       background:
        'linear-gradient(180deg, rgba(232,106,60,0.5), rgba(232,106,60,0.15))',
       boxShadow: '0 0 24px 4px rgba(232,106,60,0.5)',
      }}
     />
    ) : null}
   </AnimatePresence>

   <AnimatePresence>
    {stageProgress.showWipe ? (
     <motion.div
      key="wipe"
      initial={{ x: '-100%', opacity: 0.9 }}
      animate={{ x: '100%', opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.2 : 0.7, ease: 'easeInOut' }}
      style={{
       position: 'absolute',
       inset: 0,
       background:
        'linear-gradient(100deg, transparent, rgba(180,220,255,0.4), transparent)',
       pointerEvents: 'none',
      }}
     />
    ) : null}
   </AnimatePresence>

   {stage ? (
    <div
     style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
      pointerEvents: 'none',
     }}
    >
     <AstronautLoader progress={loadPct} label="РАСПАКОВКА ГИДРОПОНИКИ" />
    </div>
   ) : null}

   {stageProgress.showTelemetry ? (
    <div
     className="ares-mono"
     style={{
      position: 'absolute',
      top: 24,
      left: 24,
      right: 24,
      color: 'var(--ares-bio-cyan, #12E7C4)',
      fontSize: 12,
      lineHeight: '18px',
      textShadow: '0 0 4px rgba(18,231,196,0.6)',
     }}
    >
     {typedLines.map((line, index) => (
      <div key={TELEMETRY_LINES[index]}>{line || ' '}</div>
     ))}
    </div>
   ) : null}

  </div>
 );
});
