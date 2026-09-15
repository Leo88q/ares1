import { t, useI18n } from "./i18n";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
} from "framer-motion";
import {
  useGamification,
} from "./Gamification";
import type {
  XpFlight,
} from "./Gamification";
import { PrizeRevealShow } from "./PrizeRevealShow";
import { RollingNumber, SparkProgress } from "./MicroMotion";
import { useSounds } from "./useSounds";
import { usePrefersReducedMotion } from "./hooks";
import "./gamification.css";

const numberFormatter = new Intl.NumberFormat("ru-RU");

function SectionXpTracker(): null {
  const { award } = useGamification();

  useEffect(() => {
    const main = document.getElementById("main-content");

    if (!main) {
      return;
    }

    const sections = Array.from(
      main.querySelectorAll<HTMLElement>("section[id]"),
    );

    const locallyAwarded = new Set<string>();
    let raf: number | null = null;
    let lastMeasurement = -Infinity;
    let disposed = false;

    function measure(now: number): void {
      raf = null;

      if (disposed || document.hidden) {
        return;
      }

      if (now - lastMeasurement < 100) {
        raf = window.requestAnimationFrame(measure);
        return;
      }

      lastMeasurement = now;
      const viewportHeight = window.innerHeight;

      for (const section of sections) {
        if (locallyAwarded.has(section.id)) {
          continue;
        }

        const bounds = section.getBoundingClientRect();

        if (
          bounds.height <= 0 ||
          bounds.bottom <= 0 ||
          bounds.top >= viewportHeight
        ) {
          continue;
        }

        const viewedFraction =
          (viewportHeight - bounds.top) / bounds.height;

        if (viewedFraction < 0.8) {
          continue;
        }

        locallyAwarded.add(section.id);

        award(
          { kind: "section", id: section.id },
          {
            x: Math.min(
              window.innerWidth - 24,
              Math.max(24, bounds.left + bounds.width * 0.7),
            ),
            y: Math.max(
              90,
              Math.min(viewportHeight - 60, bounds.top + bounds.height * 0.8),
            ),
          },
        );
      }
    }

    function requestMeasurement(): void {
      if (!disposed && !document.hidden && raf === null) {
        raf = window.requestAnimationFrame(measure);
      }
    }

    function onVisibility(): void {
      if (document.hidden) {
        if (raf !== null) {
          window.cancelAnimationFrame(raf);
          raf = null;
        }
      } else {
        requestMeasurement();
      }
    }

    const resizeObserver = new ResizeObserver(requestMeasurement);

    for (const section of sections) {
      resizeObserver.observe(section);
    }

    window.addEventListener("scroll", requestMeasurement, { passive: true });
    window.addEventListener("resize", requestMeasurement);
    document.addEventListener("visibilitychange", onVisibility);
    requestMeasurement();

    return () => {
      disposed = true;

      if (raf !== null) {
        window.cancelAnimationFrame(raf);
      }

      resizeObserver.disconnect();
      window.removeEventListener("scroll", requestMeasurement);
      window.removeEventListener("resize", requestMeasurement);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [award]);

  return null;
}

function FlyingXp({
  flight,
  destination,
  complete,
}: {
  readonly flight: XpFlight;
  readonly destination: RefObject<HTMLDivElement>;
  readonly complete: (id: number) => void;
}): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const [target] = useState(() => {
    const bounds = destination.current?.getBoundingClientRect();

    return {
      x: bounds
        ? bounds.left + bounds.width / 2
        : window.innerWidth - 80,
      y: bounds
        ? bounds.top + bounds.height / 2
        : window.innerHeight - 70,
    };
  });

  useEffect(() => {
    const timeout = window.setTimeout(
      () => complete(flight.id),
      reducedMotion ? 180 : 1500,
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [flight.id, reducedMotion, complete]);

  const middleX =
    flight.origin.x + (target.x - flight.origin.x) * 0.45;

  const middleY = Math.max(
    60,
    Math.min(flight.origin.y, target.y) - 90,
  );

  return (
    <motion.span
      className="xp-flight"
      aria-hidden="true"
      initial={{
        x: reducedMotion ? target.x : flight.origin.x,
        y: reducedMotion ? target.y : flight.origin.y,
        opacity: 0,
        scale: 1,
      }}
      animate={
        reducedMotion
          ? { x: target.x, y: target.y, opacity: [0, 1, 0] }
          : {
              x: [flight.origin.x, middleX, target.x],
              y: [flight.origin.y, middleY, target.y],
              opacity: [0, 1, 1, 0],
              scale: [0.9, 1.1, 1, 0.65],
            }
      }
      exit={{ opacity: 0 }}
      transition={{
        duration: reducedMotion ? 0.15 : 1.05,
        ease: [0.19, 1, 0.22, 1],
      }}
      onAnimationComplete={() => complete(flight.id)}
    >
      +{flight.amount} XP
    </motion.span>
  );
}

function LevelUpPresentation(): JSX.Element | null {
  const { levels, removeLevel } = useGamification();
  const { play } = useSounds();
  const current = levels[0];
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => {
    if (!current || activeId !== null) {
      return;
    }

    let disposed = false;
    let started = false;

    function tryStart(): void {
      if (disposed || started || document.hidden) {
        return;
      }

      const existingShow = document.querySelector(
        ".prize-stage, .prize-static",
      );

      if (!existingShow && current) {
        started = true;
        play("level.up", 0.55);
        setActiveId(current.id);
      }
    }

    const initialDelay = window.setTimeout(tryStart, 180);
    const interval = window.setInterval(tryStart, 250);

    return () => {
      disposed = true;
      window.clearTimeout(initialDelay);
      window.clearInterval(interval);
    };
  }, [current, activeId, play]);

  if (!current || activeId !== current.id) {
    return null;
  }

  return (
    <PrizeRevealShow
      key={`level-${current.id}`}
      trigger={true}
      amount={0}
      title={t("НОВЫЙ УРОВЕНЬ · {n}", { n: current.level })}
      message={t("Колония замечает твоё участие. Продолжай исследовать ARES-1.")}
      onComplete={() => {
        removeLevel(current.id);
        setActiveId(null);
      }}
    />
  );
}

export function GamificationHud(): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  useI18n();
  const {
    xp,
    level,
    nextThreshold,
    progress,
    streak,
    colonistRank,
    lastReward,
    flights,
    removeFlight,
  } = useGamification();

  const destinationRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <SectionXpTracker />

      <aside
        className="xp-hud"
        aria-label={t("Прогресс исследования колонии")}
      >
        <div ref={destinationRef} className="xp-hud-main">
          <button
            type="button"
            className="xp-hud-toggle"
            aria-expanded={expanded}
            aria-controls="xp-hud-details"
            onClick={() => setExpanded((value) => !value)}
          >
            <span className="xp-level-badge" aria-hidden="true">
              <RollingNumber value={level} minimumDigits={2} />
            </span>

            <span className="xp-hud-summary">
              <span>{t("УРОВЕНЬ {n}", { n: level })}</span>
              <strong>
                <RollingNumber value={xp} /> XP
              </strong>
            </span>

            <span className="xp-hud-chevron" aria-hidden="true">
              {expanded ? "−" : "+"}
            </span>
          </button>

          <SparkProgress
            value={progress * 100}
            max={100}
            label={t("Прогресс до следующего уровня")}
            valueText={
              nextThreshold === null
                ? t("Достигнут максимальный уровень")
                : t("{a} из {b} XP", { a: xp, b: nextThreshold })
            }
            color="#7CFF6B"
          />
        </div>

        <div id="xp-hud-details">
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                className="xp-hud-details"
                initial={{
                  height: reducedMotion ? "auto" : 0,
                  opacity: 0,
                }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{
                  height: reducedMotion ? "auto" : 0,
                  opacity: 0,
                }}
                transition={{ duration: reducedMotion ? 0.15 : 0.25 }}
              >
                <div className="xp-hud-details-inner">
                  <dl>
                    <div>
                      <dt>{t("До следующего уровня")}</dt>
                      <dd>
                        {nextThreshold === null
                          ? t("Максимум")
                          : `${numberFormatter.format(nextThreshold - xp)} XP`}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Дней подряд в сессии")}</dt>
                      <dd>{streak}</dd>
                    </div>
                    <div>
                      <dt>{t("Ранг колониста")}</dt>
                      <dd>{colonistRank ? t("1 · Пропуск получен") : t("Исследователь")}</dd>
                    </div>
                  </dl>

                  <p className="xp-last-reward">{lastReward}</p>

                  <p className="xp-hud-note">
                    {t("XP — прогресс этого лендинга, не токены.")}
                    {t("Сохраняется в текущей браузерной сессии.")}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </aside>

      {typeof document !== "undefined" &&
        createPortal(
          <div className="xp-flight-layer" aria-hidden="true">
            <AnimatePresence>
              {flights.map((flight) => (
                <FlyingXp
                  key={flight.id}
                  flight={flight}
                  destination={destinationRef}
                  complete={removeFlight}
                />
              ))}
            </AnimatePresence>
          </div>,
          document.body,
        )}

      <LevelUpPresentation />
    </>
  );
}
