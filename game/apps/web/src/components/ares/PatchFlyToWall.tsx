import { memo, useEffect, useState } from 'react';
import { BezierFlight, ParticleBurst } from './effects';
import type { Point2D } from './effects';

export interface PatchFlyToWallProps {
 active: boolean;
 from: Point2D;
 to: Point2D;
 patchSrc?: string;
 label: string;
 onDone?: () => void;
}

function PatchSprite({ patchSrc, label }: { patchSrc?: string; label: string }): JSX.Element {
 const [failed, setFailed] = useState(false);

 if (patchSrc && !failed) {
  return (
   <img
    src={patchSrc}
    alt={label}
    onError={() => setFailed(true)}
    style={{ width: 40, height: 40, objectFit: 'contain' }}
   />
  );
 }

 return (
  <svg width={40} height={40} viewBox="0 0 40 40">
   <circle
    cx="20"
    cy="20"
    r="17"
    fill="rgba(184, 92, 255, 0.15)"
    stroke="var(--ares-grow-pink, #FF2E93)"
    strokeWidth="2"
    strokeDasharray="2 2"
   />
  </svg>
 );
}

export const PatchFlyToWall = memo(function PatchFlyToWall({
 active,
 from,
 to,
 patchSrc,
 label,
 onDone,
}: PatchFlyToWallProps): JSX.Element | null {
 const [landed, setLanded] = useState(false);

 // ФИКС: сбрасываем landed при деактивации, чтобы повторная активация
 // запускала полный полёт, а не сразу показывала burst в старом месте
 useEffect(() => {
  if (!active) setLanded(false);
 }, [active]);

 if (!active) return null;

 const handleFlightDone = (): void => {
  setLanded(true);
  onDone?.();
 };

 return (
  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
   {!landed ? (
    <BezierFlight
     from={from}
     to={to}
     duration={0.7}
     onDone={handleFlightDone}
     sprite={<PatchSprite patchSrc={patchSrc} label={label} />}
    />
   ) : (
    <ParticleBurst x={to.x} y={to.y} color="var(--ares-grow-pink, #FF2E93)" count={14} />
   )}
  </div>
 );
});
