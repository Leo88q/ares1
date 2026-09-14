import {
  useEffect,
  useId,
  useRef,
} from "react";
import type { HTMLAttributes, ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
} from "framer-motion";
import { usePrefersReducedMotion } from "./hooks";
import "./liquid-panels.css";
import { AresHullFrame } from "./AresHullFrame";

export type LiquidPanelVariant = "default" | "accent" | "danger";

export interface LiquidPanelProps
  extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  readonly variant?: LiquidPanelVariant;
  readonly runningLight?: boolean;
}

export interface LiquidPanelBorderProps {
  readonly variant?: LiquidPanelVariant;
  readonly runningLight?: boolean;
}

export type DerivedPanelProps = Omit<LiquidPanelProps, "variant">;

interface Point {
  x: number;
  y: number;
}

interface BorderPoint extends Point {
  offsetX: number;
  offsetY: number;
  velocityX: number;
  velocityY: number;
}

interface TravelSegment {
  start: Point;
  end: Point;
  lengthStart: number;
  length: number;
  timeStart: number;
  timeWeight: number;
}

interface TravelMap {
  segments: TravelSegment[];
  perimeter: number;
  totalTimeWeight: number;
}

interface TravelPosition extends Point {
  distance: number;
  tangentX: number;
  tangentY: number;
}

type FrameListener = (deltaSeconds: number) => void;

const frameListeners = new Set<FrameListener>();

let sharedRafId: number | null = null;
let previousFrameTime: number | null = null;
let visibilitySubscribed = false;

const frameInterval = 1000 / 60;
const pointCount = 20;
const borderInset = 4;
const magneticRadius = 120;
const magneticStrength = 15;

const colors: Record<LiquidPanelVariant, string> = {
  default: "#BBA8CC",
  accent: "#FF2E93",
  danger: "#FF9CAA",
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value: number): number {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function cancelSharedFrame(): void {
  if (sharedRafId !== null) {
    window.cancelAnimationFrame(sharedRafId);
    sharedRafId = null;
  }

  previousFrameTime = null;
}

function runSharedFrame(now: number): void {
  sharedRafId = null;

  if (document.hidden || frameListeners.size === 0) {
    previousFrameTime = null;
    return;
  }

  if (previousFrameTime === null) {
    previousFrameTime = now;
    sharedRafId = window.requestAnimationFrame(runSharedFrame);
    return;
  }

  const elapsed = now - previousFrameTime;

  if (elapsed < frameInterval - 0.5) {
    sharedRafId = window.requestAnimationFrame(runSharedFrame);
    return;
  }

  previousFrameTime = now;
  const deltaSeconds = Math.min(elapsed / 1000, 1 / 30);

  for (const listener of frameListeners) {
    listener(deltaSeconds);
  }

  if (frameListeners.size > 0 && !document.hidden) {
    sharedRafId = window.requestAnimationFrame(runSharedFrame);
  }
}

function startSharedFrame(): void {
  if (
    sharedRafId !== null ||
    document.hidden ||
    frameListeners.size === 0
  ) {
    return;
  }

  previousFrameTime = null;
  sharedRafId = window.requestAnimationFrame(runSharedFrame);
}

function handleSharedVisibility(): void {
  if (document.hidden) {
    cancelSharedFrame();
  } else {
    startSharedFrame();
  }
}

function subscribeToFrames(listener: FrameListener): () => void {
  frameListeners.add(listener);

  if (!visibilitySubscribed) {
    document.addEventListener("visibilitychange", handleSharedVisibility);
    visibilitySubscribed = true;
  }

  startSharedFrame();

  return () => {
    frameListeners.delete(listener);

    if (frameListeners.size === 0) {
      cancelSharedFrame();

      if (visibilitySubscribed) {
        document.removeEventListener(
          "visibilitychange",
          handleSharedVisibility,
        );
        visibilitySubscribed = false;
      }
    }
  };
}

function hashString(value: string): number {
  let result = 0;

  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }

  return result;
}

function createBorderPoints(width: number, height: number): BorderPoint[] {
  const left = borderInset;
  const top = borderInset;
  const right = Math.max(left + 1, width - borderInset);
  const bottom = Math.max(top + 1, height - borderInset);

  const horizontal = right - left;
  const vertical = bottom - top;
  const result: BorderPoint[] = [];

  function add(x: number, y: number): void {
    result.push({
      x,
      y,
      offsetX: 0,
      offsetY: 0,
      velocityX: 0,
      velocityY: 0,
    });
  }

  for (let index = 0; index < 5; index += 1) {
    add(left + horizontal * (index / 5), top);
  }

  for (let index = 0; index < 5; index += 1) {
    add(right, top + vertical * (index / 5));
  }

  for (let index = 0; index < 5; index += 1) {
    add(right - horizontal * (index / 5), bottom);
  }

  for (let index = 0; index < 5; index += 1) {
    add(left, bottom - vertical * (index / 5));
  }

  return result;
}

function positionOf(point: BorderPoint): Point {
  return {
    x: point.x + point.offsetX,
    y: point.y + point.offsetY,
  };
}

function midpoint(first: Point, second: Point): Point {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function buildPath(points: readonly BorderPoint[]): string {
  const first = points[0];
  const last = points[points.length - 1];

  if (!first || !last) {
    return "";
  }

  const start = midpoint(positionOf(last), positionOf(first));
  let path = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];

    if (!current || !next) {
      continue;
    }

    const control = positionOf(current);
    const end = midpoint(control, positionOf(next));

    path +=
      ` Q ${control.x.toFixed(2)} ${control.y.toFixed(2)}` +
      ` ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  return `${path} Z`;
}

function quadraticPoint(
  start: Point,
  control: Point,
  end: Point,
  progress: number,
): Point {
  const inverse = 1 - progress;

  return {
    x:
      inverse * inverse * start.x +
      2 * inverse * progress * control.x +
      progress * progress * end.x,
    y:
      inverse * inverse * start.y +
      2 * inverse * progress * control.y +
      progress * progress * end.y,
  };
}

function createTravelMap(points: readonly BorderPoint[]): TravelMap {
  const samples: Array<Point & { speedWeight: number }> = [];
  const samplesPerCurve = 10;

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];

    if (!previous || !current || !next) {
      continue;
    }

    const start = midpoint(previous, current);
    const end = midpoint(current, next);
    const isCorner = index % 5 === 0;

    for (let sample = 0; sample < samplesPerCurve; sample += 1) {
      const progress = sample / samplesPerCurve;
      const position = quadraticPoint(start, current, end, progress);

      samples.push({
        ...position,
        speedWeight: isCorner
          ? 1 + 1.7 * Math.sin(progress * Math.PI)
          : 1,
      });
    }
  }

  const segments: TravelSegment[] = [];
  let perimeter = 0;
  let totalTimeWeight = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const start = samples[index];
    const end = samples[(index + 1) % samples.length];

    if (!start || !end) {
      continue;
    }

    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const timeWeight = length * start.speedWeight;

    segments.push({
      start,
      end,
      lengthStart: perimeter,
      length,
      timeStart: totalTimeWeight,
      timeWeight,
    });

    perimeter += length;
    totalTimeWeight += timeWeight;
  }

  return { segments, perimeter, totalTimeWeight };
}

function locateLight(map: TravelMap, progress: number): TravelPosition {
  const target = progress * map.totalTimeWeight;
  const fallback = map.segments[map.segments.length - 1];

  const segment =
    map.segments.find(
      (candidate) => target <= candidate.timeStart + candidate.timeWeight,
    ) ?? fallback;

  if (!segment) {
    return {
      x: 0,
      y: 0,
      distance: 0,
      tangentX: 1,
      tangentY: 0,
    };
  }

  const local = clamp(
    (target - segment.timeStart) / Math.max(0.001, segment.timeWeight),
    0,
    1,
  );

  const inverseLength = 1 / Math.max(0.001, segment.length);

  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * local,
    y: segment.start.y + (segment.end.y - segment.start.y) * local,
    distance: segment.lengthStart + segment.length * local,
    tangentX: (segment.end.x - segment.start.x) * inverseLength,
    tangentY: (segment.end.y - segment.start.y) * inverseLength,
  };
}

export function LiquidPanelBorder({
  variant = "default",
  runningLight = true,
}: LiquidPanelBorderProps): JSX.Element {
  return (
    <AresHullFrame
      variant={variant}
      runningLight={runningLight}
    />
  );
}

export function LegacyLiquidPanelBorder({
  variant = "default",
  runningLight = true,
}: LiquidPanelBorderProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const id = useId().replace(/:/g, "");
  const phase = (hashString(id) % 1000) / 1000;

  const shellRef = useRef<HTMLSpanElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientRef = useRef<SVGLinearGradientElement>(null);
  const screwsRef = useRef<Array<SVGGElement | null>>([]);

  const path = useMotionValue("");
  const dashArray = useMotionValue("0 1000");
  const dashOffset = useMotionValue(0);
  const lightOpacity = useMotionValue(0);

  const pointerX = useMotionValue(-1000);
  const pointerY = useMotionValue(-1000);
  const hover = useMotionValue(0);

  const springX = useSpring(pointerX, {
    stiffness: 120,
    damping: 18,
    mass: 1,
  });

  const springY = useSpring(pointerY, {
    stiffness: 120,
    damping: 18,
    mass: 1,
  });

  const hoverSpring = useSpring(hover, {
    stiffness: 120,
    damping: 18,
    mass: 1,
  });

  const glowOpacity = useMotionValue(0);

  useEffect(() => {
    const shell = shellRef.current;
    const svg = svgRef.current;
    const host = shell?.parentElement;

    if (!shell || !svg || !host) {
      return;
    }

    let disposed = false;
    let visible = false;
    let width = 1;
    let height = 1;
    let time = phase * 8;
    let glow = 0;
    let points: BorderPoint[] = [];
    let travel: TravelMap = {
      segments: [],
      perimeter: 0,
      totalTimeWeight: 0,
    };

    let unsubscribe: (() => void) | null = null;

    const finePointer = window.matchMedia(
      "(hover: hover) and (pointer: fine)",
    );

    function updateScrews(animated: boolean): void {
      const inset = Math.min(13, width / 6, height / 6);

      const centers: readonly Point[] = [
        { x: inset, y: inset },
        { x: width - inset, y: inset },
        { x: width - inset, y: height - inset },
        { x: inset, y: height - inset },
      ];

      centers.forEach((center, index) => {
        const screw = screwsRef.current[index];

        if (!screw) {
          return;
        }

        const period = 6 + ((index * 0.57 + phase) % 2);
        const rotation = animated
          ? Math.sin((time / period) * Math.PI * 2 + index * 1.7) * 3
          : 0;

        screw.setAttribute(
          "transform",
          `translate(${center.x.toFixed(2)} ${center.y.toFixed(2)}) rotate(${rotation.toFixed(2)})`,
        );
      });
    }

    function resetPointer(): void {
      hover.set(0);
    }

    function stopFrames(): void {
      unsubscribe?.();
      unsubscribe = null;
    }

    function drawStatic(): void {
      for (const point of points) {
        point.offsetX = 0;
        point.offsetY = 0;
        point.velocityX = 0;
        point.velocityY = 0;
      }

      path.set(buildPath(points));
      lightOpacity.set(0);
      glowOpacity.set(0);
      updateScrews(false);
    }

    function updateLight(): void {
      if (!runningLight || travel.perimeter <= 0) {
        lightOpacity.set(0);
        return;
      }

      const progress = ((time + phase * 4) % 4) / 4;
      const position = locateLight(travel, progress);
      const lightLength = Math.min(80, travel.perimeter * 0.25);
      const normalizedLength = (lightLength / travel.perimeter) * 1000;
      const normalizedPosition =
        (position.distance / travel.perimeter) * 1000;

      dashArray.set(
        `${normalizedLength.toFixed(3)} ${(1000 - normalizedLength).toFixed(3)}`,
      );

      dashOffset.set(-normalizedPosition + normalizedLength / 2);
      lightOpacity.set(1);

      const gradient = gradientRef.current;

      if (gradient) {
        const half = lightLength / 2;

        gradient.setAttribute(
          "x1",
          String(position.x - position.tangentX * half),
        );
        gradient.setAttribute(
          "y1",
          String(position.y - position.tangentY * half),
        );
        gradient.setAttribute(
          "x2",
          String(position.x + position.tangentX * half),
        );
        gradient.setAttribute(
          "y2",
          String(position.y + position.tangentY * half),
        );
      }
    }

    function drawFrame(deltaSeconds: number): void {
      if (disposed || !visible || reducedMotion) {
        return;
      }

      time += deltaSeconds;

      const cursorX = springX.get();
      const cursorY = springY.get();
      const attraction = clamp(hoverSpring.get(), 0, 1);
      const substeps = Math.max(1, Math.ceil(deltaSeconds / (1 / 120)));
      const step = deltaSeconds / substeps;

      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];

        if (!point) {
          continue;
        }

        const pointPhase = (index / pointCount) * Math.PI * 2;
        const waveTime = (time / 8) * Math.PI * 2;

        const waveX =
          Math.sin(waveTime + pointPhase * 1.7) * 0.8 +
          Math.cos(waveTime * 0.5 + pointPhase) * 0.35;

        const waveY =
          Math.cos(waveTime + pointPhase * 1.3) * 0.8 +
          Math.sin(waveTime * 0.5 + pointPhase) * 0.35;

        const dx = cursorX - point.x;
        const dy = cursorY - point.y;
        const distance = Math.hypot(dx, dy);

        const influence =
          smoothstep(1 - distance / magneticRadius) * attraction;

        const displacement =
          Math.min(magneticStrength, distance * 0.3) * influence;

        const inverseDistance = distance > 0.001 ? 1 / distance : 0;

        const targetX = waveX + dx * inverseDistance * displacement;
        const targetY = waveY + dy * inverseDistance * displacement;

        for (let substep = 0; substep < substeps; substep += 1) {
          const accelerationX =
            (targetX - point.offsetX) * 120 - point.velocityX * 18;

          const accelerationY =
            (targetY - point.offsetY) * 120 - point.velocityY * 18;

          point.velocityX += accelerationX * step;
          point.velocityY += accelerationY * step;
          point.offsetX += point.velocityX * step;
          point.offsetY += point.velocityY * step;
        }
      }

      const glowTarget = hover.get();
      const glowStep = deltaSeconds / 0.3;

      glow += clamp(glowTarget - glow, -glowStep, glowStep);
      glowOpacity.set(clamp(glow, 0, 1));

      path.set(buildPath(points));
      updateLight();
      updateScrews(true);
    }

    function syncFrames(): void {
      if (disposed || reducedMotion || !visible) {
        stopFrames();

        if (reducedMotion) {
          drawStatic();
        }

        return;
      }

      if (!unsubscribe) {
        unsubscribe = subscribeToFrames(drawFrame);
      }
    }

    function resize(): void {
      if (disposed) {
        return;
      }

      width = Math.max(1, host?.clientWidth ?? 1);
      height = Math.max(1, host?.clientHeight ?? 1);

      svg?.setAttribute("viewBox", `0 0 ${width} ${height}`);
      points = createBorderPoints(width, height);
      travel = createTravelMap(points);

      path.set(buildPath(points));
      updateScrews(false);

      if (!reducedMotion) {
        updateLight();
      } else {
        drawStatic();
      }

      syncFrames();
    }

    function handlePointerMove(event: PointerEvent): void {
      if (
        reducedMotion ||
        !visible ||
        !finePointer.matches ||
        event.pointerType !== "mouse"
      ) {
        return;
      }

      const bounds = host?.getBoundingClientRect();

      if (!bounds || bounds.width === 0 || bounds.height === 0) {
        return;
      }

      const x = ((event.clientX - bounds.left) / bounds.width) * width;
      const y = ((event.clientY - bounds.top) / bounds.height) * height;

      if (hover.get() === 0) {
        springX.jump(x);
        springY.jump(y);
      }

      pointerX.set(x);
      pointerY.set(y);
      hover.set(1);
    }

    function handleMediaChange(): void {
      if (!finePointer.matches) {
        resetPointer();
      }
    }

    function handleVisibilityChange(): void {
      if (document.hidden) {
        hover.jump(0);
        hoverSpring.jump(0);
        glow = 0;
        glowOpacity.set(0);
      }
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        visible = Boolean(entry?.isIntersecting);

        if (!visible) {
          hover.jump(0);
          hoverSpring.jump(0);
          glow = 0;
          glowOpacity.set(0);
        }

        syncFrames();
      },
      {
        threshold: 0,
        rootMargin: "0px",
      },
    );

    intersectionObserver.observe(host);

    host.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    host.addEventListener("pointerleave", resetPointer);
    host.addEventListener("pointercancel", resetPointer);
    window.addEventListener("blur", resetPointer);
    finePointer.addEventListener("change", handleMediaChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    resize();

    return () => {
      disposed = true;
      stopFrames();

      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerleave", resetPointer);
      host.removeEventListener("pointercancel", resetPointer);
      window.removeEventListener("blur", resetPointer);
      finePointer.removeEventListener("change", handleMediaChange);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [
    dashArray,
    dashOffset,
    glowOpacity,
    hover,
    hoverSpring,
    lightOpacity,
    path,
    phase,
    pointerX,
    pointerY,
    reducedMotion,
    runningLight,
    springX,
    springY,
  ]);

  const color = colors[variant];

  return (
    <span
      ref={shellRef}
      className="liquid-panel-decoration"
      data-liquid-variant={variant}
      aria-hidden="true"
    >
      <span className="liquid-panel-inner-glow" />

      <motion.span
        className="liquid-panel-hover-glow"
        style={{ opacity: reducedMotion ? 0 : glowOpacity }}
      />

      <svg
        ref={svgRef}
        className="liquid-panel-svg"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <linearGradient
            id={`${id}-metal`}
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop offset="0%" stopColor="#DAD5E1" stopOpacity="0.65" />
            <stop offset="22%" stopColor={color} stopOpacity="0.42" />
            <stop offset="55%" stopColor="#4A4F5A" stopOpacity="0.8" />
            <stop offset="82%" stopColor={color} stopOpacity="0.7" />
            <stop offset="100%" stopColor="#DAD5E1" stopOpacity="0.42" />
          </linearGradient>

          <linearGradient
            ref={gradientRef}
            id={`${id}-flow`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="80"
            y2="0"
          >
            <stop offset="0%" stopColor={color} stopOpacity="0" />
            <stop offset="25%" stopColor={color} stopOpacity="0.7" />
            <stop offset="50%" stopColor="#FFF2FA" stopOpacity="1" />
            <stop offset="75%" stopColor={color} stopOpacity="0.7" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>

          <filter
            id={`${id}-blur`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        <motion.path
          d={path}
          fill="none"
          stroke="#050308"
          strokeWidth="4"
          vectorEffect="non-scaling-stroke"
        />

        <motion.path
          d={path}
          fill="none"
          stroke={`url(#${id}-metal)`}
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
        />

        {!reducedMotion && runningLight && (
          <>
            <motion.path
              d={path}
              ref={(element) => {
                element?.setAttribute("pathLength", "1000");
              }}
              fill="none"
              stroke={color}
              strokeWidth="4"
              strokeLinecap="round"
              filter={`url(#${id}-blur)`}
              style={{
                strokeDasharray: dashArray,
                strokeDashoffset: dashOffset,
                opacity: lightOpacity,
              }}
            />

            <motion.path
              d={path}
              ref={(element) => {
                element?.setAttribute("pathLength", "1000");
              }}
              fill="none"
              stroke={`url(#${id}-flow)`}
              strokeWidth="2"
              strokeLinecap="round"
              style={{
                strokeDasharray: dashArray,
                strokeDashoffset: dashOffset,
                opacity: lightOpacity,
              }}
            />
          </>
        )}

        {Array.from({ length: 4 }, (_, index) => (
          <g
            key={index}
            ref={(element) => {
              screwsRef.current[index] = element;
            }}
          >
            <circle
              r="4"
              fill="#101018"
              stroke="#6D6578"
              strokeWidth="0.8"
            />
            <circle
              r="2.7"
              fill="#77717E"
              stroke="#D2C9D9"
              strokeOpacity="0.35"
              strokeWidth="0.6"
            />
            <path
              d="M-1.7 0H1.7"
              stroke="#17121E"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
            <path
              d="M-1.2 -1.6L0.4 -1.6"
              stroke="#F1E7F5"
              strokeOpacity="0.6"
              strokeWidth="0.6"
              strokeLinecap="round"
            />
          </g>
        ))}
      </svg>
    </span>
  );
}

export function LiquidPanel({
  children,
  variant = "default",
  runningLight = true,
  className = "",
  ...props
}: LiquidPanelProps): JSX.Element {
  return (
    <div
      {...props}
      className={`liquid-panel ${className}`}
      data-liquid-panel={variant}
    >
      <LiquidPanelBorder
        variant={variant}
        runningLight={runningLight}
      />
      {children}
    </div>
  );
}

export function FeaturePanel({
  className = "",
  ...props
}: DerivedPanelProps): JSX.Element {
  return (
    <LiquidPanel
      {...props}
      variant="accent"
      className={`liquid-panel--feature ${className}`}
    />
  );
}

export function StatsPanel({
  className = "",
  ...props
}: DerivedPanelProps): JSX.Element {
  return (
    <LiquidPanel
      {...props}
      variant="default"
      className={`liquid-panel--stats ${className}`}
    />
  );
}

export function QuestPanel({
  className = "",
  ...props
}: DerivedPanelProps): JSX.Element {
  return (
    <LiquidPanel
      {...props}
      variant="accent"
      className={`liquid-panel--quest ${className}`}
    />
  );
}

export function PresalePanel({
  className = "",
  ...props
}: DerivedPanelProps): JSX.Element {
  return (
    <LiquidPanel
      {...props}
      variant="accent"
      className={`liquid-panel--presale ${className}`}
    />
  );
}
