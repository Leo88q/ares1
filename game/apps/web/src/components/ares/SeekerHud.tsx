import { memo, useMemo } from 'react';
import { useSeekerPhase, SEEKER_PHASE_LABELS_RU } from '../../theme/ares';
import type { SolPhase } from '../../theme/ares';
import { IconO2, IconDrop, IconCrate } from './icons';
import { BreathingGlow } from './effects';

export interface SolHudProps {
 o2Percent?: number;
 h2oPercent?: number;
 rationLabel?: string;
 className?: string;
}

const SEEKER_EPOCH_MS = Date.UTC(2026, 0, 1);
const MS_PER_DAY = 86_400_000;

function computeSolNumber(now: Date): number {
 const diff = Math.max(0, Math.floor((now.getTime() - SEEKER_EPOCH_MS) / MS_PER_DAY));
 return diff;
}

function formatSol(sol: number): string {
 return sol.toString().padStart(4, '0');
}

function formatPercent(value: number): string {
 return `${value.toFixed(1)}%`;
}

interface HudCellProps {
 icon: JSX.Element;
 label: string;
 value: string;
 accent: string;
 breathing: boolean;
}

const HudCell = memo(function HudCell({
 icon,
 label,
 value,
 accent,
 breathing,
}: HudCellProps): JSX.Element {
 return (
  <BreathingGlow color={accent} active={breathing}>
   <div
    style={{
     display: 'flex',
     alignItems: 'center',
     gap: 6,
     padding: '4px 8px',
     borderRadius: 6,
     background: 'rgba(0,0,0,0.35)',
     border: `1px solid ${accent}55`,
    }}
   >
    <span style={{ color: accent, display: 'flex' }}>{icon}</span>
    <span className="ares-mono" style={{ fontSize: 10, color: 'rgba(255,179,71,0.75)' }}>
     {label}
    </span>
    <span className="ares-mono" style={{ fontSize: 11, color: accent }}>
     {value}
    </span>
   </div>
  </BreathingGlow>
 );
});

const PHASE_ACCENT: Record<SolPhase, string> = {
 dawn: 'var(--ares-grow-violet, #B85CFF)',
 day: 'var(--ares-hud-amber, #FFB347)',
 blueset: 'var(--ares-blueset, #6B93D6)',
 night: 'var(--ares-grow-pink, #E86A3C)',
};

export const SolHud = memo(function SolHud({
 o2Percent = 98.4,
 h2oPercent = 76.2,
 rationLabel = 'ГОТОВ',
 className,
}: SolHudProps): JSX.Element {
 const phase = useSeekerPhase();
 const accent = PHASE_ACCENT[phase];
 const breathing = phase === 'night';

 const solLabel = useMemo(() => formatSol(computeSolNumber(new Date())), []);

 return (
  <div
   className={className}
   style={{
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
   }}
  >
   <HudCell
    icon={<IconO2 size={14} accent={accent} />}
    label="O2"
    value={formatPercent(o2Percent)}
    accent={accent}
    breathing={breathing}
   />
   <HudCell
    icon={<IconDrop size={14} accent={accent} />}
    label="H2O"
    value={formatPercent(h2oPercent)}
    accent={accent}
    breathing={breathing}
   />
   <HudCell
    icon={<IconCrate size={14} accent={accent} />}
    label="RATION"
    value={rationLabel}
    accent={accent}
    breathing={breathing}
   />
   <span
    className="ares-mono"
    style={{
     marginLeft: 4,
     fontSize: 10,
     color: 'rgba(245,240,234,0.92)',
     letterSpacing: '0.04em',
     background: 'rgba(5, 3, 8, 0.45)',
     padding: '4px 8px',
     borderRadius: 6,
     textShadow: '0 1px 4px rgba(0,0,0,0.7)',
    }}
   >
    Seeker {solLabel} · {SEEKER_PHASE_LABELS_RU[phase]}
   </span>
  </div>
 );
});
