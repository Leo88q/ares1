import { memo } from 'react';
import { motion } from 'framer-motion';
import { usePrefersReducedMotion } from './effects';

export interface TelemetryReading {
 label: string;
 value: string;
}

export interface TelemetryStripProps {
 readings: TelemetryReading[];
 speedSecPerLoop?: number;
}

function renderRow(readings: TelemetryReading[], keyPrefix: string): JSX.Element[] {
 return readings.map((reading, index) => (
  <span
   key={`${keyPrefix}-${reading.label}-${index}`}
   className="ares-mono"
   style={{ marginRight: 24, whiteSpace: 'nowrap', color: 'var(--ares-hud-amber, #FFB347)' }}
  >
   {reading.label} {reading.value}
  </span>
 ));
}

export const TelemetryStrip = memo(function TelemetryStrip({
 readings,
 speedSecPerLoop = 14,
}: TelemetryStripProps): JSX.Element {
 const reducedMotion = usePrefersReducedMotion();

 return (
  <div
   className="ares-metal-edge"
   style={{
    overflow: 'hidden',
    borderRadius: 6,
    padding: '6px 0',
    background: 'rgba(0,0,0,0.35)',
   }}
  >
   <motion.div
    style={{ display: 'inline-flex', paddingLeft: 16 }}
    animate={reducedMotion ? undefined : { x: ['0%', '-50%'] }}
    transition={
     reducedMotion
      ? undefined
      : { duration: speedSecPerLoop, repeat: Infinity, ease: 'linear' }
    }
   >
    {renderRow(readings, 'a')}
    {renderRow(readings, 'b')}
   </motion.div>
  </div>
 );
});
