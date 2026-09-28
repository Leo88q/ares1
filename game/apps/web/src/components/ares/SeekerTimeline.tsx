import { memo, useMemo } from 'react';

export interface SolTimelinePoint {
 sol: number;
 value: number;
}

export interface SolTimelineProps {
 points: SolTimelinePoint[];
 height?: number;
 accent?: string;
}

const VIEW_WIDTH = 320;

interface TimelineSegment { x: number; y: number; len: number; angle: number }

function buildPath(points: SolTimelinePoint[], height: number): { segments: TimelineSegment[]; dots: Array<{ x: number; y: number }> } {
 if (points.length === 0) return { segments: [], dots: [] };

 const values = points.map((point) => point.value);
 const minValue = Math.min(...values);
 const maxValue = Math.max(...values);
 const range = maxValue - minValue || 1;
 const stepX = points.length > 1 ? VIEW_WIDTH / (points.length - 1) : 0;
 const padding = 6;

 const dots = points.map((point, index) => {
  const x = points.length > 1 ? index * stepX : VIEW_WIDTH / 2;
  const normalized = (point.value - minValue) / range;
  const y = padding + (1 - normalized) * (height - padding * 2);
  return { x, y };
 });


 const segments: TimelineSegment[] = dots.slice(1).map((dot, index) => {
  const prev = dots[index];
  const dx = dot.x - prev.x;
  const dy = dot.y - prev.y;
  return { x: prev.x, y: prev.y, len: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
 });

 return { segments, dots };
}

export const SolTimeline = memo(function SolTimeline({
 points,
 height = 72,
 accent = 'var(--ares-bio-cyan, #12E7C4)',
}: SolTimelineProps): JSX.Element {
 const { segments, dots } = useMemo(() => buildPath(points, height), [points, height]);
 const firstSol = points[0]?.sol;
 const lastSol = points[points.length - 1]?.sol;

 return (
  <div>
   <div style={{ position: 'relative', width: '100%', height }} aria-hidden="true">
    {segments.map((seg, index) => (
     <span
      key={`seg-${index}`}
      style={{
       position: 'absolute',
       left: `${(seg.x / VIEW_WIDTH) * 100}%`,
       top: seg.y - 0.75,
       width: `${(seg.len / VIEW_WIDTH) * 100}%`,
       height: 1.5,
       background: accent,
       opacity: 0.85,
       transformOrigin: '0 50%',
       transform: `rotate(${seg.angle}rad)`,
      }}
     />
    ))}
    {dots.map((dot, index) => (
     <span
      key={index}
      style={{
       position: 'absolute',
       left: `${(dot.x / VIEW_WIDTH) * 100}%`,
       top: dot.y - 2.4,
       width: 4.8,
       height: 4.8,
       marginLeft: -2.4,
       borderRadius: '50%',
       background: accent,
      }}
     />
    ))}
   </div>
   {firstSol !== undefined && lastSol !== undefined ? (
    <div
     className="ares-mono"
     style={{
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 9,
      color: 'rgba(255,179,71,0.6)',
      marginTop: 2,
     }}
    >
     <span>Seeker {firstSol.toString().padStart(4, '0')}</span>
     <span>Seeker {lastSol.toString().padStart(4, '0')}</span>
    </div>
   ) : null}
  </div>
 );
});
