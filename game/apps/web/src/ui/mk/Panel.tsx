import type { CSSProperties, ReactNode } from "react";

/**
 * MK-плита (редизайн представления, 2026-09-28).
 *
 * Материал: штампованный металл с фаской, зерно (SVG feTurbulence data-uri),
 * царапины, тиснёный шов. Иерархия: `primary` — ОДНА тяжёлая плита на экран
 * (главная метрика: клёпка, двойной шов, глубина), `default` — рабочая плита,
 * `quiet` — фоновая заглушка. Тег `tag` — гравированный шильдик, `sticker` —
 * бумажная бирка с РЕАЛЬНЫМИ данными состояния (никаких выдуманных значений),
 * наклон 1–2°.
 */
export type MkPlateVariant = "primary" | "default" | "quiet";

export interface PanelProps {
  readonly children: ReactNode;
  readonly variant?: MkPlateVariant;
  /** Гравированный шильдик-заголовок (короткая метка секции). */
  readonly tag?: ReactNode;
  /** Бирка-стикер с реальным значением (например «ЛОТ 12»). */
  readonly sticker?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const variantClass: Record<MkPlateVariant, string> = {
  primary: "mk-plate mk-plate--primary",
  default: "mk-plate",
  quiet: "mk-plate mk-plate--quiet",
};

export function Panel({
  children,
  variant = "default",
  tag,
  sticker,
  className = "",
  style,
}: PanelProps): JSX.Element {
  return (
    <section className={`${variantClass[variant]} ${className}`} style={style}>
      {(tag || sticker) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 10,
          }}
        >
          {tag ? <span className="mk-tag">{tag}</span> : <span />}
          {sticker ? <span className="mk-sticker">{sticker}</span> : null}
        </div>
      )}
      {children}
    </section>
  );
}

/** Штамп статуса: оттиск краской под 1–2°, только фактическое состояние. */
export function Stamp({
  status,
  children,
}: {
  status: "ok" | "warn" | "danger";
  children: ReactNode;
}): JSX.Element {
  return <span className={`mk-stamp mk-stamp--${status}`}>{children}</span>;
}

/** Лампа реле: зелёная / янтарная / маджентальная, мигание — как у реле. */
export function Lamp({
  color = "green",
  on = true,
  blink = false,
}: {
  color?: "green" | "amber" | "magenta";
  on?: boolean;
  blink?: boolean;
}): JSX.Element {
  const cls = ["mk-lamp", on ? `mk-lamp--${color}` : "mk-lamp--off", blink ? "mk-lamp--blink" : ""]
    .filter(Boolean)
    .join(" ");
  return <span className={cls} aria-hidden="true" />;
}
