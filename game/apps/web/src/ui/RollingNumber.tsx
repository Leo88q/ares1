import { AnimatePresence, motion } from "framer-motion";
import { usePrefersReducedMotion } from "../components/ares/effects";

const easeOutCubic = [1 / 3, 1, 2 / 3, 1] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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
            <span key={`digit-${positionFromRight}`} className="rolling-digit">
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
