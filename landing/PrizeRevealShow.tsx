import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { createPortal } from "react-dom";
import { motion, useMotionTemplate, useMotionValue, useTransform } from "framer-motion";
import { usePrefersReducedMotion } from "./hooks";
import { createPrizeCanvas } from "./prizeCanvas";
import {
  playPrizeBurst,
  playSealBreak,
  vibratePrize,
} from "./prizeFeedback";
import { Glyph } from "./Glyph";
import "./prize-reveal.css";

export interface PrizeRevealShowProps {
  readonly trigger: boolean;
  readonly amount: number;
  readonly onComplete: () => void;
  readonly title?: string;
  readonly message?: string;
  readonly unit?: string;
  readonly haptics?: boolean;
}

interface PrizeSceneProps {
  readonly amount: number;
  readonly title: string;
  readonly message: string;
  readonly unit: string;
  readonly reducedMotion: boolean;
  readonly haptics: boolean;
  readonly onComplete: () => void;
}

const showDurationMs = 2800;
const reducedDurationMs = 1800;
const frameDurationMs = 1000 / 60;

const numberFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 6,
});


function PrizeScene({
  amount,
  title,
  message,
  unit,
  reducedMotion,
  haptics,
  onComplete,
}: PrizeSceneProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef(onComplete);
  const elapsed = useMotionValue(0);

  useEffect(() => {
    finishRef.current = onComplete;
  }, [onComplete]);

  const overlayOpacity = useTransform(
    elapsed,
    [0, 100, 2500, showDurationMs],
    [0, 1, 1, 0],
  );

  const sealOpacity = useTransform(
    elapsed,
    [0, 90, 400, 590],
    [0, 1, 1, 0],
  );

  const sealScale = useTransform(
    elapsed,
    [0, 180, 400, 590],
    [0.76, 1, 1.04, 1.45],
  );

  const sealRotation = useTransform(
    elapsed,
    [0, 400, 590],
    [-8, 0, 12],
  );

  const symbolRotation = useTransform(
    elapsed,
    [0, 400],
    [0, 220],
  );


  const flashScale = useTransform(
    elapsed,
    [0, 1799, 1800, 1970, 2200],
    [0, 0, 0, 3, 0],
  );

  const flashOpacity = useTransform(
    elapsed,
    [0, 1799, 1840, 1980, 2200],
    [0, 0, 0.55, 0.22, 0],
  );

  const shockRadius = useTransform(
    elapsed,
    [0, 1800, 2400],
    [50, 50, 600],
  );

  const shockOpacity = useTransform(
    elapsed,
    [0, 1799, 1800, 2400],
    [0, 0, 0.8, 0],
  );

  const shockWidth = useTransform(
    elapsed,
    [0, 1800, 2400],
    [40, 40, 0],
  );

  const shockSize = useTransform(shockRadius, (r) => r * 2);
  const shockBorder = useMotionTemplate`${shockWidth}px solid #FF8CC5`;

  const resultOpacity = useTransform(
    elapsed,
    [0, 430, 650, 2500, showDurationMs],
    [0, 0, 1, 1, 0],
  );

  const resultY = useTransform(
    elapsed,
    [0, 430, 760],
    [20, 20, 0],
  );

  const resultScale = useTransform(
    elapsed,
    [0, 430, 680, 820],
    [0.94, 0.94, 1.03, 1],
  );

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    elapsed.set(0);

    let disposed = false;
    let completed = false;
    let rafId: number | null = null;
    let previousTime: number | null = null;
    let visibleElapsed = 0;
    let sealTriggered = false;
    let burstTriggered = false;

    const duration = reducedMotion
      ? reducedDurationMs
      : showDurationMs;

    const canvas = canvasRef.current;
    const engine =
      !reducedMotion && canvas ? createPrizeCanvas(canvas) : null;

    function resize(): void {
      if (!engine || disposed) {
        return;
      }

      const bounds = stage?.getBoundingClientRect();

      if (!bounds) {
        return;
      }

      engine.resize(
        bounds.width,
        bounds.height,
        Math.min(window.devicePixelRatio || 1, 1.75),
      );
    }

    const resizeObserver = engine ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(stage);
    resize();

    function complete(): void {
      if (completed || disposed) {
        return;
      }

      completed = true;
      finishRef.current();
    }

    function frame(now: number): void {
      rafId = null;

      if (disposed || completed || document.hidden) {
        return;
      }

      if (previousTime === null) {
        previousTime = now;
        rafId = window.requestAnimationFrame(frame);
        return;
      }

      const difference = now - previousTime;

      if (difference < frameDurationMs - 0.5) {
        rafId = window.requestAnimationFrame(frame);
        return;
      }

      previousTime = now;

      const deltaMs = Math.min(difference, 50);
      visibleElapsed = Math.min(duration, visibleElapsed + deltaMs);

      if (!reducedMotion) {
        elapsed.set(visibleElapsed);

        if (!sealTriggered) {
          sealTriggered = true;
          playSealBreak();

          if (haptics) {
            vibratePrize([15, 25, 25]);
          }
        }

        if (!burstTriggered && visibleElapsed >= 1800) {
          burstTriggered = true;
          playPrizeBurst();

          if (haptics) {
            vibratePrize(35);
          }
        }

        engine?.frame(visibleElapsed, deltaMs / 1000);
      }

      if (visibleElapsed >= duration) {
        complete();
        return;
      }

      rafId = window.requestAnimationFrame(frame);
    }

    function start(): void {
      if (disposed || completed || document.hidden || rafId !== null) {
        return;
      }

      previousTime = null;
      rafId = window.requestAnimationFrame(frame);
    }

    function handleVisibilityChange(): void {
      if (document.hidden) {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }

        previousTime = null;
      } else {
        start();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    start();

    return () => {
      disposed = true;

      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      resizeObserver?.disconnect();
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      engine?.dispose();
    };
  }, [elapsed, reducedMotion, haptics]);

  const amountLabel =
    amount > 0 ? `+${numberFormatter.format(amount)} ${unit}` : null;

  if (reducedMotion) {
    return (
      <div ref={stageRef} className="prize-static">
        <div className="prize-static-card">
          <div className="prize-static-mark" aria-hidden="true">
            <Glyph name="check" size={40} />
          </div>
          <div>
            <p className="prize-result-title">{t(title)}</p>
            {amountLabel && (
              <p className="prize-static-amount">{amountLabel}</p>
            )}
            <p className="prize-result-message">{t(message)}</p>
          </div>
          <button
            type="button"
            className="prize-static-close"
            aria-label={t("Закрыть подтверждение")}
            onClick={onComplete}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      ref={stageRef}
      className="prize-stage"
      style={{ opacity: overlayOpacity }}
    >
      <div className="prize-backdrop" aria-hidden="true" />

      <canvas
        ref={canvasRef}
        className="prize-canvas"
        aria-hidden="true"
      />

      <div className="prize-origin" aria-hidden="true">
        <motion.div
          className="prize-flash"
          style={{
            scale: flashScale,
            opacity: flashOpacity,
          }}
        />

        <div
          className="prize-shockwave"
          aria-hidden="true"
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <motion.div
            style={{
              width: shockSize,
              height: shockSize,
              border: shockBorder,
              borderRadius: "50%",
              opacity: shockOpacity,
            }}
          />
        </div>

        <motion.div
          className="prize-seal"
          style={{
            opacity: sealOpacity,
            scale: sealScale,
            rotate: sealRotation,
          }}
        >
          <img
            src="/ares/prize-art.webp"
            alt=""
            aria-hidden="true"
            style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
          />

          <motion.div
            className="prize-seal-symbol"
            style={{ rotate: symbolRotation }}
          >
            <span>$</span>
          </motion.div>

          <span className="prize-seal-label">ARES-1</span>
        </motion.div>
      </div>

      <motion.div
        className="prize-result"
        style={{
          opacity: resultOpacity,
          y: resultY,
          scale: resultScale,
        }}
      >
        <p className="prize-result-eyebrow">{t("СИГНАЛ КОЛОНИИ ПРИНЯТ")}</p>
        <h2 className="prize-result-title">{t(title)}</h2>
        {amountLabel && (
          <p className="prize-result-amount">{amountLabel}</p>
        )}
        <p className="prize-result-message">{t(message)}</p>
      </motion.div>

      <button
        type="button"
        className="prize-skip"
        onClick={onComplete}
      >
        {t("Пропустить анимацию")}
      </button>
    </motion.div>
  );
}

export function PrizeRevealShow({
  trigger,
  amount,
  onComplete,
  title = t("НАГРАДА ПОЛУЧЕНА"),
  message = t("Груз доставлен в твою колонию."),
  unit = "$POTATO",
  haptics = true,
}: PrizeRevealShowProps): JSX.Element | null {
  const reducedMotion = usePrefersReducedMotion();
  const [active, setActive] = useState(false);
  const previousTrigger = useRef(false);
  const completion = useRef(onComplete);
  const completed = useRef(false);

  useEffect(() => {
    completion.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const risingEdge = trigger && !previousTrigger.current;
    previousTrigger.current = trigger;

    if (risingEdge) {
      completed.current = false;
      setActive(true);
    }
  }, [trigger]);

  const finish = useCallback((): void => {
    if (completed.current) {
      return;
    }

    completed.current = true;
    setActive(false);
    completion.current();
  }, []);

  if (!active || typeof document === "undefined") {
    return null;
  }

  const safeAmount =
    Number.isFinite(amount) && amount > 0 ? amount : 0;

  const announcement = [
    title,
    safeAmount > 0 ? `+${numberFormatter.format(safeAmount)} ${unit}` : "",
    message,
  ].filter(Boolean).join(". ");

  return createPortal(
    <>
      <div
        className="prize-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>

      <PrizeScene
        amount={safeAmount}
        title={title}
        message={message}
        unit={unit}
        reducedMotion={reducedMotion}
        haptics={haptics}
        onComplete={finish}
      />
    </>,
    document.body,
  );
}
