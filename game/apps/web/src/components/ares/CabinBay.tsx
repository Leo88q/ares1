import { memo } from 'react';
import { t } from '../../i18n'

import type { ReactNode } from 'react';
import { SectionFrame } from './SectionFrame';
import { SolHud } from './SeekerHud';

export interface CabinBayProps {
 children: ReactNode;
 o2Percent?: number;
 h2oPercent?: number;
 rationLabel?: string;
}

export const CabinBay = memo(function CabinBay({ children, o2Percent, h2oPercent, rationLabel }: CabinBayProps): JSX.Element {
 return (
  <SectionFrame
   section="cabin"
   label={t("КАЮТА")}
   hud={<SolHud o2Percent={o2Percent} h2oPercent={h2oPercent} rationLabel={rationLabel} />}
  >
   {children}
  </SectionFrame>
 );
});
