import { memo, useState } from 'react';
import type { ReactNode, MouseEvent, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';

export type PanelTone = 'neutral' | 'amber' | 'magenta' | 'danger';

const TONE_GLOW: Record<PanelTone, string> = {
 neutral: 'rgba(180, 220, 255, 0.18)',
 amber: 'var(--ares-hud-amber, #FFB347)',
 magenta: 'var(--ares-grow-pink, #FF2E93)',
 danger: 'var(--ares-rust, #C1440E)',
};

export interface RivetCornersProps {
 inset?: number;
}

export const RivetCorners = memo(function RivetCorners({
 inset = 10,
}: RivetCornersProps): JSX.Element {
 const positions: Array<{ top?: number; bottom?: number; left?: number; right?: number }> = [
  { top: inset, left: inset },
  { top: inset, right: inset },
  { bottom: inset, left: inset },
  { bottom: inset, right: inset },
 ];
 return (
  <>
   {positions.map((pos, index) => (
    <span
     key={index}
     aria-hidden="true"
     style={{
      position: 'absolute',
      width: 9,
      height: 9,
      borderRadius: '50%',
      background:
       'radial-gradient(circle at 35% 35%, #E6A26A 0%, #D08A54 30%, #8A4A22 70%, #3A1D0E)',
      boxShadow: 'inset 0 -1px 1px rgba(0,0,0,0.7), inset 0 1px 1px rgba(255,214,170,0.3), 0 0 2px rgba(0,0,0,0.6)',
      pointerEvents: 'none',
      ...pos,
     }}
    />
   ))}
  </>
 );
});

export interface CautionEdgeProps {
 thickness?: number;
 position?: 'top' | 'bottom';
}

export const CautionEdge = memo(function CautionEdge({
 thickness = 6,
 position = 'top',
}: CautionEdgeProps): JSX.Element {
 return (
  <div
   aria-hidden="true"
   style={{
    position: 'absolute',
    left: 0,
    right: 0,
    [position]: 0,
    height: thickness,
    backgroundImage:
     'repeating-linear-gradient(45deg, #FFB347 0, #FFB347 6px, #1E1B12 6px, #1E1B12 12px)',
    opacity: 0.9,
   }}
  />
 );
});

export interface StencilPlateProps {
 children: ReactNode;
 tone?: PanelTone;
}

export const StencilPlate = memo(function StencilPlate({
 children,
 tone = 'neutral',
}: StencilPlateProps): JSX.Element {
 const glow = TONE_GLOW[tone];
 return (
  <span
   className="ares-stencil"
   style={{
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 3,
    border: `1px solid ${glow}`,
    color: glow,
    fontSize: 11,
    lineHeight: '16px',
    textShadow: `0 0 6px ${glow}66`,
    background: 'rgba(0,0,0,0.35)',
   }}
  >
   {children}
  </span>
 );
});

export interface ConsolePanelProps {
 title?: string;
 children: ReactNode;
 tone?: PanelTone;
 className?: string;
}

export const ConsolePanel = memo(function ConsolePanel({
 title,
 children,
 tone = 'neutral',
 className,
}: ConsolePanelProps): JSX.Element {
 const glow = TONE_GLOW[tone];
 return (
  <section
   className={`hull-skin${className ? ` ${className}` : ''}`}
   style={{
    position: 'relative',
    borderRadius: 10,
    padding: '14px 16px',
    boxShadow: `0 0 0 1px rgba(0,0,0,0.7), 0 0 22px -6px ${glow}, inset 0 1px 0 rgba(255,214,170,0.14), inset 0 -1px 0 rgba(0,0,0,0.45)`,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: '#2A1508 #8A4A22 #8A4A22 #2A1508',
   }}
  >
   {title ? (
    <header style={{ marginBottom: 8 }}>
     <StencilPlate tone={tone}>{title}</StencilPlate>
    </header>
   ) : null}
   <div>{children}</div>
  </section>
 );
});

export interface HydroTrayProps {
 children: ReactNode;
 active?: boolean;
}

export const HydroTray = memo(function HydroTray({
 children,
 active = false,
}: HydroTrayProps): JSX.Element {
 return (
  <div
   style={{
    position: 'relative',
    borderRadius: 8,
    padding: '10px 12px 14px',
    background:
     'linear-gradient(180deg, rgba(74,79,90,0.55), rgba(42,45,52,0.75))',
    border: '1px solid rgba(180,220,255,0.14)',
    overflow: 'hidden',
   }}
  >
   <div
    aria-hidden="true"
    style={{
     position: 'absolute',
     left: 6,
     right: 6,
     bottom: 4,
     height: 3,
     borderRadius: 2,
     background: active
      ? 'linear-gradient(90deg, var(--ares-bio-cyan, #12E7C4), var(--ares-bio-green, #7CFF6B))'
      : 'rgba(180,220,255,0.12)',
     boxShadow: active ? '0 0 6px var(--ares-bio-cyan, #12E7C4)' : 'none',
    }}
   />
   {children}
  </div>
 );
});

export interface DockKeyProps {
 icon: ReactNode;
 label: string;
 active?: boolean;
 onClick?: () => void;
}

export const DockKey = memo(function DockKey({
 icon,
 label,
 active = false,
 onClick,
}: DockKeyProps): JSX.Element {
 const [pressed, setPressed] = useState(false);

 const handleActivate = (): void => {
  onClick?.();
 };

 const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
  if (event.key === 'Enter' || event.key === ' ') {
   event.preventDefault();
   handleActivate();
  }
 };

 const handlePointerDown = (_event: MouseEvent<HTMLButtonElement>): void => {
  setPressed(true);
 };

 const handlePointerUp = (): void => {
  setPressed(false);
 };

 const glow = active ? 'var(--ares-grow-pink, #FF2E93)' : 'rgba(180,220,255,0.25)';

 return (
  <motion.button
   type="button"
   onClick={handleActivate}
   onKeyDown={handleKeyDown}
   onMouseDown={handlePointerDown}
   onMouseUp={handlePointerUp}
   onMouseLeave={handlePointerUp}
   animate={{ y: pressed ? 1 : 0 }}
   transition={{ duration: 0.08 }}
   aria-pressed={active}
   aria-current={active ? 'true' : undefined}
   aria-label={label}
   style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: 'none',
    color: active ? glow : 'rgba(255,179,71,0.8)',
    padding: '6px 10px',
    borderRadius: 8,
    boxShadow: active ? `0 0 10px -2px ${glow}` : 'none',
    cursor: 'pointer',
   }}
  >
   <span style={{ filter: active ? `drop-shadow(0 0 4px ${glow})` : undefined }}>
    {icon}
   </span>
   <span className="ares-mono" style={{ fontSize: 9, letterSpacing: '0.04em' }}>
    {label}
   </span>
  </motion.button>
 );
});
