import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { t } from "./i18n";
import {
  motion,
  useMotionValue,
  useSpring,
} from "framer-motion";
import { usePrefersReducedMotion } from "./hooks";
import "./ares-hull.css";

export interface AresHullFrameProps {
  readonly variant?: "default" | "accent" | "danger";
  readonly runningLight?: boolean;
}

interface FrameSize {
  readonly width: number;
  readonly height: number;
}

type FrameListener = (deltaSeconds: number) => void;

const frameListeners = new Set<FrameListener>();

let animationFrame: number | null = null;
let previousTime: number | null = null;
let visibilityListening = false;

const frameInterval = 1000 / 30;

const skins = {
  default: {
    accent: "#D4A576",
    plate: "МОДУЛЬ",
  },
  accent: {
    accent: "#ED8A45",
    plate: "ARES-1",
  },
  danger: {
    accent: "#DE8C8C",
    plate: "ИЗОЛЯЦИЯ",
  },
} as const;

function stopSharedFrames(): void {
  if (animationFrame !== null) {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  previousTime = null;
}

function tickSharedFrames(now: number): void {
  animationFrame = null;

  if (document.hidden || frameListeners.size === 0) {
    previousTime = null;
    return;
  }

  if (previousTime === null) {
    previousTime = now;
    animationFrame = window.requestAnimationFrame(tickSharedFrames);
    return;
  }

  const elapsed = now - previousTime;

  if (elapsed < frameInterval - 0.5) {
    animationFrame = window.requestAnimationFrame(tickSharedFrames);
    return;
  }

  previousTime = now;
  const deltaSeconds = Math.min(elapsed / 1000, 0.06);

  for (const listener of frameListeners) {
    listener(deltaSeconds);
  }

  if (frameListeners.size > 0 && !document.hidden) {
    animationFrame = window.requestAnimationFrame(tickSharedFrames);
  }
}

function startSharedFrames(): void {
  if (
    animationFrame !== null ||
    document.hidden ||
    frameListeners.size === 0
  ) {
    return;
  }

  previousTime = null;
  animationFrame = window.requestAnimationFrame(tickSharedFrames);
}

function onSharedVisibility(): void {
  if (document.hidden) {
    stopSharedFrames();
  } else {
    startSharedFrames();
  }
}

function subscribeFrames(listener: FrameListener): () => void {
  frameListeners.add(listener);

  if (!visibilityListening) {
    document.addEventListener("visibilitychange", onSharedVisibility);
    visibilityListening = true;
  }

  startSharedFrames();

  return () => {
    frameListeners.delete(listener);

    if (frameListeners.size === 0) {
      stopSharedFrames();

      if (visibilityListening) {
        document.removeEventListener(
          "visibilitychange",
          onSharedVisibility,
        );
        visibilityListening = false;
      }
    }
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function AresHullFrame({
  variant = "default",
  runningLight = true,
}: AresHullFrameProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();

  const rootRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<FrameSize>({ width: 300, height: 220 });

  const [engaged, setEngaged] = useState(false);
  const [visible, setVisible] = useState(false);

  const latchTarget = useMotionValue(0);
  const latch = useSpring(latchTarget, {
    stiffness: 220,
    damping: 25,
    mass: 0.7,
  });

  const pressureTarget = useMotionValue(0);
  const pressure = useSpring(pressureTarget, {
    stiffness: 150,
    damping: 22,
  });

  const traceOpacity = useMotionValue(0);

  const skin = skins[variant];
  const compact = size.height < 140;

  useLayoutEffect(() => {
    const root = rootRef.current;
    const hostMaybe = root?.parentElement;

    if (!root || !hostMaybe) {
      return;
    }

    const host: HTMLElement = hostMaybe;

    const previousHull = host.getAttribute("data-ares-hull");
    const previousSkin = host.getAttribute("data-ares-skin");

    host.setAttribute("data-ares-hull", "true");
    host.setAttribute("data-ares-skin", variant);

    function measure(): void {
      const width = Math.max(36, host.clientWidth);
      const height = Math.max(36, host.clientHeight);

      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(host);
    measure();

    return () => {
      resizeObserver.disconnect();

      if (previousHull === null) {
        host.removeAttribute("data-ares-hull");
      } else {
        host.setAttribute("data-ares-hull", previousHull);
      }

      if (previousSkin === null) {
        host.removeAttribute("data-ares-skin");
      } else {
        host.setAttribute("data-ares-skin", previousSkin);
      }
    };
  }, [variant]);

  useEffect(() => {
    const root = rootRef.current;
    const hostMaybe = root?.parentElement;

    if (!root || !hostMaybe) {
      return;
    }

    const host: HTMLElement = hostMaybe;

    let hovered = false;
    let focused = false;
    let intersecting = false;

    const finePointer = window.matchMedia(
      "(hover: hover) and (pointer: fine)",
    );

    function sync(): void {
      setEngaged(intersecting && !document.hidden && (hovered || focused));
    }

    function onEnter(event: PointerEvent): void {
      if (finePointer.matches && event.pointerType === "mouse") {
        hovered = true;
        sync();
      }
    }

    function onLeave(): void {
      hovered = false;
      pressureTarget.set(0);
      sync();
    }

    function onMove(event: PointerEvent): void {
      if (reducedMotion || !hovered || !finePointer.matches || document.hidden) {
        return;
      }

      const bounds = host.getBoundingClientRect();

      if (bounds.width === 0) {
        return;
      }

      const fraction = (event.clientX - bounds.left) / bounds.width;
      pressureTarget.set(clamp((fraction - 0.5) * 2, -1, 1));
    }

    function onFocus(): void {
      focused = true;
      sync();
    }

    function onBlur(event: FocusEvent): void {
      if (
        event.relatedTarget instanceof Node &&
        host.contains(event.relatedTarget)
      ) {
        return;
      }

      focused = false;
      sync();
    }

    function onVisibility(): void {
      if (document.hidden) {
        hovered = false;
        pressureTarget.jump(0);
      }

      sync();
    }

    function onWindowBlur(): void {
      hovered = false;
      focused = false;
      pressureTarget.set(0);
      sync();
    }

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        intersecting = Boolean(entries[0]?.isIntersecting);
        setVisible(intersecting);

        if (!intersecting) {
          hovered = false;
          pressureTarget.set(0);
        }

        sync();
      },
      { threshold: 0 },
    );

    intersectionObserver.observe(host);

    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("focusin", onFocus);
    host.addEventListener("focusout", onBlur);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      intersectionObserver.disconnect();
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("focusin", onFocus);
      host.removeEventListener("focusout", onBlur);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pressureTarget, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) {
      latch.jump(0);
      latchTarget.jump(0);
      pressure.jump(0);
      pressureTarget.jump(0);
      return;
    }

    latchTarget.set(engaged ? 1.8 : 0);
  }, [engaged, reducedMotion, latch, latchTarget, pressure, pressureTarget]);

  useEffect(() => {
    if (reducedMotion || !runningLight || !visible) {
      traceOpacity.set(0);
      return;
    }

    let elapsed = 0;

    traceOpacity.set(0);

    return subscribeFrames((deltaSeconds) => {
      elapsed += deltaSeconds;

      const cycle = elapsed % 3.6;
      const moving = cycle <= 1.45;
      const progress = clamp(cycle / 1.45, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 2);

      traceOpacity.set(moving ? Math.sin(progress * Math.PI) * (engaged ? 0.95 : 0.6) : 0);
      void eased;
    });
  }, [engaged, visible, reducedMotion, runningLight, traceOpacity]);

  return (
    <span ref={rootRef} className="ares-hull-frame" aria-hidden="true">
      <motion.img
        className="ares-hull-svg"
        src="/ares/hull-frame.webp"
        alt=""
        style={{
          x: reducedMotion ? 0 : pressure,
          y: reducedMotion ? 0 : latch,
        }}
      />
      <span
        className="ares-hull-glow"
        style={{
          background: `radial-gradient(120% 90% at 50% 0%, ${skin.accent}14, transparent 60%)`,
        }}
      />
      {!compact && size.width >= 180 && (
        <span className="ares-hull-plate">{t(skin.plate)}</span>
      )}
      <motion.span
        className="ares-hull-corner"
        style={{ background: skin.accent }}
        animate={{ opacity: engaged ? 0.95 : 0.3 }}
        transition={{ duration: reducedMotion ? 0.15 : 0.2 }}
      />
      {!reducedMotion && runningLight && (
        <motion.span className="ares-hull-sweep" style={{ opacity: traceOpacity }} />
      )}
    </span>
  );
}
