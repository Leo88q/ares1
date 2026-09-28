import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useSpring,
  useTransform,
} from "framer-motion";
import { usePrefersReducedMotion } from "../components/ares/effects";

const easeOutCubic = [1 / 3, 1, 2 / 3, 1] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function useVisibleEffects<T extends HTMLElement>(ref: RefObject<T>): boolean {
  const reducedMotion = usePrefersReducedMotion();
  const inView = useInView(ref, { amount: 0 });

  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );

  useEffect(() => {
    function refresh(): void {
      setVisible(!document.hidden);
    }

    refresh();
    document.addEventListener("visibilitychange", refresh);

    return () => {
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return !reducedMotion && inView && visible;
}

export interface SparkProgressProps {
  readonly value: number;
  readonly max?: number;
  readonly label: string;
  readonly valueText?: string;
  readonly color?: string;
  readonly className?: string;
}

export function SparkProgress({
  value,
  max = 100,
  label,
  valueText,
  color = "#FF2E93",
  className = "",
}: SparkProgressProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const visibleEffects = useVisibleEffects(ref);
  const everInView = useInView(ref, { once: true, amount: 0.1 });

  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? clamp(value, 0, safeMax) : 0;
  const fraction = safeValue / safeMax;

  const fill = useSpring(0, { stiffness: 90, damping: 22, restDelta: 0.001 });
  const headX = useTransform(fill, (current) => `${clamp(current, 0, 1) * 100}%`);

  const [completedBurst, setCompletedBurst] = useState(false);

  useEffect(() => {
    if (reducedMotion) {
      fill.jump(fraction);
      return;
    }

    fill.set(everInView ? fraction : 0);
  }, [fraction, everInView, reducedMotion, fill]);

  useEffect(() => {
    if (!everInView || fraction < 1 || reducedMotion) {
      setCompletedBurst(false);
      return;
    }

    setCompletedBurst(true);

    const timer = window.setTimeout(() => {
      setCompletedBurst(false);
    }, 800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [everInView, fraction, reducedMotion]);

  return (
    <div
      ref={ref}
      className={`spark-progress ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
      aria-valuetext={valueText}
    >
      <motion.div
        className="spark-progress-track"
        animate={{ scaleY: completedBurst && visibleEffects ? [1, 1.7, 1] : 1 }}
        transition={{ duration: reducedMotion ? 0 : 0.5 }}
        aria-hidden="true"
      >
        <motion.div
          className="spark-progress-fill"
          style={{ scaleX: fill, backgroundColor: color }}
        />
      </motion.div>

      <motion.div
        className="spark-progress-head"
        style={{ x: headX }}
        aria-hidden="true"
      >
        {visibleEffects && fraction > 0 && fraction < 1 && (
          <>
            {Array.from({ length: 5 }, (_, index) => (
              <motion.i
                key={index}
                className="spark-progress-particle"
                style={{ backgroundColor: index % 2 ? "#FFFFFF" : color }}
                initial={{ opacity: 0 }}
                animate={{
                  x: [0, -8 - index * 4],
                  y: [0, -7 - index * 3],
                  opacity: [0, 0.85, 0],
                  scale: [0.7, 1, 0.2],
                }}
                transition={{
                  duration: 1.3 + index * 0.12,
                  delay: index * 0.2,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
              />
            ))}
          </>
        )}

        <AnimatePresence>
          {completedBurst && visibleEffects && (
            <motion.span
              key="completion-burst"
              className="spark-complete-burst"
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7 }}
            >
              {Array.from({ length: 10 }, (_, index) => {
                const angle = (index / 10) * Math.PI * 2;

                return (
                  <motion.i
                    key={index}
                    className="spark-progress-particle"
                    style={{ backgroundColor: index % 2 ? "#7CFF6B" : color }}
                    initial={{ x: 0, y: 0, scale: 1 }}
                    animate={{
                      x: Math.cos(angle) * 30,
                      y: Math.sin(angle) * 25,
                      scale: 0,
                    }}
                    transition={{ duration: 0.65, ease: easeOutCubic }}
                  />
                );
              })}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
