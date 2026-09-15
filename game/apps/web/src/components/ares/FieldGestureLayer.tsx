import { memo, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n'

import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
 useHoldProgress,
 useDoubleTap,
 MistSpray,
 ScanRing,
} from './effects';

export interface ScanDatum {
 label: string;
 value: string;
}

export interface FieldGestureLayerProps {
 children: ReactNode;
 canHarvest: boolean;
 onHarvest: () => void;
 onMist?: () => void;
 scanData?: ScanDatum[];
 holdDurationMs?: number;
 longPressMs?: number;
}

const SCAN_VISIBLE_MS = 1400;
const MIST_VISIBLE_MS = 500;

export const FieldGestureLayer = memo(function FieldGestureLayer({
 children,
 canHarvest,
 onHarvest,
 onMist,
 scanData = [],
 holdDurationMs = 900,
 longPressMs = 600,
}: FieldGestureLayerProps): JSX.Element {
 const { progress, holding, start, cancel } = useHoldProgress(holdDurationMs);
 const [scanVisible, setScanVisible] = useState(false);
 const [mistVisible, setMistVisible] = useState(false);
 const longPressTimerRef = useRef<number | null>(null);
 const scanHideTimerRef = useRef<number | null>(null);
 const mistHideTimerRef = useRef<number | null>(null);
 const harvestedRef = useRef(false);

 useEffect(() => {
  if (canHarvest && holding && progress >= 1 && !harvestedRef.current) {
   harvestedRef.current = true;
   onHarvest();
   cancel();
  }
  if (!holding) {
   harvestedRef.current = false;
  }
 }, [progress, holding, canHarvest, onHarvest, cancel]);

 useEffect(() => {
  return () => {
   if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
   if (scanHideTimerRef.current !== null) window.clearTimeout(scanHideTimerRef.current);
   if (mistHideTimerRef.current !== null) window.clearTimeout(mistHideTimerRef.current);
  };
 }, []);

 const triggerScan = (): void => {
  setScanVisible(true);
  if (scanHideTimerRef.current !== null) window.clearTimeout(scanHideTimerRef.current);
  scanHideTimerRef.current = window.setTimeout(() => setScanVisible(false), SCAN_VISIBLE_MS);
 };

 const triggerMist = (): void => {
  setMistVisible(true);
  onMist?.();
  if (mistHideTimerRef.current !== null) window.clearTimeout(mistHideTimerRef.current);
  mistHideTimerRef.current = window.setTimeout(() => setMistVisible(false), MIST_VISIBLE_MS);
 };

 const handleTap = useDoubleTap(triggerMist);

 const handlePointerDown = (_event: PointerEvent<HTMLDivElement>): void => {
  handleTap();
  if (canHarvest) {
   start();
   return;
  }
  if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
  longPressTimerRef.current = window.setTimeout(triggerScan, longPressMs);
 };

 const handlePointerUp = (): void => {
  cancel();
  if (longPressTimerRef.current !== null) {
   window.clearTimeout(longPressTimerRef.current);
   longPressTimerRef.current = null;
  }
 };

 const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  if (canHarvest) {
   onHarvest();
  } else {
   triggerScan();
  }
 };

 return (
  <div
   role="button"
   tabIndex={0}
   aria-label={canHarvest ? t('Жатва') : t('Осмотреть поле')}
   onPointerDown={handlePointerDown}
   onPointerUp={handlePointerUp}
   onPointerLeave={handlePointerUp}
   onKeyDown={handleKeyDown}
   style={{ position: 'relative', touchAction: 'manipulation' }}
  >
   {children}

   {canHarvest && holding ? (
    <motion.div
     aria-hidden="true"
     animate={{
      scale: [1, 1.015, 1],
      transition: { duration: 0.18, repeat: Infinity },
     }}
     style={{
      position: 'absolute',
      inset: -3,
      borderRadius: 12,
      border: '2px solid var(--ares-hud-amber, #FFB347)',
      boxShadow: `0 0 ${8 + progress * 18}px ${2 + progress * 4}px rgba(255,179,71,${0.3 + progress * 0.5})`,
      pointerEvents: 'none',
     }}
    />
   ) : null}

   <MistSpray active={mistVisible} />
   <ScanRing active={scanVisible} />

   {scanVisible && scanData.length > 0 ? (
    <motion.div
     initial={{ opacity: 0, y: 4 }}
     animate={{ opacity: 1, y: 0 }}
     exit={{ opacity: 0 }}
     className="ares-mono"
     style={{
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: 6,
      padding: '6px 8px',
      borderRadius: 6,
      background: 'rgba(5,3,8,0.85)',
      border: '1px solid var(--ares-hud-amber, #FFB347)55',
      fontSize: 10,
      color: 'var(--ares-hud-amber, #FFB347)',
      zIndex: 2,
     }}
    >
     {scanData.map((datum) => (
      <div key={datum.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
       <span>{datum.label}</span>
       <span>{datum.value}</span>
      </div>
     ))}
    </motion.div>
   ) : null}
  </div>
 );
});
