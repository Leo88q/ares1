import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { DustStorm } from './effects';

export interface OrderManifestProps {
 children: ReactNode;
 onCancel: () => void;
 cancelable?: boolean;
}

const CANCEL_DRAG_THRESHOLD_PX = -90;
const SINK_DURATION_S = 0.55;

export const OrderManifest = memo(function OrderManifest({
 children,
 onCancel,
 cancelable = true,
}: OrderManifestProps): JSX.Element {
 const [sinking, setSinking] = useState(false);
 const dragX = useMotionValue(0);
 const cancelHintOpacity = useTransform(dragX, [CANCEL_DRAG_THRESHOLD_PX, 0], [1, 0]);

 const handleDragEnd = (_event: unknown, info: PanInfo): void => {
  if (!cancelable) return;
  if (info.offset.x <= CANCEL_DRAG_THRESHOLD_PX) {
   setSinking(true);
   window.setTimeout(onCancel, SINK_DURATION_S * 1000);
  }
 };

 return (
  <div style={{ position: 'relative', marginBottom: 10 }}>
   <div
    aria-hidden="true"
    style={{
     position: 'absolute',
     inset: 0,
     display: 'flex',
     alignItems: 'center',
     justifyContent: 'flex-end',
     paddingRight: 16,
     borderRadius: 10,
     background:
      'linear-gradient(90deg, transparent, rgba(193,68,14,0.35))',
    }}
   >
    <motion.span
     className="ares-mono"
     style={{ opacity: cancelHintOpacity, color: 'var(--ares-rust, #C1440E)', fontSize: 11 }}
    >
     ОТМЕНА
    </motion.span>
   </div>

   <motion.div
    drag={cancelable && !sinking ? 'x' : false}
    dragConstraints={{ left: 0, right: 0 }}
    dragElastic={{ left: 0.6, right: 0.05 }}
    style={{ x: dragX, position: 'relative' }}
    animate={
     sinking
      ? { y: 40, opacity: 0, rotate: -6, filter: 'blur(2px)' }
      : { y: 0, opacity: 1, rotate: 0 }
    }
    transition={{ duration: SINK_DURATION_S, ease: 'easeIn' }}
    onDragEnd={handleDragEnd}
   >
    {children}
    {sinking ? <DustStorm active /> : null}
   </motion.div>
  </div>
 );
});
