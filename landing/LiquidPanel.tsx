import type { HTMLAttributes, ReactNode } from "react";
import "./liquid-panels.css";
import { AresHullFrame } from "./AresHullFrame";

export type LiquidPanelVariant = "default" | "accent" | "danger";

export interface LiquidPanelProps
  extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  readonly variant?: LiquidPanelVariant;
  readonly runningLight?: boolean;
}

export interface LiquidPanelBorderProps {
  readonly variant?: LiquidPanelVariant;
  readonly runningLight?: boolean;
}

export type DerivedPanelProps = Omit<LiquidPanelProps, "variant">;

export function LiquidPanelBorder({
  variant = "default",
  runningLight = true,
}: LiquidPanelBorderProps): JSX.Element {
  return (
    <AresHullFrame
      variant={variant}
      runningLight={runningLight}
    />
  );
}

export function LiquidPanel({
  children,
  variant = "default",
  runningLight = true,
  className = "",
  ...props
}: LiquidPanelProps): JSX.Element {
  return (
    <div
      {...props}
      className={`liquid-panel ${className}`}
      data-liquid-panel={variant}
    >
      <LiquidPanelBorder
        variant={variant}
        runningLight={runningLight}
      />
      {children}
    </div>
  );
}

export function FeaturePanel({
  className = "",
  ...props
}: DerivedPanelProps): JSX.Element {
  return (
    <LiquidPanel
      {...props}
      variant="accent"
      className={`liquid-panel--feature ${className}`}
    />
  );
}

export function StatsPanel({
  className = "",
  ...props
}: DerivedPanelProps): JSX.Element {
  return (
    <LiquidPanel
      {...props}
      variant="default"
      className={`liquid-panel--stats ${className}`}
    />
  );
}

export function QuestPanel({
  className = "",
  ...props
}: DerivedPanelProps): JSX.Element {
  return (
    <LiquidPanel
      {...props}
      variant="accent"
      className={`liquid-panel--quest ${className}`}
    />
  );
}

export function PresalePanel({
  className = "",
  ...props
}: DerivedPanelProps): JSX.Element {
  return (
    <LiquidPanel
      {...props}
      variant="accent"
      className={`liquid-panel--presale ${className}`}
    />
  );
}
