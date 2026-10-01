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
  if (planet === "earth") {
    return (
      <div className={`axial-planet axial-planet--neuroforge ${className}`} aria-hidden="true">
        <img
          src="/ares/planet-neuroforge.webp"
          alt=""
          draggable={false}
          className="neuroforge-planet-img"
        />
      </div>
    );
  }

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
  const mars = planet === "mars";

  return (
    <div className={`interstellar-planet-art ${className}`} aria-hidden="true">
      {/* MK-art: сгенерированная планета вместо SVG-градиентов.
          Не-марсианские миры тонируются в холодный стальной оттенок. */}
      <img
        src="/ares/planet-interstellar.webp"
        alt=""
        draggable={false}
        style={{
          width: 300,
          height: 300,
          objectFit: "contain",
          display: "block",
          userSelect: "none",
          filter: mars ? undefined : "hue-rotate(160deg) saturate(0.7) brightness(0.9)",
        }}
      />
    </div>
  );
}

function QuantumRoute({
  compact = false,
}: {
  readonly compact?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const animated = useVisibleAnimation(ref);

  return (
    <div
      ref={ref}
      className={`quantum-route ${compact ? "quantum-route--compact" : ""}`}
      aria-hidden="true"
    >
      <span className="quantum-route-arc quantum-route-arc--top" aria-hidden="true" />
      <span className="quantum-route-arc quantum-route-arc--bottom" aria-hidden="true" />
      <span className="quantum-route-line" aria-hidden="true" />

      {Array.from({ length: 12 }, (_, index) => {
        const reverse = index % 2 === 1;
        const restingLeft = `${8 + index * 7.5}%`;
        const packetColor = reverse ? (index % 4 === 1 ? "#00E5FF" : "#C084FC") : "#FFB347";

        return (
          <motion.span
            key={index}
            className="quantum-route-packet"
            style={{
              background: packetColor,
              boxShadow: `0 0 10px ${packetColor}`,
            }}
            initial={false}
            animate={
              animated
                ? {
                    left: reverse ? ["96%", "50%", "2%"] : ["2%", "50%", "96%"],
                    top: reverse ? ["50%", "80%", "50%"] : ["50%", "20%", "50%"],
                    opacity: [0, 1, 0],
                  }
                : {
                    left: restingLeft,
                    top: reverse ? "62%" : "38%",
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
  const id = useId().replace(/:/g, "");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { play } = useSounds();
  const reducedMotion = usePrefersReducedMotion();
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
              {benefit}
            </li>
          ))}
        </motion.ul>
      </div>

      {planet === "mars" && (
        <div className="interstellar-world-action">
          <a
            href="https://arena-01a0f067-ares1.ares1-play.pages.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="ares-action-link"
          >
            {t("Играть в ARES-1 ↗")}
          </a>
        </div>
      )}

      {planet === "earth" && interstellarConfig.ageOfFarmingUrl && (
        <div className="interstellar-world-action">
          <a
            href={interstellarConfig.ageOfFarmingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="neuroforge-action-link"
          >
            {SC.gameCta}
          </a>
        </div>
      )}
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
  const id = useId().replace(/:/g, "");
  const [dialogOpen, setDialogOpen] = useState(false);
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
