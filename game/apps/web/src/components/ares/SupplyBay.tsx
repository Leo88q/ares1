import { memo } from 'react';
import { t } from '../../i18n'

import type { ReactNode } from 'react';
import { useSeekerPhase } from '../../theme/ares';
import { DomeFrame } from './DomeFrame';
import { SolHud } from './SeekerHud';

export interface SupplyBayProps {
 children: ReactNode;
 o2Percent?: number;
 h2oPercent?: number;
 rationLabel?: string;
}

export const SupplyBay = memo(function SupplyBay({ children, o2Percent, h2oPercent, rationLabel }: SupplyBayProps): JSX.Element {
 const phase = useSeekerPhase();
 return (
  <DomeFrame
   phase={phase}
   label={t("СНАБЖЕНИЕ")}
   hud={<SolHud o2Percent={o2Percent} h2oPercent={h2oPercent} rationLabel={rationLabel} />}
  >
   {children}
  </DomeFrame>
 );
});
