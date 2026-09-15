import { memo, useMemo } from 'react';
import { t } from '../../i18n'

import { ConsolePanel, StencilPlate } from './panels';

export interface IdCardProps {
 walletAddress: string;
 role?: string;
 level?: number;
}

const GRID_COLUMNS = 5;
const GRID_ROWS = 5;
const HALF_COLUMNS = Math.ceil(GRID_COLUMNS / 2);

const AVATAR_COLORS = [
 'var(--ares-grow-pink, #FF2E93)',
 'var(--ares-bio-cyan, #12E7C4)',
 'var(--ares-hud-amber, #FFB347)',
 'var(--ares-blueset, #6B93D6)',
 'var(--ares-bio-green, #7CFF6B)',
];

function hashString(input: string): number {
 let hash = 0;
 for (let index = 0; index < input.length; index += 1) {
  hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
 }
 return hash;
}

interface PixelAvatarData {
 cells: boolean[];
 color: string;
}

function buildPixelAvatar(seed: string): PixelAvatarData {
 const hash = hashString(seed || 'ares-1');
 const cells: boolean[] = [];

 for (let row = 0; row < GRID_ROWS; row += 1) {
  for (let col = 0; col < HALF_COLUMNS; col += 1) {
   const bitIndex = row * HALF_COLUMNS + col;
   const on = ((hash >> (bitIndex % 30)) & 1) === 1;
   cells[row * GRID_COLUMNS + col] = on;
   cells[row * GRID_COLUMNS + (GRID_COLUMNS - 1 - col)] = on;
  }
 }

 const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
 return { cells, color };
}

function truncateAddress(address: string): string {
 if (address.length <= 10) return address;
 return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

export interface PixelAvatarProps {
 seed: string;
 size?: number;
}

export const PixelAvatar = memo(function PixelAvatar({ seed, size = 56 }: PixelAvatarProps): JSX.Element {
 const { cells, color } = useMemo(() => buildPixelAvatar(seed), [seed]);
 const cellSize = size / GRID_COLUMNS;

 return (
  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
   <rect width={size} height={size} fill="rgba(0,0,0,0.4)" rx={6} />
   {cells.map((on, index) => {
    if (!on) return null;
    const row = Math.floor(index / GRID_COLUMNS);
    const col = index % GRID_COLUMNS;
    return (
     <rect
      key={index}
      x={col * cellSize}
      y={row * cellSize}
      width={cellSize}
      height={cellSize}
      fill={color}
     />
    );
   })}
  </svg>
 );
});

export const IdCard = memo(function IdCard({
 walletAddress,
 role = 'АГРОНОМ-1',
 level,
}: IdCardProps): JSX.Element {
 return (
  <ConsolePanel tone="magenta">
   <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <PixelAvatar seed={walletAddress} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
     <StencilPlate tone="magenta">{t(role)}</StencilPlate>
     <span className="ares-mono" style={{ fontSize: 11, color: 'rgba(255,179,71,0.85)' }}>
      {truncateAddress(walletAddress)}
     </span>
     {level !== undefined ? (
      <span className="ares-mono" style={{ fontSize: 10, color: 'var(--ares-hud-amber, #FFB347)' }}>
       {t('УРОВЕНЬ {n}', { n: level })}
      </span>
     ) : null}
    </div>
   </div>
  </ConsolePanel>
 );
});
