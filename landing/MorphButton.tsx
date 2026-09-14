import {
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  FocusEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
} from "react";
import {
  AnimatePresence,
  motion,
  useInView,
} from "framer-motion";
import {
  useMagneticButton,
  usePrefersReducedMotion,
} from "./hooks";
import "./morph-buttons.css";

export type MorphButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger";

interface MorphButtonBaseProps {
  readonly children: ReactNode;
  readonly variant?: MorphButtonVariant;
  readonly loading?: boolean;
  readonly success?: boolean;
  readonly magnetic?: boolean;
  readonly fullWidth?: boolean;
  readonly className?: string;
  readonly loadingLabel?: string;
  readonly successLabel?: string;
}

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  keyof MorphButtonBaseProps | "children"
>;

type NativeAnchorProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  keyof MorphButtonBaseProps | "children"
>;

export type MorphButtonProps =
  | (
      MorphButtonBaseProps &
      NativeButtonProps & {
        readonly href?: never;
      }
    )
  | (
      MorphButtonBaseProps &
      NativeAnchorProps & {
        readonly href: string;
        readonly disabled?: boolean;
      }
    );

interface BurstParticle {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly distanceX: number;
  readonly distanceY: number;
  readonly size: number;
  readonly color: string;
}

interface ClickEffect {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly particles: readonly BurstParticle[];
}

const particleColors = [
  "#FFFFFF",
  "#FFB347",
  "#FF2E93",
  "#6B93D6",
  "#7CFF6B",
] as const;

const metalEase = [0.19, 1, 0.22, 1] as const;
const successEase = [0.34, 1.56, 0.64, 1] as const;

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );

  useEffect(() => {
    function update(): void {
      setVisible(!document.hidden);
    }

    document.addEventListener("visibilitychange", update);
    update();

    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return visible;
}

function OrbitSpinner({
  animated,
}: {
  readonly animated: boolean;
}): JSX.Element {
  return (
    <span className="morph-spinner" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className={`morph-spinner-orbit morph-spinner-orbit--${index}`}
          animate={{
            rotate: animated ? [index * 120, index * 120 + 360] : index * 120,
          }}
          transition={
            animated
              ? {
                  duration: 0.85 + index * 0.3,
                  repeat: Infinity,
                  ease: "linear",
                }
              : { duration: 0 }
          }
        >
          <span />
        </motion.span>
      ))}
    </span>
  );
}

function SuccessMark({
  reducedMotion,
}: {
  readonly reducedMotion: boolean;
}): JSX.Element {
  return (
    <svg
      width="27"
      height="27"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <motion.path
        d="M6 14.5 11.5 20 22 8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{
          pathLength: reducedMotion ? 1 : 0,
          opacity: reducedMotion ? 1 : 0,
        }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{
          duration: reducedMotion ? 0 : 0.35,
          delay: reducedMotion ? 0 : 0.12,
          ease: metalEase,
        }}
      />
    </svg>
  );
}

export function MorphButton(props: MorphButtonProps): JSX.Element {
  const {
    children,
    variant = "primary",
    loading = false,
    success = false,
    magnetic = true,
    fullWidth = false,
    className = "",
    loadingLabel = "Загрузка…",
    successLabel = "✓ Готово",
    ...nativeProps
  } = props;

  const reducedMotion = usePrefersReducedMotion();
  const pageVisible = usePageVisible();

  const disabled = Boolean(nativeProps.disabled);
  const unavailable = disabled || loading;

  const magneticMotion = useMagneticButton<HTMLSpanElement>({
    disabled: !magnetic || unavailable,
  });

  const slotRef = useRef<HTMLSpanElement>(null);
  const serial = useRef(0);

  const isInView = useInView(magneticMotion.ref, {
    amount: 0,
    margin: "0px",
  });

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [slotWidth, setSlotWidth] = useState(0);
  const [successExpanded, setSuccessExpanded] = useState(false);
  const [effects, setEffects] = useState<readonly ClickEffect[]>([]);

  const animated = !reducedMotion && pageVisible && isInView;
  const showSuccess = success && !loading;
  const compact =
    !reducedMotion && (loading || (showSuccess && !successExpanded));

  useEffect(() => {
    const slot = slotRef.current;

    if (!slot) {
      return;
    }

    function measure(): void {
      setSlotWidth(slot?.clientWidth ?? 0);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    measure();

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setSuccessExpanded(false);

    if (!showSuccess) {
      return;
    }

    if (reducedMotion) {
      setSuccessExpanded(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setSuccessExpanded(true);
    }, 720);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showSuccess, reducedMotion]);

  useEffect(() => {
    if (unavailable || reducedMotion || !pageVisible || !isInView) {
      setPressed(false);
      setEffects([]);
    }
  }, [unavailable, reducedMotion, pageVisible, isInView]);

  useEffect(() => {
    if (!pageVisible) {
      setHovered(false);
    }
  }, [pageVisible]);

  function releasePress(): void {
    setPressed(false);
  }

  useEffect(() => {
    if (!pressed) {
      return;
    }

    window.addEventListener("pointerup", releasePress);
    window.addEventListener("pointercancel", releasePress);
    window.addEventListener("blur", releasePress);

    return () => {
      window.removeEventListener("pointerup", releasePress);
      window.removeEventListener("pointercancel", releasePress);
      window.removeEventListener("blur", releasePress);
    };
  }, [pressed]);

  function handlePointerEnter(event: PointerEvent<HTMLSpanElement>): void {
    if (
      event.pointerType === "mouse" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      setHovered(true);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLSpanElement>): void {
    if (
      !unavailable &&
      event.isPrimary &&
      event.button === 0
    ) {
      setPressed(true);
    }
  }

  function handleBlur(event: FocusEvent<HTMLSpanElement>): void {
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setFocused(false);
      setPressed(false);
    }
  }

  function createClickEffect(event: MouseEvent<HTMLSpanElement>): void {
    if (
      unavailable ||
      reducedMotion ||
      event.defaultPrevented ||
      !pageVisible
    ) {
      return;
    }

    const slot = slotRef.current;

    if (!slot) {
      return;
    }

    const bounds = slot.getBoundingClientRect();
    const keyboardClick = event.detail === 0;

    const scaleX = bounds.width > 0 ? slot.clientWidth / bounds.width : 1;
    const scaleY = bounds.height > 0 ? slot.clientHeight / bounds.height : 1;

    const x = keyboardClick
      ? slot.clientWidth / 2
      : (event.clientX - bounds.left) * scaleX;

    const y = keyboardClick
      ? slot.clientHeight / 2
      : (event.clientY - bounds.top) * scaleY;

    const id = ++serial.current;

    const particles = Array.from({ length: 12 }, (_, index) => {
      const angle =
        (index / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;

      const distance = 22 + Math.random() * 42;

      return {
        id: index,
        x,
        y,
        distanceX: Math.cos(angle) * distance,
        distanceY: Math.sin(angle) * distance,
        size: 2 + Math.random() * 2,
        color: particleColors[index % particleColors.length] ?? "#FFFFFF",
      };
    });

    setEffects((current) => [
      ...current.slice(-2),
      { id, x, y, particles },
    ]);
  }

  function removeEffect(id: number): void {
    setEffects((current) => current.filter((effect) => effect.id !== id));
  }

  const activeHover = hovered && !unavailable;
  const activeFocus = focused && !unavailable;

  const circleSize = Math.min(56, slotWidth || 56);
  const loadingWidth = Math.min(64, slotWidth || 64);

  const visualWidth = compact
    ? loading ? loadingWidth : circleSize
    : slotWidth || "100%";

  const label = loading
    ? loadingLabel
    : showSuccess
      ? successLabel
      : children;

  const visualContent = (
    <>
      <span className="morph-accessible-label">{label}</span>

      <span className="morph-surface" aria-hidden="true">
        <motion.span
          className="morph-metal"
          animate={
            animated
              ? {
                  x: ["-12%", "12%", "-12%"],
                  y: ["-5%", "5%", "-5%"],
                }
              : { x: "0%", y: "0%" }
          }
          transition={
            animated
              ? {
                  duration: activeHover ? 3 : 6,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
              : { duration: 0 }
          }
        />
        <span className="morph-surface-shade" />
        <span className="morph-surface-highlight" />
      </span>

      <span className="morph-visual-content" aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          {loading ? (
            <motion.span
              key="loading"
              className="morph-content-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <OrbitSpinner animated={animated} />
              {reducedMotion && (
                <span className="morph-reduced-label">{loadingLabel}</span>
              )}
            </motion.span>
          ) : showSuccess && !successExpanded && !reducedMotion ? (
            <motion.span
              key="success-mark"
              className="morph-content-state morph-success-mark"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <SuccessMark reducedMotion={reducedMotion} />
            </motion.span>
          ) : (
            <motion.span
              key={showSuccess ? "success-label" : "label"}
              className="morph-content-state"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
              animate={{
                opacity: 1,
                y: !reducedMotion && activeHover ? -1 : 0,
              }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
              transition={{
                duration: reducedMotion ? 0.15 : 0.25,
                ease: metalEase,
              }}
            >
              {showSuccess ? successLabel : children}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </>
  );

  let control: JSX.Element;

  if (nativeProps.href !== undefined) {
    const {
      disabled: anchorDisabled,
      onClick,
      tabIndex,
      ...anchorProps
    } = nativeProps;

    const anchorUnavailable = Boolean(anchorDisabled) || loading;

    control = (
      <a
        {...anchorProps}
        className="morph-control"
        data-morph-control
        aria-disabled={anchorUnavailable || undefined}
        aria-busy={loading || undefined}
        tabIndex={tabIndex}
        onClick={(event) => {
          if (anchorUnavailable) {
            event.preventDefault();
            return;
          }

          onClick?.(event);
        }}
      >
        {visualContent}
      </a>
    );
  } else {
    const {
      href: unusedHref,
      type = "button",
      disabled: buttonDisabled,
      ...buttonProps
    } = nativeProps;

    void unusedHref;

    control = (
      <button
        {...buttonProps}
        className="morph-control"
        data-morph-control
        type={type}
        disabled={Boolean(buttonDisabled) || loading}
        aria-busy={loading || undefined}
      >
        {visualContent}
      </button>
    );
  }

  return (
    <motion.span
      ref={magneticMotion.ref}
      className={`morph-button ${fullWidth ? "morph-button--full" : ""} ${className}`}
      data-variant={variant}
      data-disabled={unavailable}
      data-focused={focused}
      data-loading={loading}
      data-success={showSuccess}
      style={{
        x: magneticMotion.x,
        y: magneticMotion.y,
      }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={releasePress}
      onPointerCancel={releasePress}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={handleBlur}
      onClick={createClickEffect}
      onKeyDown={(event) => {
        if (
          !unavailable &&
          (event.key === " " || event.key === "Enter")
        ) {
          setPressed(true);
        }
      }}
      onKeyUp={releasePress}
    >
      <span ref={slotRef} className="morph-slot">
        <span className="morph-measure" aria-hidden="true">
          {children}
        </span>

        <span className="morph-stage-position">
          <motion.span
            className="morph-stage"
            animate={{
              width: visualWidth,
              borderRadius: compact ? 999 : 8,
              scale: reducedMotion
                ? 1
                : pressed
                  ? 0.97
                  : activeHover
                    ? 1.03
                    : 1,
              y: reducedMotion ? 0 : pressed ? 1 : 0,
              rotate:
                animated && activeFocus && !pressed
                  ? [-0.5, 0.5, -0.5]
                  : 0,
            }}
            transition={{
              width: reducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 180, damping: 24 },
              borderRadius: {
                duration: reducedMotion ? 0 : 0.3,
                ease: showSuccess ? successEase : metalEase,
              },
              scale: {
                duration: reducedMotion ? 0 : pressed ? 0.1 : 0.25,
                ease: metalEase,
              },
              y: {
                duration: reducedMotion ? 0 : 0.1,
              },
              rotate: {
                duration: animated && activeFocus ? 2 : 0,
                repeat: animated && activeFocus && !pressed ? Infinity : 0,
                ease: "easeInOut",
              },
            }}
          >
            <motion.span
              className="morph-glow-ring"
              aria-hidden="true"
              animate={{
                opacity: activeHover || activeFocus ? 1 : 0,
              }}
              transition={{ duration: reducedMotion ? 0.15 : 0.25 }}
            />
            {control}
          </motion.span>
        </span>

        <span className="morph-ripple-clip" aria-hidden="true">
          <AnimatePresence>
            {effects.map((effect) => (
              <motion.span
                key={effect.id}
                className="morph-ripple"
                style={{
                  left: effect.x,
                  top: effect.y,
                }}
                initial={{ opacity: 0.2, scale: 0 }}
                animate={{ opacity: 0, scale: 15 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: metalEase }}
                onAnimationComplete={() => removeEffect(effect.id)}
              />
            ))}
          </AnimatePresence>
        </span>

        <span className="morph-particles" aria-hidden="true">
          <AnimatePresence>
            {effects.flatMap((effect) =>
              effect.particles.map((particle) => (
                <motion.span
                  key={`${effect.id}-${particle.id}`}
                  className="morph-particle"
                  style={{
                    left: particle.x,
                    top: particle.y,
                    width: particle.size,
                    height: particle.size,
                    backgroundColor: particle.color,
                  }}
                  initial={{ x: 0, y: 0, opacity: 0.9, scale: 1 }}
                  animate={{
                    x: particle.distanceX,
                    y: particle.distanceY,
                    opacity: 0,
                    scale: 0.2,
                  }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: 0.4,
                    ease: [0.19, 1, 0.22, 1],
                  }}
                />
              )),
            )}
          </AnimatePresence>
        </span>
      </span>
    </motion.span>
  );
}
