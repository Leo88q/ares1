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

function buildPath(points: SolTimelinePoint[], height: number): { line: string; dots: Array<{ x: number; y: number }> } {
 if (points.length === 0) return { line: '', dots: [] };

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

 const line = dots.map((dot, index) => `${index === 0 ? 'M' : 'L'}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(' ');

 return { line, dots };
}

export const SolTimeline = memo(function SolTimeline({
 points,
 height = 72,
 accent = 'var(--ares-bio-cyan, #12E7C4)',
}: SolTimelineProps): JSX.Element {
 const { line, dots } = useMemo(() => buildPath(points, height), [points, height]);
 const firstSol = points[0]?.sol;
 const lastSol = points[points.length - 1]?.sol;

 return (
  <div>
   <svg viewBox={`0 0 ${VIEW_WIDTH} ${height}`} width="100%" height={height} preserveAspectRatio="none">
    {line ? <path d={line} fill="none" stroke={accent} strokeWidth={1.5} /> : null}
    {dots.map((dot, index) => (
     <circle key={index} cx={dot.x} cy={dot.y} r={2.4} fill={accent} />
    ))}
   </svg>
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
