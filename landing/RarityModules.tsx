import type { CSSProperties } from "react";
import { t } from "./i18n";
import { moduleTiers } from "./content";
import "./living-engineering.css";

const PHOTO_POS: Record<string, string> = {
  common: "0% 0",
  rare: "50% 0",
  epic: "100% 0",
};

const TINT: Record<string, string> = {
  common: "#BBD4E8",
  rare: "#C36CFF",
  epic: "#FFD278",
};

export function RarityModules(): JSX.Element {
  return (
    <div className="hydro-modules">
      {moduleTiers.map((tier, index) => (
        <div
          key={tier.id}
          className={`hydro-module hydro-module--${tier.id}`}
          style={{ "--module-tint": TINT[tier.id] } as CSSProperties}
        >
          <div className="hydro-module-heading">
            <span className="hydro-module-class">{tier.label}</span>
            <span className="hydro-module-index">0{index + 1}</span>
          </div>

          <div
            className={`hydro-module-photo hydro-module-photo--${tier.id}`}
            style={{ "--photo-pos": PHOTO_POS[tier.id] } as CSSProperties}
            role="img"
            aria-label={t("Гидропонный модуль {label}: {stage}", {
              label: tier.label,
              stage: index === 0 ? t("росток") : index === 1 ? t("каскад") : t("гелиос"),
            })}
          />

          <div className="hydro-module-data">
            <div>
              <strong>
                {tier.chancePercent}
                <small>%</small>
              </strong>
              <span>{t("шанс выпадения")}</span>
            </div>
            <div>
              <span>{t("Игровой урожай")}</span>
              <b>{tier.gameYieldPercent}%</b>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
