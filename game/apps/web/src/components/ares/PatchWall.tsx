import { memo, useState } from 'react';

export interface MissionPatch {
 id: string;
 label: string;
 imageSrc?: string;
 earned: boolean;
}

export interface PatchWallProps {
 patches: MissionPatch[];
}

const PATCH_TONES = [
 'var(--ares-grow-pink, #FF2E93)',
 'var(--ares-hud-amber, #FFB347)',
 'var(--ares-bio-cyan, #12E7C4)',
 'var(--ares-blueset, #6B93D6)',
];

interface PatchBadgeProps {
 patch: MissionPatch;
 tone: string;
}

function PatchFallback({ label, tone, earned }: { label: string; tone: string; earned: boolean }): JSX.Element {
 return (
  <span
   title={label}
   style={{ display: 'block', width: '100%', height: '100%', borderRadius: '50%', border: `2px solid ${earned ? tone : 'rgba(255,179,71,0.3)'}`, background: 'rgba(0,0,0,0.35)' }}
  />
 );
}

const PatchBadge = memo(function PatchBadge({ patch, tone }: PatchBadgeProps): JSX.Element {
 const [failed, setFailed] = useState(false);

 return (
  <div
   style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    width: 68,
   }}
  >
   <div style={{ width: 56, height: 56, filter: patch.earned ? undefined : 'grayscale(1)' }}>
    {patch.imageSrc && !failed ? (
     <img
      src={patch.imageSrc}
      alt={patch.label}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: patch.earned ? 1 : 0.4 }}
     />
    ) : (
     <PatchFallback label={patch.label} tone={tone} earned={patch.earned} />
    )}
   </div>
   <span
    className="ares-mono"
    style={{
     fontSize: 9,
     textAlign: 'center',
     color: patch.earned ? tone : 'rgba(255,179,71,0.4)',
    }}
   >
    {patch.label}
   </span>
  </div>
 );
});

export const PatchWall = memo(function PatchWall({ patches }: PatchWallProps): JSX.Element {
 return (
  <div
   style={{
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    padding: '10px 4px',
   }}
  >
   {patches.map((patch, index) => (
    <PatchBadge key={patch.id} patch={patch} tone={PATCH_TONES[index % PATCH_TONES.length]} />
   ))}
  </div>
 );
});
