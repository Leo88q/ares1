import { memo } from 'react';
import type { ReactNode } from 'react';
import { useSeekerPhase } from '../../theme/ares';
import { DomeFrame } from './DomeFrame';
import { SolHud } from './SeekerHud';

export interface CabinBayProps {
 children: ReactNode;
 o2Percent?: number;
 h2oPercent?: number;
 rationLabel?: string;
}

export const CabinBay = memo(function CabinBay({ children, o2Percent, h2oPercent, rationLabel }: CabinBayProps): JSX.Element {
 const phase = useSeekerPhase();
 return (
  <DomeFrame
   phase={phase}
   label="КАЮТА"
   hud={<SolHud o2Percent={o2Percent} h2oPercent={h2oPercent} rationLabel={rationLabel} />}
  >
   {children}
  </DomeFrame>
 );
});
