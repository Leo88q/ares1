import type { CSSProperties, ReactNode } from "react";
import { AresHullFrame } from "./AresHullFrame";

export type HullVariant = "default" | "accent" | "danger";

export interface HullPanelProps {
  readonly children: ReactNode;
  readonly variant?: HullVariant;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function HullPanel({
  children,
  variant = "default",
  className = "",
  style,
}: HullPanelProps): JSX.Element {
  return (
    <div className={`hull-panel ${className}`} style={style}>
      <AresHullFrame variant={variant} runningLight />
      <div className="hull-panel-content">{children}</div>
    </div>
  );
}
