import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RefObject } from "react";
import {
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
} from "framer-motion";
import type { MotionValue } from "framer-motion";
import Lenis from "lenis";
import { motionConfig } from "./content";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const finePointerQuery = "(hover: hover) and (pointer: fine)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", onChange);

  return () => {
    media.removeEventListener("change", onChange);
  };
}

function getReducedMotionSnapshot(): boolean {
  return (
    typeof window === "undefined" ||
    window.matchMedia(reducedMotionQuery).matches
  );
}

function getReducedMotionServerSnapshot(): boolean {
  return true;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothScrollEasing(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function getAnchorTarget(anchor: HTMLAnchorElement): HTMLElement | null {
  const href = anchor.getAttribute("href");

  if (!href || href === "#" || anchor.hasAttribute("download")) {
    return null;
  }

  if (anchor.target && anchor.target !== "_self") {
    return null;
  }

  let url: URL;

  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }

  if (
    url.origin !== window.location.origin ||
    url.pathname !== window.location.pathname ||
    url.search !== window.location.search ||
    !url.hash
  ) {
    return null;
  }

  try {
    return document.getElementById(decodeURIComponent(url.hash.slice(1)));
  } catch {
    return null;
  }
}

function focusScrollTarget(target: HTMLElement): void {
  if (!target.hasAttribute("tabindex") && target.tabIndex < 0) {
    target.setAttribute("tabindex", "-1");
  }

  target.focus({ preventScroll: true });
}

export function useSmoothScroll(): RefObject<Lenis | null> {
  const reducedMotion = usePrefersReducedMotion();
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    let frameId: number | null = null;
    let disposed = false;
    let lenis: Lenis | null = null;

    if (!reducedMotion) {
      lenis = new Lenis({
        duration: motionConfig.smoothScrollSeconds,
        easing: smoothScrollEasing,
        smoothWheel: true,
        syncTouch: false,
        autoRaf: false,
        anchors: false,
      });

      lenisRef.current = lenis;
    }

    const tick = (time: number): void => {
      frameId = null;

      if (disposed || document.hidden || !lenis) {
        return;
      }

      lenis.raf(time);
      frameId = window.requestAnimationFrame(tick);
    };

    const startFrameLoop = (): void => {
      if (!disposed && !document.hidden && lenis && frameId === null) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
          frameId = null;
        }

        lenis?.stop();
        return;
      }

      lenis?.start();
      startFrameLoop();
    };

    const handleAnchorClick = (event: MouseEvent): void => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");

      if (!anchor) {
        return;
      }

      const target = getAnchorTarget(anchor);

      if (!target) {
        return;
      }

      event.preventDefault();

      const headerHeight =
        document.querySelector("header")?.getBoundingClientRect().height ?? 80;
      const offset = -(headerHeight + 16);

      const finish = (): void => {
        if (disposed) {
          return;
        }

        const hash = `#${encodeURIComponent(target.id)}`;

        if (window.location.hash !== hash) {
          window.history.pushState(null, "", hash);
        }

        focusScrollTarget(target);
      };

      if (lenis) {
        lenis.scrollTo(target, {
          offset,
          duration: motionConfig.smoothScrollSeconds,
          easing: smoothScrollEasing,
          onComplete: finish,
        });
      } else {
        const top =
          window.scrollY + target.getBoundingClientRect().top + offset;

        window.scrollTo({
          top: Math.max(0, top),
          behavior: "auto",
        });

        finish();
      }
    };

    startFrameLoop();

    document.addEventListener("click", handleAnchorClick);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;

      document.removeEventListener("click", handleAnchorClick);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      lenis?.destroy();

      if (lenisRef.current === lenis) {
        lenisRef.current = null;
      }
    };
  }, [reducedMotion]);

  return lenisRef;
}

export interface MousePosition {
  readonly x: MotionValue<number>;
  readonly y: MotionValue<number>;
  readonly isActive: boolean;
}

export function useMousePosition(enabled = true): MousePosition {
  const reducedMotion = usePrefersReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    setIsActive(false);

    if (!enabled || reducedMotion) {
      return;
    }

    const media = window.matchMedia(finePointerQuery);
    let frameId: number | null = null;
    let nextX = 0;
    let nextY = 0;

    const flushPosition = (): void => {
      frameId = null;
      x.set(nextX);
      y.set(nextY);
      setIsActive(true);
    };

    const deactivate = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }

      setIsActive(false);
    };

    const handlePointerMove = (event: PointerEvent): void => {
      if (!media.matches || event.pointerType !== "mouse") {
        deactivate();
        return;
      }

      nextX = event.clientX;
      nextY = event.clientY;

      if (frameId === null) {
        frameId = window.requestAnimationFrame(flushPosition);
      }
    };

    const handlePointerOut = (event: PointerEvent): void => {
      if (event.relatedTarget === null) {
        deactivate();
      }
    };

    const handleMediaChange = (): void => {
      if (!media.matches) {
        deactivate();
      }
    };

    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        deactivate();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerout", handlePointerOut);
    window.addEventListener("blur", deactivate);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    media.addEventListener("change", handleMediaChange);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", deactivate);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      media.removeEventListener("change", handleMediaChange);

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [enabled, reducedMotion, x, y]);

  return {
    x,
    y,
    isActive: enabled && !reducedMotion && isActive,
  };
}

export interface TypewriterOptions {
  readonly text: string;
  readonly delayMs?: number;
  readonly startDelayMs?: number;
  readonly enabled?: boolean;
}

export interface TypewriterResult {
  readonly displayedText: string;
  readonly isComplete: boolean;
}

interface TypewriterState {
  readonly source: string;
  readonly visibleCount: number;
}

export function useTypewriter({
  text,
  delayMs = motionConfig.hero.typewriterDelayMs,
  startDelayMs = 0,
  enabled = true,
}: TypewriterOptions): TypewriterResult {
  const reducedMotion = usePrefersReducedMotion();
  const characters = useMemo(() => Array.from(text), [text]);

  const [state, setState] = useState<TypewriterState>({
    source: text,
    visibleCount: 0,
  });

  useEffect(() => {
    let timeoutId: number | null = null;
    let disposed = false;
    let visibleCount = 0;

    if (reducedMotion) {
      setState({
        source: text,
        visibleCount: characters.length,
      });

      return;
    }

    setState({ source: text, visibleCount: 0 });

    if (!enabled || characters.length === 0) {
      return;
    }

    const revealCharacter = (): void => {
      if (disposed) {
        return;
      }

      visibleCount += 1;
      setState({ source: text, visibleCount });

      if (visibleCount < characters.length) {
        timeoutId = window.setTimeout(
          revealCharacter,
          Math.max(1, delayMs),
        );
      }
    };

    timeoutId = window.setTimeout(
      revealCharacter,
      Math.max(0, startDelayMs) + Math.max(1, delayMs),
    );

    return () => {
      disposed = true;

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    text,
    characters.length,
    delayMs,
    startDelayMs,
    enabled,
    reducedMotion,
  ]);

  const visibleCount =
    state.source === text ? state.visibleCount : 0;

  return {
    displayedText: reducedMotion
      ? text
      : characters.slice(0, visibleCount).join(""),
    isComplete: reducedMotion || visibleCount >= characters.length,
  };
}

export interface CountUpOptions {
  readonly target: number;
  readonly decimals?: number;
  readonly once?: boolean;
  readonly amount?: number;
}

export interface CountUpResult<T extends HTMLElement> {
  readonly ref: RefObject<T>;
  readonly value: number;
  readonly isInView: boolean;
}

export function useCountUp<T extends HTMLElement = HTMLSpanElement>({
  target,
  decimals = 0,
  once = true,
  amount = 0.35,
}: CountUpOptions): CountUpResult<T> {
  const ref = useRef<T>(null);
  const reducedMotion = usePrefersReducedMotion();

  const isInView = useInView(ref, {
    once,
    amount: clamp(amount, 0, 1),
  });

  const safeTarget = Number.isFinite(target) ? target : 0;
  const precision = clamp(Math.floor(decimals), 0, 6);
  const factor = Math.pow(10, precision);
  const roundedTarget = Math.round(safeTarget * factor) / factor;

  const spring = useSpring(0, {
    ...motionConfig.springs.counter,
    restDelta: 0.001,
    restSpeed: 0.001,
  });

  const [value, setValue] = useState(
    reducedMotion ? roundedTarget : 0,
  );

  useMotionValueEvent(spring, "change", (latest) => {
    const boundedValue = clamp(
      latest,
      Math.min(0, safeTarget),
      Math.max(0, safeTarget),
    );

    setValue(Math.round(boundedValue * factor) / factor);
  });

  useEffect(() => {
    if (reducedMotion) {
      spring.jump(safeTarget);
      setValue(roundedTarget);
      return;
    }

    spring.set(isInView ? safeTarget : 0);
  }, [isInView, reducedMotion, roundedTarget, safeTarget, spring]);

  return {
    ref,
    value: reducedMotion ? roundedTarget : value,
    isInView,
  };
}

export interface MagneticButtonOptions {
  readonly radius?: number;
  readonly strength?: number;
  readonly maxOffset?: number;
  readonly disabled?: boolean;
}

export interface MagneticButtonResult<T extends HTMLElement> {
  readonly ref: RefObject<T>;
  readonly x: MotionValue<number>;
  readonly y: MotionValue<number>;
  readonly reset: () => void;
}

export function useMagneticButton<
  T extends HTMLElement = HTMLButtonElement,
>({
  radius = motionConfig.magnetic.radiusPx,
  strength = motionConfig.magnetic.strength,
  maxOffset = motionConfig.magnetic.maxOffsetPx,
  disabled = false,
}: MagneticButtonOptions = {}): MagneticButtonResult<T> {
  const ref = useRef<T>(null);
  const reducedMotion = usePrefersReducedMotion();

  const x = useSpring(0, motionConfig.springs.magnetic);
  const y = useSpring(0, motionConfig.springs.magnetic);

  const reset = useCallback((): void => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  useEffect(() => {
    if (disabled || reducedMotion) {
      x.jump(0);
      y.jump(0);
      return;
    }

    const media = window.matchMedia(finePointerQuery);
    const safeRadius = Math.max(1, radius);
    const safeStrength = Math.max(0, strength);
    const safeMaxOffset = Math.max(0, maxOffset);

    let frameId: number | null = null;
    let clientX = 0;
    let clientY = 0;

    const clearFrame = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
    };

    const deactivate = (): void => {
      clearFrame();
      reset();
    };

    const updatePosition = (): void => {
      frameId = null;

      const element = ref.current;

      if (
        !element ||
        !media.matches ||
        element.matches(":disabled, [aria-disabled='true']")
      ) {
        reset();
        return;
      }

      const rect = element.getBoundingClientRect();

      if (rect.width === 0 || rect.height === 0) {
        reset();
        return;
      }

      const left = rect.left - x.get();
      const top = rect.top - y.get();
      const right = left + rect.width;
      const bottom = top + rect.height;

      const nearestX = clamp(clientX, left, right);
      const nearestY = clamp(clientY, top, bottom);
      const distance = Math.hypot(
        clientX - nearestX,
        clientY - nearestY,
      );

      if (distance > safeRadius) {
        reset();
        return;
      }

      const attraction = 1 - distance / safeRadius;
      const centerX = left + rect.width / 2;
      const centerY = top + rect.height / 2;

      x.set(
        clamp(
          (clientX - centerX) * safeStrength * attraction,
          -safeMaxOffset,
          safeMaxOffset,
        ),
      );

      y.set(
        clamp(
          (clientY - centerY) * safeStrength * attraction,
          -safeMaxOffset,
          safeMaxOffset,
        ),
      );
    };

    const handlePointerMove = (event: PointerEvent): void => {
      if (!media.matches || event.pointerType !== "mouse") {
        deactivate();
        return;
      }

      clientX = event.clientX;
      clientY = event.clientY;

      if (frameId === null) {
        frameId = window.requestAnimationFrame(updatePosition);
      }
    };

    const handlePointerOut = (event: PointerEvent): void => {
      if (event.relatedTarget === null) {
        deactivate();
      }
    };

    const handleMediaChange = (): void => {
      if (!media.matches) {
        deactivate();
      }
    };

    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        deactivate();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerout", handlePointerOut);
    window.addEventListener("blur", deactivate);
    window.addEventListener("scroll", deactivate, { passive: true });
    window.addEventListener("resize", deactivate);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    media.addEventListener("change", handleMediaChange);

    return () => {
      clearFrame();

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", deactivate);
      window.removeEventListener("scroll", deactivate);
      window.removeEventListener("resize", deactivate);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      media.removeEventListener("change", handleMediaChange);

      x.stop();
      y.stop();
    };
  }, [
    disabled,
    reducedMotion,
    radius,
    strength,
    maxOffset,
    reset,
    x,
    y,
  ]);

  return { ref, x, y, reset };
}
