import { memo, useId } from 'react';
import type { ReactNode, SVGProps } from 'react';

export interface AresIconProps {
 size?: number;
 accent?: string;
 glow?: boolean;
 className?: string;
}

interface GlowDefProps {
 id: string;
 color: string;
}

function GlowDef({ id, color }: GlowDefProps): JSX.Element {
 return (
  <defs>
   <filter id={id} x="-60%" y="-60%" width="220%" height="220%">
    <feDropShadow
     dx="0"
     dy="0"
     stdDeviation="1.6"
     floodColor={color}
     floodOpacity="0.85"
    />
   </filter>
  </defs>
 );
}

interface IconRootProps extends SVGProps<SVGSVGElement> {
 size: number;
 glow: boolean;
 glowColor: string;
 filterId: string;
 children: ReactNode;
}

function IconRoot({
 size,
 glow,
 glowColor,
 filterId,
 children,
 className,
 ...rest
}: IconRootProps): JSX.Element {
 return (
  <svg
   width={size}
   height={size}
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth={1.5}
   strokeLinecap="round"
   strokeLinejoin="round"
   className={className}
   style={glow ? { filter: `url(#${filterId})` } : undefined}
   {...rest}
  >
   {glow ? <GlowDef id={filterId} color={glowColor} /> : null}
   {children}
  </svg>
 );
}

const DEFAULT_SIZE = 20;
const DEFAULT_ACCENT = 'var(--ares-hud-amber, #FFB347)';

export const IconTuber = memo(function IconTuber({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <path d="M8.5 4.8c-2.4.6-4 2.9-4 5.6 0 1.6.5 2.7 1.1 3.9.9 1.8 1.6 3.4 1.6 5 0 1.6 1.2 2.7 2.8 2.7 1.2 0 2-.6 2.6-1.5.5.9 1.4 1.5 2.5 1.5 1.7 0 2.9-1.3 2.9-3 0-1.4-.6-2.6-1.3-4-.7-1.4-1.1-2.5-1.1-4 0-3-2.2-5.4-5-5.4-.7 0-1.4.1-2.1.2z" />
  </IconRoot>
 );
});

export const IconSprout = memo(function IconSprout({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <path d="M12 20V11" />
   <path d="M12 12.5c-2.2 0-4-1.8-4-4.2 0-1 .2-1.6.4-2.1 2.4 0 4.4 1.5 4.6 3.7" stroke={accent} />
   <path d="M12 11.2c1.9-.2 3.5-1.8 3.5-3.8 0-.9-.2-1.4-.4-1.9-2.1 0-3.8 1.3-4 3.2" />
   <path d="M9 20h6" />
  </IconRoot>
 );
});

export const IconMutGold = memo(function IconMutGold({
 size = 16, className = '', stroke = 1.5,
}: { size?: number; className?: string; stroke?: number }) {
 return (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className}>
   <path d="M12 2l2 6 6 1-4.5 4 1 6-4.5-3-4.5 3 1-6L4 9l6-1z" />
   <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
 )
})

export const IconMutSilicon = memo(function IconMutSilicon({
 size = 16, className = '', stroke = 1.5,
}: { size?: number; className?: string; stroke?: number }) {
 return (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className}>
   <rect x="6" y="6" width="12" height="12" rx="1" />
   <path d="M9 6V3M15 6V3M9 21v-3M15 21v-3M6 9H3M6 15H3M21 9h-3M21 15h-3" />
   <circle cx="12" cy="12" r="2" />
  </svg>
 )
})

export const IconWrench = memo(function IconWrench({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <path d="M15.6 4.4a4.2 4.2 0 0 0-5.6 4.6L4.6 14.4a1.6 1.6 0 0 0 2.3 2.3l5.4-5.4a4.2 4.2 0 0 0 4.6-5.6l-2.4 2.4-1.7-.6-.6-1.7 2.4-2.4z" />
   <circle cx="6.2" cy="17.8" r="0.6" fill={accent} stroke="none" />
  </IconRoot>
 );
});

export const IconO2 = memo(function IconO2({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <circle cx="8.5" cy="12" r="4" />
   <circle cx="15.5" cy="12" r="4" stroke={accent} />
   <line x1="12" y1="9.2" x2="12" y2="14.8" />
  </IconRoot>
 );
});

export const IconDrop = memo(function IconDrop({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <path d="M12 3.5c2.8 3.6 5.2 6.9 5.2 9.9a5.2 5.2 0 1 1-10.4 0c0-3 2.4-6.3 5.2-9.9z" />
   <path d="M9.6 14.4a2.6 2.6 0 0 0 2.4 2.6" stroke={accent} />
  </IconRoot>
 );
});

export const IconCrate = memo(function IconCrate({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <rect x="3.5" y="8" width="17" height="12" rx="1" />
   <path d="M3.5 8 12 4l8.5 4" />
   <line x1="12" y1="4" x2="12" y2="20" stroke={accent} />
   <line x1="3.5" y1="13.5" x2="20.5" y2="13.5" />
  </IconRoot>
 );
});

export const IconShuttle = memo(function IconShuttle({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <path d="M12 2.5c1.8 2.2 2.8 5.6 2.8 9.3v5.4l-2.8 2.3-2.8-2.3v-5.4c0-3.7 1-7.1 2.8-9.3z" />
   <path d="M9.2 14.5 5.6 17l1.6-4.1" stroke={accent} />
   <path d="M14.8 14.5 18.4 17l-1.6-4.1" stroke={accent} />
   <circle cx="12" cy="9.4" r="1.2" />
  </IconRoot>
 );
});

export const IconLog = memo(function IconLog({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <rect x="5" y="3.5" width="14" height="17" rx="1.2" />
   <path d="M9 3.5V2.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.7" />
   <line x1="8" y1="9" x2="16" y2="9" stroke={accent} />
   <line x1="8" y1="12.5" x2="16" y2="12.5" />
   <line x1="8" y1="16" x2="13" y2="16" />
  </IconRoot>
 );
});

export const IconBunk = memo(function IconBunk({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <line x1="3" y1="20" x2="3" y2="7" />
   <line x1="21" y1="20" x2="21" y2="7" />
   <rect x="3" y="7" width="18" height="4" rx="0.8" stroke={accent} />
   <rect x="3" y="13" width="18" height="4" rx="0.8" />
   <line x1="3" y1="20" x2="21" y2="20" />
  </IconRoot>
 );
});

export const IconScan = memo(function IconScan({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
   <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
   <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
   <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
   <line x1="4" y1="12" x2="20" y2="12" stroke={accent} />
  </IconRoot>
 );
});

export const IconStorm = memo(function IconStorm({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <path d="M3.5 8.5h13a3 3 0 1 0-2.9-3.8" />
   <path d="M3.5 12.5h16a3 3 0 1 1-2.9 3.8" stroke={accent} />
   <path d="M3.5 16.5h10" />
  </IconRoot>
 );
});

export const IconEarth = memo(function IconEarth({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <circle cx="12" cy="12" r="8.5" />
   <path d="M4 10.5c1.6.8 2.2 1.8 4 1.6 1.4-.1 1.6-1.4 3-1.2 1.6.2 1.6 1.8 3.2 1.9 1.4.1 2-1 3.4-.7" stroke={accent} />
   <path d="M9 18.5c.2-1.4 1.4-2 2.6-2 1.5 0 1.9 1.2 3.4 1" />
  </IconRoot>
 );
});

export const IconPhobos = memo(function IconPhobos({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <path d="M9 4.5c-3.2 1-5.3 3.9-5.3 7.5s2.1 6.5 5.3 7.5c-1.4-1.9-2.1-4.5-2.1-7.5s.7-5.6 2.1-7.5z" />
   <circle cx="8.3" cy="9.5" r="0.7" fill={accent} stroke="none" />
   <circle cx="7.6" cy="14" r="0.9" fill={accent} stroke="none" />
  </IconRoot>
 );
});

export const IconTray = memo(function IconTray({
 size = DEFAULT_SIZE,
 accent = DEFAULT_ACCENT,
 glow = false,
 className,
}: AresIconProps): JSX.Element {
 const filterId = useId();
 return (
  <IconRoot size={size} glow={glow} glowColor={accent} filterId={filterId} className={className}>
   <path d="M4 9h16l-1.6 9.5a1.5 1.5 0 0 1-1.5 1.3H7.1a1.5 1.5 0 0 1-1.5-1.3L4 9z" />
   <line x1="6.5" y1="9" x2="7.6" y2="19.6" stroke={accent} />
   <line x1="12" y1="9" x2="12" y2="19.8" />
   <line x1="17.5" y1="9" x2="16.4" y2="19.6" stroke={accent} />
   <path d="M3 9c1-1.6 2.6-2.5 4.5-2.5h9c1.9 0 3.5.9 4.5 2.5" />
  </IconRoot>
 );
});

export interface BezelProps {
 children: ReactNode;
 tone?: 'amber' | 'magenta';
 shape?: 'circle' | 'hex';
 size?: number;
}

const BEZEL_TONE_COLORS: Record<NonNullable<BezelProps['tone']>, string> = {
 amber: 'var(--ares-hud-amber, #FFB347)',
 magenta: 'var(--ares-grow-pink, #FF2E93)',
};

const HEX_CLIP_PATH =
 'polygon(50% 2%, 95% 25%, 95% 75%, 50% 98%, 5% 75%, 5% 25%)';

export const Bezel = memo(function Bezel({
 children,
 tone = 'amber',
 shape = 'circle',
 size = 40,
}: BezelProps): JSX.Element {
 const color = BEZEL_TONE_COLORS[tone];
 return (
  <div
   className="ares-metal-edge"
   style={{
    width: size,
    height: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape === 'circle' ? '50%' : 0,
    clipPath: shape === 'hex' ? HEX_CLIP_PATH : undefined,
    boxShadow: `0 0 8px 1px ${color}55, inset 0 0 6px ${color}33`,
    color,
    flexShrink: 0,
   }}
  >
   {children}
  </div>
 );
});
