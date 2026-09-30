import { memo, useState } from 'react';
import { Lock, Check } from 'lucide-react';
import { t } from '../../i18n';

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
 '#E5A86E',
 '#FFB347',
 '#E0A183',
 '#D48742',
];

interface PatchBadgeProps {
 patch: MissionPatch;
 tone: string;
}

function PatchFallback({ label, tone, earned }: { label: string; tone: string; earned: boolean }): JSX.Element {
 return (
  <div
   title={label}
   style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    borderRadius: 8,
    border: `1px solid ${earned ? tone : 'rgba(255,179,71,0.2)'}`,
    background: earned ? 'rgba(217,143,66,0.15)' : 'rgba(0,0,0,0.4)',
    color: earned ? tone : 'rgba(255,179,71,0.3)',
   }}
  >
   {earned ? <Check size={18} /> : <Lock size={16} />}
  </div>
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
    gap: 6,
    width: 84,
    padding: '8px 6px',
    borderRadius: 8,
    border: `1px solid ${patch.earned ? 'rgba(232,160,60,0.4)' : 'rgba(255,255,255,0.06)'}`,
    background: patch.earned
     ? 'linear-gradient(165deg, rgba(48,32,20,0.7) 0%, rgba(24,15,10,0.85) 100%)'
     : 'rgba(0,0,0,0.3)',
    boxShadow: patch.earned ? '0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,214,170,0.15)' : 'none',
   }}
  >
   <div
    style={{
     position: 'relative',
     width: 52,
     height: 52,
     display: 'flex',
     alignItems: 'center',
     justifyContent: 'center',
     borderRadius: 8,
     padding: 2,
    }}
   >
    {patch.imageSrc && !failed ? (
     <img
      src={patch.imageSrc}
      alt={patch.label}
      onError={() => setFailed(true)}
      style={{
       width: '100%',
       height: '100%',
       objectFit: 'contain',
       filter: patch.earned ? 'drop-shadow(0 2px 6px rgba(255,179,71,0.3))' : 'grayscale(1) opacity(0.28)',
       transition: 'filter 0.3s ease',
      }}
     />
    ) : (
     <PatchFallback label={patch.label} tone={tone} earned={patch.earned} />
    )}

    {!patch.earned && (
     <div
      style={{
       position: 'absolute',
       bottom: -2,
       right: -2,
       background: '#1D130B',
       border: '1px solid rgba(255,179,71,0.3)',
       borderRadius: 4,
       padding: '2px 4px',
       display: 'flex',
       alignItems: 'center',
       justifyContent: 'center',
      }}
     >
      <Lock size={10} color="#A8895C" />
     </div>
    )}
   </div>
   <span
    className="ares-mono"
    style={{
     fontSize: 10,
     textAlign: 'center',
     color: patch.earned ? '#EFD9AC' : 'var(--pf-text-muted)',
     fontWeight: patch.earned ? 700 : 500,
     lineHeight: 1.2,
     maxWidth: 78,
     overflow: 'hidden',
     textOverflow: 'ellipsis',
    }}
   >
    {patch.label}
   </span>
  </div>
 );
});

export const PatchWall = memo(function PatchWall({ patches }: PatchWallProps): JSX.Element {
 const earnedCount = patches.filter((p) => p.earned).length;

 return (
  <div>
   <div
    style={{
     display: 'flex',
     alignItems: 'center',
     justifyContent: 'space-between',
     marginBottom: 10,
     fontSize: 11,
     color: 'var(--ares-dust, #E0A183)',
    }}
    className="ares-mono"
   >
    <span>СТАТУС: КОЛЛЕКЦИЯ НАШИВОК</span>
    <span style={{ color: '#FFC94A', fontWeight: 700 }}>
     {earnedCount} / {patches.length} {t('ПОЛУЧЕНО')}
    </span>
   </div>
   <div
    style={{
     display: 'grid',
     gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
     gap: 10,
     padding: '8px 0',
     justifyItems: 'center',
    }}
   >
    {patches.map((patch, index) => (
     <PatchBadge key={patch.id} patch={patch} tone={PATCH_TONES[index % PATCH_TONES.length]} />
    ))}
   </div>
  </div>
 );
});
