import { t, tr, useI18n, getLang } from "./i18n";
import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useScroll,
  useTransform,
} from "framer-motion";
import {
  interstellarConfig,
  interstellarContent,
} from "./content";
import { LiquidPanel } from "./LiquidPanel";
import { MorphButton } from "./MorphButton";
import { useSounds } from "./useSounds";
import { AxialPlanet } from "./AxialPlanet";
import { usePrefersReducedMotion } from "./hooks";
import "./interstellar.css";

export interface InterstellarMetrics {
  readonly transferredPotato: number | null;
  readonly nextFlightAt: string | null;
}

export interface InterstellarBridgeProps {
  readonly metrics?: InterstellarMetrics;
  readonly ageOfFarmingUrl?: string | null;
}

type PlanetName = "mars" | "earth";

interface PlanetArtProps {
  readonly planet: PlanetName;
  readonly className?: string;
}

interface BridgeDialogProps {
  readonly open: boolean;
  readonly close: () => void;
  readonly metrics: InterstellarMetrics;
  readonly ageOfFarmingUrl: string | null;
}

const emptyMetrics: InterstellarMetrics = {
  transferredPotato: null,
  nextFlightAt: null,
};

const LOCALES: Record<string, string> = {
  en: "en-US",
  ru: "ru-RU",
  "pt-BR": "pt-BR",
  "es-419": "es-MX",
  vi: "vi-VN",
  id: "id-ID",
  tl: "fil-PH",
};

function currentLocale(): string {
  try {
    return LOCALES[getLang()] ?? "ru-RU";
  } catch {
    return "ru-RU";
  }
}

const SC = tr(interstellarContent);
const revealEase = [0.19, 1, 0.22, 1] as const;

function safeExternalUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function useVisibleAnimation<T extends HTMLElement>(
  ref: RefObject<T>,
): boolean {
  const reducedMotion = usePrefersReducedMotion();
  const inView = useInView(ref, { amount: 0 });
  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );

  useEffect(() => {
    function update(): void {
      setPageVisible(!document.hidden);
    }

    document.addEventListener("visibilitychange", update);
    update();

    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return !reducedMotion && inView && pageVisible;
}

function PlanetArt({
  planet,
  className = "",
}: PlanetArtProps): JSX.Element {
  return (
    <AxialPlanet planet={planet}>
      <StaticPlanetArt planet={planet} className={className} />
    </AxialPlanet>
  );
}

function StaticPlanetArt({
  planet,
  className = "",
}: PlanetArtProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const mars = planet === "mars";

  return (
    <svg
      className={`interstellar-planet-art ${className}`}
      width="300"
      height="300"
      viewBox="0 0 300 300"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-atmosphere`}>
          <stop
            offset="65%"
            stopColor={mars ? "#C1440E" : "#6B93D6"}
            stopOpacity="0"
          />
          <stop
            offset="77%"
            stopColor={mars ? "#E0A183" : "#12E7C4"}
            stopOpacity="0.2"
          />
          <stop
            offset="100%"
            stopColor={mars ? "#C1440E" : "#6B93D6"}
            stopOpacity="0"
          />
        </radialGradient>

        <radialGradient id={`${id}-surface`} cx="30%" cy="25%" r="80%">
          <stop offset="0%" stopColor={mars ? "#E5AA82" : "#7AB6DB"} />
          <stop offset="40%" stopColor={mars ? "#C1440E" : "#276C9F"} />
          <stop offset="78%" stopColor={mars ? "#61220D" : "#13354F"} />
          <stop offset="100%" stopColor="#090711" />
        </radialGradient>

        <linearGradient id={`${id}-shadow`} x1="0" y1="0" x2="1" y2="0.5">
          <stop offset="20%" stopColor="#050308" stopOpacity="0" />
          <stop offset="100%" stopColor="#050308" stopOpacity="0.85" />
        </linearGradient>

        <clipPath id={`${id}-clip`}>
          <circle cx="150" cy="150" r="101" />
        </clipPath>
      </defs>

      <circle cx="150" cy="150" r="144" fill={`url(#${id}-atmosphere)`} />
      <circle
        cx="150"
        cy="150"
        r="118"
        stroke={mars ? "#E0A183" : "#6B93D6"}
        strokeOpacity="0.14"
        strokeDasharray="2 10"
      />

      <circle cx="150" cy="150" r="101" fill={`url(#${id}-surface)`} />

      <g clipPath={`url(#${id}-clip)`}>
        {mars ? (
          <>
            <path
              d="M48 102 90 85 123 102 156 98 197 119 237 102"
              stroke="#8A2E08"
              strokeWidth="13"
              strokeOpacity="0.45"
            />
            <path
              d="m63 155 39-16 27 12 25-8 36 24 44-7"
              stroke="#53230F"
              strokeWidth="8"
              strokeOpacity="0.65"
            />
            <path
              d="m59 183 39-12 24 10 35-1 32 17 45-4"
              stroke="#EA9A6A"
              strokeWidth="4"
              strokeOpacity="0.4"
            />
            <ellipse cx="112" cy="109" rx="17" ry="11" fill="#943612" opacity="0.6" />
            <ellipse cx="181" cy="185" rx="24" ry="17" fill="#67270F" opacity="0.4" />
            <ellipse cx="87" cy="182" rx="11" ry="8" fill="#EEB68C" opacity="0.25" />
            <path
              d="m129 157 18-3 11 7 23-2"
              stroke="#F4C2A1"
              strokeWidth="1.5"
              strokeOpacity="0.6"
            />
            <circle cx="150" cy="157" r="4" fill="#FF2E93" />
            <circle cx="150" cy="157" r="9" stroke="#FF2E93" strokeOpacity="0.5" />
          </>
        ) : (
          <>
            <path
              d="m79 71 30 3 13 16-8 18 9 19-12 16-20-1-5 18-18-9-10-27 7-29Z"
              fill="#63AF78"
            />
            <path
              d="m108 147 24 6 9 25-10 20-1 28-16 13-8-30-13-20Z"
              fill="#3E8F60"
            />
            <path
              d="m159 66 39 11 20 16 27 2 12 29-25 13-20-8-10 17-25-11-5-22-22-8Z"
              fill="#75B879"
            />
            <path
              d="m169 137 26 8 11 22-13 31-13 5-17-24-9-24Z"
              fill="#509B64"
            />
            <path
              d="m217 199 20-4 19 18-15 13-25-4Z"
              fill="#76AD78"
            />
            <g stroke="#E4F7FF" strokeOpacity="0.55" strokeLinecap="round">
              <path d="M68 113c25-17 44-14 63-7" strokeWidth="5" />
              <path d="M135 76c24-8 50 0 62 9" strokeWidth="4" />
              <path d="M134 210c27 12 63 5 82-10" strokeWidth="6" />
              <path d="M180 124c26 5 37 17 44 33" strokeWidth="4" />
            </g>
          </>
        )}

        <circle cx="150" cy="150" r="101" fill={`url(#${id}-shadow)`} />
      </g>

      <circle
        cx="150"
        cy="150"
        r="101"
        stroke={mars ? "#E0A183" : "#B4DEFA"}
        strokeOpacity="0.42"
      />
      <path
        d="M68 102a100 100 0 0 1 93-53"
        stroke={mars ? "#F3C2A2" : "#D6F6FF"}
        strokeWidth="2"
        strokeOpacity="0.65"
        strokeLinecap="round"
      />
    </svg>
  );
}

function QuantumRoute({
  compact = false,
}: {
  readonly compact?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const animated = useVisibleAnimation(ref);
  const id = useId().replace(/:/g, "");

  return (
    <div
      ref={ref}
      className={`quantum-route ${compact ? "quantum-route--compact" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 800 180" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`${id}-route`}>
            <stop offset="0%" stopColor="#C1440E" />
            <stop offset="45%" stopColor="#FF2E93" />
            <stop offset="100%" stopColor="#12E7C4" />
          </linearGradient>
        </defs>

        <path
          d="M20 90C210 18 590 18 780 90"
          fill="none"
          stroke={`url(#${id}-route)`}
          strokeOpacity="0.2"
          strokeWidth="1"
        />
        <path
          d="M20 90C210 162 590 162 780 90"
          fill="none"
          stroke={`url(#${id}-route)`}
          strokeOpacity="0.2"
          strokeWidth="1"
        />
        <path
          d="M20 90H780"
          stroke={`url(#${id}-route)`}
          strokeOpacity="0.36"
          strokeWidth="1"
          strokeDasharray="3 9"
        />

        {Array.from({ length: 12 }, (_, index) => {
          const reverse = index % 2 === 1;
          const restingX = 50 + index * 62;

          return (
            <motion.circle
              key={index}
              r={index % 3 === 0 ? 3 : 2}
              fill={reverse ? "#7CFF6B" : "#FFB347"}
              initial={false}
              animate={
                animated
                  ? {
                      cx: reverse ? [780, 400, 20] : [20, 400, 780],
                      cy: reverse ? [90, 128, 90] : [90, 52, 90],
                      opacity: [0, 1, 0],
                    }
                  : {
                      cx: restingX,
                      cy: reverse ? 108 : 72,
                      opacity: 0.5,
                    }
              }
              transition={
                animated
                  ? {
                      duration: 2.8 + (index % 3) * 0.35,
                      delay: index * 0.19,
                      repeat: Infinity,
                      ease: "linear",
                    }
                  : { duration: 0 }
              }
            />
          );
        })}
      </svg>

      {!compact && (
        <div className="quantum-route-label">
          <span>$POTATO</span>
          <small>{t("ДВА МИРА · ОДИН СИГНАЛ")}</small>
        </div>
      )}
    </div>
  );
}

function BridgeMetrics({
  metrics,
}: {
  readonly metrics: InterstellarMetrics;
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  const flightTime = metrics.nextFlightAt
    ? Date.parse(metrics.nextFlightAt)
    : NaN;

  useEffect(() => {
    if (!Number.isFinite(flightTime)) {
      return;
    }

    function refresh(): void {
      if (!document.hidden) {
        setNow(Date.now());
      }
    }

    refresh();
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [flightTime]);

  const transferred =
    metrics.transferredPotato !== null &&
    Number.isFinite(metrics.transferredPotato) &&
    metrics.transferredPotato >= 0
      ? `${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 6 }).format(metrics.transferredPotato)} $POTATO`
      : SC.noMetrics;

  let schedule = SC.noSchedule as string;

  if (Number.isFinite(flightTime)) {
    const remaining = flightTime - now;

    schedule =
      remaining > 0
        ? t("Через {h} ч", { h: Math.max(1, Math.ceil(remaining / 3_600_000)) })
        : SC.awaitingSchedule;
  }

  return (
    <dl className="interstellar-metrics">
      <div>
        <dt>{SC.transferLabel}</dt>
        <dd>{transferred}</dd>
      </div>
      <div>
        <dt>{SC.nextFlightLabel}</dt>
        <dd>{schedule}</dd>
        {Number.isFinite(flightTime) && (
          <small>
            {new Intl.DateTimeFormat(currentLocale(), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(flightTime)} · {t("по твоим часам")}
          </small>
        )}
      </div>
    </dl>
  );
}

function BridgeDialog({
  open,
  close,
  metrics,
  ageOfFarmingUrl,
}: BridgeDialogProps): JSX.Element {
  useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { play } = useSounds();
  const reducedMotion = usePrefersReducedMotion();
  const id = useId().replace(/:/g, "");
  const url = safeExternalUrl(ageOfFarmingUrl);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
      play("interstellar.bridge", 0.4);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, play]);

  return (
    <dialog
      ref={dialogRef}
      className="interstellar-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      data-lenis-prevent
      onCancel={close}
      onClose={() => {
        if (open) {
          close();
        }
      }}
    >
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="interstellar-dialog-content"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reducedMotion ? 0.15 : 0.35,
              ease: revealEase,
            }}
          >
            <div className="interstellar-dialog-top">
              <p className="interstellar-eyebrow">
                {SC.routeLabel}
              </p>
              <button
                type="button"
                className="interstellar-close"
                aria-label={SC.close}
                onClick={close}
                autoFocus
              >
                ×
              </button>
            </div>

            <h2 id={`${id}-title`}>{SC.dialogTitle}</h2>
            <p id={`${id}-description`}>
              {SC.dialogDescription}
            </p>

            <div className="interstellar-mini-scene" aria-hidden="true">
              <PlanetArt planet="mars" />
              <QuantumRoute compact />
              <PlanetArt planet="earth" />
            </div>

            <BridgeMetrics metrics={metrics} />

            <p className="interstellar-safety">
              {interstellarConfig.status === "planned"
                ? SC.plannedNotice
                : SC.openNotice}
            </p>

            {url ? (
              <MorphButton
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                fullWidth
                magnetic={false}
              >
                {SC.gameCta}
              </MorphButton>
            ) : (
              <p className="interstellar-unavailable">
                {SC.unavailableLink}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </dialog>
  );
}

function PlanetCard({
  planet,
  selected,
  select,
}: {
  readonly planet: PlanetName;
  readonly selected: boolean;
  readonly select: () => void;
}): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const id = useId().replace(/:/g, "");
  const copy = SC[planet];

  return (
    <div
      className={`interstellar-world interstellar-world--${planet}`}
      onMouseEnter={select}
    >
      <button
        type="button"
        className="interstellar-planet-button"
        onFocus={select}
        onClick={select}
      >
        <PlanetArt planet={planet} />
        <span className="interstellar-world-planet">{copy.planet}</span>
        <strong>{copy.name}</strong>
        <span className="interstellar-world-description">{copy.description}</span>
      </button>

      <div className={`interstellar-benefit-slot${selected ? " is-selected" : ""}`}>
        <motion.ul
          id={`${id}-benefits`}
          className="interstellar-benefits"
          aria-label={`${SC.benefitsLabel}: ${copy.name}`}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0.15 : 0.25 }}
        >
          {copy.benefits.map((benefit) => (
            <li key={benefit}>
              <span aria-hidden="true">✦</span>
              {benefit}
            </li>
          ))}
        </motion.ul>
      </div>
    </div>
  );
}

export function InterstellarSection(): JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  useI18n();
  const reducedMotion = usePrefersReducedMotion();
  const [selected, setSelected] = useState<PlanetName>("mars");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const marsY = useTransform(
    scrollYProgress,
    [0, 1],
    reducedMotion ? [0, 0] : [22, -22],
  );

  const earthY = useTransform(
    scrollYProgress,
    [0, 1],
    reducedMotion ? [0, 0] : [38, -38],
  );

  return (
    <section
      ref={sectionRef}
      id="interstellar"
      className="section interstellar-section"
      aria-labelledby="interstellar-title"
    >
      <div className="container">
        <motion.div
          className="interstellar-heading"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{
            duration: reducedMotion ? 0.15 : 0.7,
            ease: revealEase,
          }}
        >
          <p className="interstellar-eyebrow">
            {SC.eyebrow}
          </p>
          <h2 id="interstellar-title">{SC.title}</h2>
          <p className="interstellar-subtitle">{SC.subtitle}</p>
          <span className="interstellar-status">
            <span aria-hidden="true" />
            {interstellarConfig.status === "planned"
              ? SC.plannedLabel
              : SC.availableLabel}
          </span>
        </motion.div>

        <div className="interstellar-worlds">
          <div className="interstellar-wide-route">
            <QuantumRoute />
          </div>

          <motion.div style={{ y: marsY }}>
            <PlanetCard
              planet="mars"
              selected={selected === "mars"}
              select={() => setSelected("mars")}
            />
          </motion.div>

          <motion.div style={{ y: earthY }}>
            <PlanetCard
              planet="earth"
              selected={selected === "earth"}
              select={() => setSelected("earth")}
            />
          </motion.div>
        </div>

        <p className="interstellar-interaction-hint">
          {SC.benefitHint}
        </p>

        <LiquidPanel
          variant="accent"
          runningLight
          className="interstellar-story"
        >
          <div className="interstellar-story-heading">
            <span className="interstellar-signal" aria-hidden="true">17.42</span>
            <div>
              <p className="interstellar-eyebrow">
                {SC.frequencyLabel}
              </p>
              <h3>{SC.narrativeLabel}</h3>
            </div>
          </div>

          <div className="interstellar-story-columns">
            {SC.paragraphs.map((paragraph, index) => (
              <motion.p
                key={paragraph}
                initial={{ opacity: 0, y: reducedMotion ? 0 : 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{
                  duration: reducedMotion ? 0.15 : 0.6,
                  delay: reducedMotion ? 0 : index * 0.08,
                }}
              >
                {paragraph}
              </motion.p>
            ))}
          </div>

          <p className="interstellar-narrative-notice">
            {SC.narrativeNotice}
          </p>
        </LiquidPanel>

        <div className="interstellar-section-actions">
          <MorphButton
            type="button"
            onClick={() => setDialogOpen(true)}
          >
            {SC.cta}
          </MorphButton>
          <p>{SC.plannedNotice}</p>
        </div>
      </div>

      <BridgeDialog
        open={dialogOpen}
        close={() => setDialogOpen(false)}
        metrics={emptyMetrics}
        ageOfFarmingUrl={interstellarConfig.ageOfFarmingUrl}
      />
    </section>
  );
}

export function InterstellarBridge({
  metrics = emptyMetrics,
  ageOfFarmingUrl = interstellarConfig.ageOfFarmingUrl,
}: InterstellarBridgeProps): JSX.Element {
  useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const id = useId().replace(/:/g, "");
  const url = safeExternalUrl(ageOfFarmingUrl);

  return (
    <>
      <LiquidPanel
        variant="accent"
        runningLight
        className="interstellar-game-panel"
        role="group"
        aria-labelledby={`${id}-title`}
      >
        <div className="interstellar-game-heading">
          <p className="interstellar-eyebrow">
            {SC.routeLabel}
          </p>
          <span className="interstellar-status">
            <span aria-hidden="true" />
            {interstellarConfig.status === "planned"
              ? SC.plannedLabel
              : SC.availableLabel}
          </span>
        </div>

        <h3 id={`${id}-title`}>{SC.dialogTitle}</h3>
        <p className="interstellar-game-description">
          {SC.subtitle}
        </p>

        <div className="interstellar-mini-scene" aria-hidden="true">
          <PlanetArt planet="mars" />
          <QuantumRoute compact />
          <PlanetArt planet="earth" />
        </div>

        <BridgeMetrics metrics={metrics} />

        <div className="interstellar-game-actions">
          {url ? (
            <MorphButton
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              fullWidth
            >
              {SC.gameCta}
            </MorphButton>
          ) : (
            <MorphButton
              type="button"
              variant="secondary"
              fullWidth
              onClick={() => setDialogOpen(true)}
            >
              {SC.detailsCta}
            </MorphButton>
          )}

          {url && (
            <button
              type="button"
              className="interstellar-detail-link"
              onClick={() => setDialogOpen(true)}
            >
              {SC.detailsCta}
            </button>
          )}
        </div>

        <p className="interstellar-game-note">
          {interstellarConfig.status === "planned"
            ? SC.plannedNotice
            : SC.openNotice}
        </p>
      </LiquidPanel>

      <BridgeDialog
        open={dialogOpen}
        close={() => setDialogOpen(false)}
        metrics={metrics}
        ageOfFarmingUrl={ageOfFarmingUrl}
      />
    </>
  );
}
