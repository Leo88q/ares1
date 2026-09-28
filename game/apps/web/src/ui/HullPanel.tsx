import type { CSSProperties, ReactNode } from "react";
import { AresHullFrame } from "./AresHullFrame";

/** `primary` — одна главная плита экрана (тяжёлая рамка, клёпка, объём). */
export type HullVariant = "default" | "accent" | "danger" | "primary";

export interface HullPanelProps {
  readonly children: ReactNode;
  readonly variant?: HullVariant;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * MK-редизайн (2026-09-28):
 *  - `primary` — главная плита экрана: CSS-плита с клёпкой и двойным швом,
 *    без SVG-каркаса — визуально тяжелее всех остальных и ровно одна.
 *  - `default` — рабочая плита: SVG-каркас без «бегущего огонька» (свет
 *    больше не мигает на каждой панели — он значит состояние).
 *  - `accent`/`danger` — подсветка контура остаётся: это статус.
 */
export function HullPanel({
  children,
  variant = "default",
  className = "",
  style,
}: HullPanelProps): JSX.Element {
  if (variant === "primary") {
    return (
      <div className={`hull-panel mk-plate mk-plate--primary ${className}`} style={style}>
        <div className="hull-panel-content">{children}</div>
      </div>
    );
  }
  return (
    <div className={`hull-panel ${className}`} style={style}>
      <AresHullFrame variant={variant} runningLight={variant !== "default"} />
      <div className="hull-panel-content">{children}</div>
    </div>
  );
}
