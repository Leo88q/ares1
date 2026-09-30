import { memo } from 'react';
import { Lock } from 'lucide-react';
import { useI18n } from '../../i18n';
import { TacticalInsignia } from './TacticalInsignia';

export interface MissionPatch {
 id: string;
 label: string;
 imageSrc?: string;
 earned: boolean;
}

export interface PatchWallProps {
 patches: MissionPatch[];
}

const CODE_BY_ID: Record<string, string> = {
 a1: 'Q-01',
 a2: 'Q-02',
 a3: 'Q-03',
 a4: 'Q-04',
 a5: 'Q-05',
 a6: 'Q-06',
};

interface PatchBadgeProps {
 patch: MissionPatch;
}

const PatchBadge = memo(function PatchBadge({ patch }: PatchBadgeProps): JSX.Element {
 const code = CODE_BY_ID[patch.id] ?? 'Q-00';

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
    border: `1px solid ${patch.earned ? 'rgba(255,179,71,0.45)' : 'rgba(255,255,255,0.06)'}`,
    background: patch.earned
     ? 'linear-gradient(165deg, rgba(38,24,14,0.9) 0%, rgba(20,12,7,0.95) 100%)'
     : 'rgba(0,0,0,0.3)',
    boxShadow: patch.earned ? '0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,214,170,0.15)' : 'none',
   }}
  >
   <div
    style={{
     position: 'relative',
     width: 50,
     height: 50,
     display: 'flex',
     alignItems: 'center',
     justifyContent: 'center',
     borderRadius: 8,
    }}
   >
    <TacticalInsignia id={patch.id} code={code} earned={patch.earned} size={48} />

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
 const { t } = useI18n();
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
    <span>{t("СТАТУС: КОЛЛЕКЦИЯ НАШИВОК")}</span>
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
    {patches.map((patch) => (
     <PatchBadge key={patch.id} patch={patch} />
    ))}
   </div>
  </div>
 );
});
