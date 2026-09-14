import {
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  AnchorHTMLAttributes,
  ReactNode,
  RefObject,
} from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "framer-motion";
import { usePrefersReducedMotion } from "./hooks";
import "./micro-motion.css";

const easeOutCubic = [1 / 3, 1, 2 / 3, 1] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function useVisibleEffects<T extends HTMLElement>(
  ref: RefObject<T>,
): boolean {
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

export interface AnimatedTextLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly children: ReactNode;
}

export function AnimatedTextLink({
  children,
  className = "",
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: AnimatedTextLinkProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;

  return (
    <a
      {...props}
      className={`micro-text-link ${className}`}
      onMouseEnter={(event) => {
        setHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
    >
      {children}

      <svg
        className="micro-link-underline"
        viewBox="0 0 100 4"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <motion.path
          d="M1 2H99"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          initial={false}
          animate={{
            pathLength: reducedMotion ? 1 : active ? 1 : 0,
            opacity: reducedMotion ? active ? 1 : 0 : 1,
          }}
          transition={{
            duration: reducedMotion ? 0.15 : 0.3,
            ease: easeOutCubic,
          }}
        />
      </svg>
    </a>
  );
}

export interface MotionIconProps {
  readonly children: ReactNode;
  readonly active?: boolean;
  readonly pressed?: boolean;
  readonly className?: string;
}

/**
 * Decorative wrapper only. The parent button or link owns accessibility.
 */
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
          scale:
            reducedMotion || burst === 0
              ? 1
              : [0.9, 1.1, 1],
        }}
        transition={{ duration: reducedMotion ? 0 : 0.25 }}
        style={{ color: highlighted ? "#FF75B9" : undefined }}
      >
        {children}
      </motion.span>
    </motion.span>
  );
}

export interface RollingNumberProps {
  readonly value: number;
  readonly decimals?: number;
  readonly className?: string;
  readonly label?: string;
  readonly minimumDigits?: number;
}

export function RollingNumber({
  value,
  decimals = 0,
  className = "",
  label,
  minimumDigits = 1,
}: RollingNumberProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const safeValue = Number.isFinite(value) ? value : 0;
  const precision = clamp(Math.floor(decimals), 0, 6);
  const digits = clamp(Math.floor(minimumDigits), 1, 21);

  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    minimumIntegerDigits: digits,
  }).format(safeValue);

  const characters = Array.from(formatted);

  return (
    <span className={`rolling-number ${className}`}>
      <span className="micro-sr-only">{label ?? formatted}</span>

      <span className="rolling-number-visual" aria-hidden="true">
        {characters.map((character, index) => {
          const positionFromRight = characters.length - index - 1;
          const numeric = /^\d$/.test(character);

          if (!numeric) {
            return (
              <span
                key={`separator-${positionFromRight}`}
                className="rolling-separator"
              >
                {character}
              </span>
            );
          }

          return (
            <span
              key={`digit-${positionFromRight}`}
              className="rolling-digit"
            >
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={character}
                  className="rolling-digit-value"
                  initial={{
                    y: reducedMotion ? "0%" : "105%",
                    opacity: reducedMotion ? 0 : 1,
                  }}
                  animate={{ y: "0%", opacity: 1 }}
                  exit={{
                    y: reducedMotion ? "0%" : "-105%",
                    opacity: reducedMotion ? 0 : 1,
                  }}
                  transition={{
                    duration: reducedMotion ? 0.15 : 0.36,
                    ease: easeOutCubic,
                  }}
                >
                  {character}
                </motion.span>
              </AnimatePresence>
            </span>
          );
        })}
      </span>
    </span>
  );
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
  const safeValue = Number.isFinite(value)
    ? clamp(value, 0, safeMax)
    : 0;

  const fraction = safeValue / safeMax;

  const fill = useSpring(0, {
    stiffness: 90,
    damping: 22,
    restDelta: 0.001,
  });

  const headX = useTransform(fill, (current) =>
    `${clamp(current, 0, 1) * 100}%`,
  );

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
        animate={{
          scaleY:
            completedBurst && visibleEffects
              ? [1, 1.7, 1]
              : 1,
        }}
        transition={{ duration: reducedMotion ? 0 : 0.5 }}
        aria-hidden="true"
      >
        <motion.div
          className="spark-progress-fill"
          style={{
            scaleX: fill,
            backgroundColor: color,
          }}
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

function RocketArt(): JSX.Element {
  return (
    <svg
      width="24"
      height="44"
      viewBox="0 0 24 44"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3C7 8 7 19 7 28H17C17 19 17 8 12 3Z"
        fill="#DED8E5"
        stroke="#8E809F"
      />
      <path d="M7 19 3 27v8l5-6M17 19l4 8v8l-5-6" fill="#FF2E93" />
      <circle cx="12" cy="16" r="3" fill="#172234" stroke="#6B93D6" />
      <path d="M9 29h6v4H9Z" fill="#79707F" />
      <path d="m9 34 3 8 3-8" fill="#FFB347" />
      <path d="m11 34 1 5 1-5" fill="#FFF0CE" />
    </svg>
  );
}

export function ScrollRocket(): JSX.Element | null {
  const reducedMotion = usePrefersReducedMotion();
  const { scrollY, scrollYProgress } = useScroll();
  const velocity = useVelocity(scrollY);

  const inclination = useTransform(
    velocity,
    (value) => clamp(value / 160, -11, 11),
  );

  const rotation = useSpring(inclination, {
    stiffness: 150,
    damping: 20,
  });

  const progress = useSpring(scrollYProgress, {
    stiffness: 110,
    damping: 24,
  });

  const trackHeight = useMotionValue(1);
  const y = useTransform(
    [progress, trackHeight],
    (values: number[]) => {
      const fraction = values[0] ?? 0;
      const height = values[1] ?? 1;
      return clamp(fraction, 0, 1) * Math.max(0, height - 44);
    },
  );

  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    function measure(): void {
      trackHeight.set(track?.clientHeight ?? 1);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(track);
    measure();

    return () => {
      observer.disconnect();
    };
  }, [trackHeight, reducedMotion]);

  if (reducedMotion) {
    return null;
  }

  return (
    <div
      ref={trackRef}
      className="scroll-rocket-track"
      aria-hidden="true"
    >
      <div className="scroll-rocket-line" />

      <motion.div
        className="scroll-rocket"
        style={{ y, rotate: rotation }}
      >
        <RocketArt />
      </motion.div>
    </div>
  );
}
