import { memo } from 'react';
import { t } from '../../i18n'

import type { ReactNode } from 'react';
import { SectionFrame } from './SectionFrame';
import { SolHud } from './SeekerHud';

export interface StatsBayProps {
 children: ReactNode;
 o2Percent?: number;
 h2oPercent?: number;
 rationLabel?: string;
}

export const StatsBay = memo(function StatsBay({ children, o2Percent, h2oPercent, rationLabel }: StatsBayProps): JSX.Element {
 return (
  <SectionFrame
   section="journal"
   label={t("ЖУРНАЛ МИССИИ")}
   hud={<SolHud o2Percent={o2Percent} h2oPercent={h2oPercent} rationLabel={rationLabel} />}
  >
   {children}
  </SectionFrame>
 );
});
