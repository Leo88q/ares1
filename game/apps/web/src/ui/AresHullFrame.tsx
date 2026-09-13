import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  motion,
  useMotionValue,
  useSpring,
} from "framer-motion";
import { usePrefersReducedMotion } from "../components/ares/effects";
import { HullLightCircuit } from "./HullLightCircuit";

export interface AresHullFrameProps {
  readonly variant?: "default" | "accent" | "danger";
  readonly runningLight?: boolean;
}

interface FrameSize {
  readonly width: number;
  readonly height: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface HullGeometry {
  readonly outer: string;
  readonly inner: string;
  readonly route: string;
  readonly topBracket: string;
  readonly bottomBracket: string;
  readonly rightBracket: string;
  readonly servicePath: string;
  readonly fasteners: readonly Point[];
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
    trace: "#E5C7A5",
    plate: "МОДУЛЬ",
    surface: "#191E2A",
    inner: "#10141E",
    caution: "#B17C4F",
  },
  accent: {
    accent: "#ED8A45",
    trace: "#FFB347",
    plate: "ARES-1",
    surface: "#1C1928",
    inner: "#11121D",
    caution: "#D77A36",
  },
  danger: {
    accent: "#DE8C8C",
    trace: "#FFB0A8",
    plate: "ИЗОЛЯЦИЯ",
    surface: "#1C1317",
    inner: "#150F14",
    caution: "#B96D69",
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

function polygonPath(points: readonly Point[]): string {
  return (
    points
      .map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      })
      .join(" ") + " Z"
  );
}

function createHullGeometry(width: number, height: number): HullGeometry {
  const left = 1;
  const top = 1;
  const right = Math.max(35, width - 1);
  const bottom = Math.max(35, height - 1);

  const shoulder = Math.min(22, width * 0.08, height * 0.12);
  const heel = Math.min(14, width * 0.06, height * 0.1);
  const inset = 5;

  const serviceTop = Math.max(
    shoulder + 16,
    Math.min(height * 0.4, height - 64),
  );

  const serviceBottom = Math.min(
    bottom - heel - 14,
    serviceTop + Math.min(40, height * 0.18),
  );

  const lockStart = Math.max(48, width * 0.67);
  const lockEnd = Math.min(right - shoulder - 8, lockStart + 28);
  const lockEnabled = width >= 190 && lockEnd > lockStart + 8;
  const serviceEnabled = height >= 150;

  const outerPoints: Point[] = [
    { x: left + shoulder, y: top },
    { x: right - heel, y: top },
    { x: right, y: top + heel },
  ];

  if (serviceEnabled) {
    outerPoints.push(
      { x: right, y: serviceTop },
      { x: right - 5, y: serviceTop + 5 },
      { x: right - 5, y: serviceBottom - 5 },
      { x: right, y: serviceBottom },
    );
  }

  outerPoints.push(
    { x: right, y: bottom - shoulder },
    { x: right - shoulder, y: bottom },
  );

  if (lockEnabled) {
    outerPoints.push(
      { x: lockEnd, y: bottom },
      { x: lockEnd - 4, y: bottom - 5 },
      { x: lockStart + 4, y: bottom - 5 },
      { x: lockStart, y: bottom },
    );
  }

  outerPoints.push(
    { x: left + heel, y: bottom },
    { x: left, y: bottom - heel },
    { x: left, y: top + shoulder },
  );

  const inner = polygonPath([
    { x: left + shoulder + 2, y: top + inset },
    { x: right - heel - 2, y: top + inset },
    { x: right - inset, y: top + heel + 2 },
    { x: right - inset, y: bottom - shoulder - 2 },
    { x: right - shoulder - 2, y: bottom - inset },
    { x: left + heel + 2, y: bottom - inset },
    { x: left + inset, y: bottom - heel - 2 },
    { x: left + inset, y: top + shoulder + 2 },
  ]);

  const outer = polygonPath(outerPoints);

  return {
    outer,
    inner,
    route: outer,
    topBracket:
      `M${left} ${top + shoulder + 18}` +
      ` V${top + shoulder}` +
      ` L${left + shoulder} ${top}` +
      ` H${left + shoulder + 42}`,
    bottomBracket:
      `M${right - shoulder - 43} ${bottom}` +
      ` H${right - shoulder}` +
      ` L${right} ${bottom - shoulder}` +
      ` V${bottom - shoulder - 20}`,
    rightBracket:
      `M${right - heel - 27} ${top}` +
      ` H${right - heel}` +
      ` L${right} ${top + heel}` +
      ` V${top + heel + 13}`,
    servicePath: serviceEnabled
      ? `M${right - 2} ${serviceTop + 8} V${serviceBottom - 8}`
      : "",
    fasteners: [
      { x: left + 12, y: top + shoulder + 13 },
      { x: right - heel - 12, y: top + 12 },
      { x: right - 12, y: bottom - shoulder - 13 },
      { x: left + heel + 12, y: bottom - 12 },
    ],
  };
}

export function AresHullFrame({
  variant = "default",
  runningLight = true,
}: AresHullFrameProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const id = useId().replace(/:/g, "");

  const rootRef = useRef<HTMLSpanElement>(null);
  const traceRef = useRef<SVGPathElement | null>(null);
  const [size, setSize] = useState<FrameSize>({ width: 300, height: 220 });

  const [engaged, setEngaged] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);

  useEffect(() => {
    function updateVisibility(): void {
      setPageVisible(!document.hidden);
    }

    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();

    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

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
  const geometry = createHullGeometry(size.width, size.height);
  const compact = size.height < 140;
  const wide = size.width >= 430;

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

      traceRef.current?.setAttribute(
        "stroke-dashoffset",
        String(-eased * 1000),
      );

      traceOpacity.set(moving ? Math.sin(progress * Math.PI) * (engaged ? 0.95 : 0.6) : 0);
    });
  }, [engaged, visible, reducedMotion, runningLight, traceOpacity]);

  return (
    <span ref={rootRef} className="ares-hull-frame" aria-hidden="true">
      <svg
        className="ares-hull-svg"
        viewBox={`0 0 ${size.width} ${size.height}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        focusable="false"
      >
        <defs>
          <pattern
            id={`${id}-machining`}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 5.5H6"
              stroke="#D9C9B7"
              strokeOpacity="0.09"
              strokeWidth="0.5"
            />
          </pattern>

          <pattern
            id={`${id}-hazard`}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <rect width="3" height="8" fill={skin.caution} />
          </pattern>
          <pattern
            id={`${id}-brush`}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
          >
            <path d="M0 1H4" stroke="#FFFFFF" strokeOpacity="0.025" strokeWidth="0.6" />
            <path d="M0 3H4" stroke="#000000" strokeOpacity="0.06" strokeWidth="0.6" />
          </pattern>
          <pattern
            id={`${id}-ribs`}
            width="8"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <path d="M0 1H8" stroke="#000000" strokeOpacity="0.2" strokeWidth="1.2" />
            <path d="M0 3.5H8" stroke="#FFFFFF" strokeOpacity="0.035" strokeWidth="0.7" />
          </pattern>

          <clipPath id={`${id}-clip`}>
            <path d={geometry.outer} />
          </clipPath>
        </defs>

        <path
          d={geometry.outer}
          fill={skin.surface}
          stroke="#56515A"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />

        <path
          d={geometry.inner}
          fill={skin.inner}
          stroke="#93818E"
          strokeOpacity="0.22"
          strokeWidth="0.75"
          vectorEffect="non-scaling-stroke"
        />

        <g clipPath={`url(#${id}-clip)`}>
          <rect
            width={size.width}
            height={size.height}
            fill={`url(#${id}-machining)`}
          />
          <rect
            width={size.width}
            height={size.height}
            fill={`url(#${id}-brush)`}
          />
          <rect
            width={size.width}
            height={size.height}
            fill={`url(#${id}-ribs)`}
          />

          <path
            d={`M${Math.min(22, size.width * 0.08) + 5} 7H${size.width - 25}`}
            stroke="#DAC9B9"
            strokeOpacity="0.17"
            strokeWidth="0.7"
          />

          <path
            d={`M10 ${size.height - 8}H${size.width - 32}`}
            stroke="#000000"
            strokeOpacity="0.6"
            strokeWidth="2"
          />

          {!compact && (
            <>
              <rect
                x={size.width - 11}
                y={Math.max(62, size.height * 0.57)}
                width="5"
                height={Math.min(36, size.height * 0.14)}
                fill={`url(#${id}-hazard)`}
                opacity="0.55"
              />

              {Array.from({ length: 7 }, (_, index) => (
                <path
                  key={index}
                  d={`M${size.width - 15} ${size.height - 54 - index * 6}h${index % 3 === 0 ? 7 : 4}`}
                  stroke="#B19BAA"
                  strokeOpacity={index % 3 === 0 ? 0.45 : 0.2}
                  strokeWidth="0.75"
                />
              ))}
            </>
          )}

          {wide && (
            <g transform={`translate(${size.width - 143} 12)`}>
              {Array.from({ length: 11 }, (_, index) => (
                <rect
                  key={index}
                  x={index * 4}
                  y={index % 3 === 0 ? 0 : 2}
                  width={index % 4 === 0 ? 2 : 1}
                  height={index % 3 === 0 ? 7 : 5}
                  fill="#BAA391"
                  opacity="0.32"
                />
              ))}
            </g>
          )}
        </g>

        <HullLightCircuit
          path={geometry.outer}
          innerPath={geometry.inner}
          width={size.width}
          height={size.height}
          active={visible && pageVisible && runningLight}
          engaged={engaged}
          reducedMotion={reducedMotion}
          danger={variant === "danger"}
        />

        <motion.path
          d={geometry.topBracket}
          fill="none"
          stroke={skin.accent}
          strokeWidth="2.2"
          strokeLinecap="square"
          vectorEffect="non-scaling-stroke"
          style={{ x: reducedMotion ? 0 : pressure }}
        />

        <motion.path
          d={geometry.bottomBracket}
          fill="none"
          stroke={skin.accent}
          strokeWidth="2.2"
          strokeLinecap="square"
          vectorEffect="non-scaling-stroke"
          style={{ y: reducedMotion ? 0 : latch }}
        />

        <path
          d={geometry.rightBracket}
          fill="none"
          stroke="#C9B9A8"
          strokeOpacity="0.45"
          strokeWidth="1.3"
          vectorEffect="non-scaling-stroke"
        />

        {geometry.servicePath && (
          <motion.path
            d={geometry.servicePath}
            fill="none"
            stroke={skin.accent}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            style={{ x: reducedMotion ? 0 : pressure }}
          />
        )}

        {size.width >= 180 && !compact && (
          <g transform="translate(36 1)">
            <path d="M0 0H80L75 12H0Z" fill="#2E292B" stroke="#82716B" strokeWidth="0.7" />
            <rect x="5" y="3" width="2" height="6" fill={skin.accent} />
            <text
              x="14"
              y="8.5"
              fill="#D8C4AD"
              fontFamily="'JetBrains Mono', monospace"
              fontSize="6.5"
              letterSpacing="1.3"
            >
              {skin.plate}
            </text>
          </g>
        )}

        {!compact && (
          <g transform={`translate(35 ${size.height - 12})`}>
            <path d="M0 0h8m-4-4v8" stroke="#9F8A7C" strokeOpacity="0.55" strokeWidth="0.8" />
            <path d="M15 -2h14m-14 4h8" stroke="#8B7784" strokeOpacity="0.4" strokeWidth="0.75" />
          </g>
        )}

        {!reducedMotion && runningLight && (
          <motion.path
            ref={(element) => {
              traceRef.current = element;
              element?.setAttribute("pathLength", "1000");
            }}
            d={geometry.route}
            fill="none"
            stroke={skin.trace}
            strokeWidth="2.5"
            strokeDasharray="22 978"
            strokeDashoffset="0"
            strokeLinecap="butt"
            vectorEffect="non-scaling-stroke"
            style={{ opacity: traceOpacity }}
          />
        )}

        <motion.path
          d={`M${size.width - 33} ${size.height - 12}h10`}
          stroke={skin.accent}
          strokeWidth="2"
          animate={{ opacity: engaged ? 0.95 : 0.3 }}
          transition={{ duration: reducedMotion ? 0.15 : 0.2 }}
        />
      </svg>
    </span>
  );
}
