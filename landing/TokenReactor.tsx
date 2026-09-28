import { useMemo, useState } from "react";
import { t, tr, useI18n } from "./i18n";
import { motion } from "framer-motion";
import { tokenCycle } from "./content";
import { useLivingScene } from "./useLivingScene";
import "./living-engineering.css";

interface ReactorSector {
  readonly label: string;
  readonly hint: string;
  readonly color: readonly [string, string, string];
}

// tr() — ленивый прокси: строки пере-переводятся при каждом обращении,
// поэтому пересборка sectors по смене языка даёт актуальные подписи.
const TC = tr(tokenCycle);

function createSectors(): readonly ReactorSector[] {
  const cycleColors = [
    ["#0DE1B9", "#BBFFE7", "#125347"],
    ["#398FFF", "#B8EAFF", "#143568"],
    ["#FF249D", "#FFA6DB", "#681044"],
  ] as const;
  const cycle = [
    { label: TC.birth.title, hint: t("эмиссия эпохи") },
    { label: TC.flow.title, hint: t("кошельки · ордера · мост AOF") },
    { label: TC.death.title, hint: t("комиссии · налоги · рецепты") },
  ];

  return cycle.map((item, index) => ({
    label: item.label,
    hint: item.hint,
    color: cycleColors[index] ?? cycleColors[0],
  }));
}

export function TokenReactor(): JSX.Element {
  const { ref, active, reducedMotion } = useLivingScene<HTMLDivElement>();
  const { lang } = useI18n();
  const sectors = useMemo<readonly ReactorSector[]>(() => createSectors(), [lang]);
  const [selected, setSelected] = useState(0);
  const sector = sectors[selected] ?? sectors[0];
  if (!sector) return <></>;

  return (
    <div ref={ref} className="token-reactor">
      <div className="reactor-stage">
        <div className="reactor-floor-shadow" aria-hidden="true" />

        <motion.div
          className="reactor-perspective"
          initial={false}
          animate={{
            y: active ? [0, -7, 0] : 0,
            rotateX: reducedMotion ? 0 : 24,
            rotateZ: reducedMotion ? 0 : -8,
          }}
          transition={{
            y: {
              duration: active ? 7 : 0,
              repeat: active ? Infinity : 0,
              ease: "easeInOut",
            },
            rotateX: { duration: reducedMotion ? 0 : 0.6 },
            rotateZ: { duration: reducedMotion ? 0 : 0.6 },
          }}
        >
          <div className="reactor-dial" aria-hidden="true">
            <span className="reactor-field" />
            <span className="reactor-shell" />
            <span
              className="reactor-sectors"
              style={{
                background: `conic-gradient(from -90deg, ${(sectors[0] as ReactorSector).color[2]} 0 120deg, ${(sectors[1] as ReactorSector).color[2]} 120deg 240deg, ${(sectors[2] as ReactorSector).color[2]} 240deg 360deg)`,
              }}
            />
            <motion.span
              className="reactor-sector-glow"
              style={{
                background: `conic-gradient(from ${selected * 120 - 90 + 1.2}deg, transparent 0 1.2deg, ${sector.color[1]}59 1.2deg 118.8deg, transparent 118.8deg 360deg)`,
              }}
              initial={false}
              animate={{ opacity: active ? [0.35, 1, 0.35] : 0.5 }}
              transition={{
                duration: active ? 2.8 : 0,
                repeat: active ? Infinity : 0,
                ease: "easeInOut",
              }}
            />
            <motion.span
              className="reactor-ring reactor-ring--outer"
              animate={{ rotate: active ? 360 : 0 }}
              transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
            />
            <motion.span
              className="reactor-ring reactor-ring--inner"
              animate={{ rotate: active ? -360 : 0 }}
              transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
            />
            {Array.from({ length: 12 }, (_, index) => (
              <span
                key={index}
                className="reactor-tick"
                style={{ transform: `rotate(${index * 30}deg) translateY(-196px)` }}
              />
            ))}
            <span className="reactor-core">
              <span className="reactor-hex" />
              <strong>$POTATO</strong>
              <small>{t("ЯДРО ЭКОНОМИКИ")}</small>
              <i />
            </span>
          </div>
        </motion.div>
      </div>

      <div className="reactor-selector" role="group" aria-label={t("Фаза цикла токена")}>
        {sectors.map((item, index) => (
          <button
            key={item.label}
            type="button"
            aria-label={item.label}
            aria-pressed={selected === index}
            onMouseEnter={() => setSelected(index)}
            onFocus={() => setSelected(index)}
            onClick={() => setSelected(index)}
          >
            <span style={{ backgroundColor: item.color[0] }} />
          </button>
        ))}
      </div>

      <div className="reactor-readout reactor-readout--solo">
        <strong>{sector?.hint}</strong>
      </div>

      <div className="token-supply">
        <span>{t("ПОТОЛОК ПРЕДЛОЖЕНИЯ")}</span>
        <strong>1 000 000 000</strong>
        <small>{t("Майнится игроками · горит в комиссиях")}</small>
      </div>
    </div>
  );
}
