import { memo } from 'react';
import { StencilPlate } from './panels';

export interface CustomsFeeTagProps {
 amountLabel: string;
}

export const CustomsFeeTag = memo(function CustomsFeeTag({
 amountLabel,
}: CustomsFeeTagProps): JSX.Element {
 return (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
   <StencilPlate tone="danger">ТАМОЖЕННЫЙ СБОР</StencilPlate>
   <span className="ares-mono" style={{ fontSize: 11, color: 'var(--ares-rust, #C1440E)' }}>
    {amountLabel}
   </span>
  </div>
 );
});
