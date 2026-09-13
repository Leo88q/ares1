import { useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "../components/ares/effects";

export interface MotionIconProps {
  readonly children: ReactNode;
  readonly active?: boolean;
  readonly pressed?: boolean;
  readonly className?: string;
}

export function MotionIcon({
  children,
  active = false,
  pressed = false,
  className = "",
}: MotionIconProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [localPress, setLocalPress] = useState(false);
  const [burst, setBurst] = useState(0);

  const highlighted = active || hovered;
  const pushing = pressed || localPress;

  return (
    <motion.span
      className={`micro-icon ${className}`}
      aria-hidden="true"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          setHovered(true);
        }
      }}
      onPointerLeave={() => {
        setHovered(false);
        setLocalPress(false);
      }}
      onPointerDown={(event) => {
        if (event.button === 0) {
          setLocalPress(true);
        }
      }}
      onPointerUp={() => {
        setLocalPress(false);
        setBurst((value) => value + 1);
      }}
      onPointerCancel={() => setLocalPress(false)}
      animate={{
        rotate: reducedMotion ? 0 : highlighted ? 5 : 0,
        scale: reducedMotion ? 1 : pushing ? 0.9 : highlighted ? 1.1 : 1,
      }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 300, damping: 20 }
      }
    >
      <motion.span
        key={burst}
        className="micro-icon-inner"
        initial={false}
        animate={{
          scale: reducedMotion || burst === 0 ? 1 : [0.9, 1.1, 1],
        }}
        transition={{ duration: reducedMotion ? 0 : 0.25 }}
        style={{ color: highlighted ? "#FF75B9" : undefined }}
      >
        {children}
      </motion.span>
    </motion.span>
  );
}
