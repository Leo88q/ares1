import { memo } from 'react';
import { t } from '../../i18n'

import { StencilPlate } from './panels';

export interface CustomsFeeTagProps {
 amountLabel: string;
}

export const CustomsFeeTag = memo(function CustomsFeeTag({
 amountLabel,
}: CustomsFeeTagProps): JSX.Element {
 return (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
   <StencilPlate tone="danger">{t("ТАМОЖЕННЫЙ СБОР")}</StencilPlate>
   <span className="ares-mono" style={{ fontSize: 11, color: '#E8823F' }}>
    {amountLabel}
   </span>
  </div>
 );
});
