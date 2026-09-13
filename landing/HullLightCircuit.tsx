import { useId } from "react";
import { motion } from "framer-motion";

export interface HullLightCircuitProps {
  readonly path: string;
  readonly innerPath: string;
  readonly width: number;
  readonly height: number;
  readonly active: boolean;
  readonly engaged: boolean;
  readonly reducedMotion: boolean;
  readonly danger?: boolean;
}

export function HullLightCircuit({
  path,
  innerPath,
  width,
  height,
  active,
  engaged,
  reducedMotion,
  danger = false,
}: HullLightCircuitProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const moving = active && !reducedMotion;
  const perimeter = Math.max(1, 2 * (width + height));
  const packet = Math.max(12, Math.min(65, 80 / perimeter * 1000));

  return (
    <g aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-spectrum`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={danger ? "#FF9CAA" : "#8BCBFF"} stopOpacity="0.8" />
          <stop offset="0.25" stopColor="#4067A9" stopOpacity="0.15" />
          <stop offset="0.53" stopColor="#FF2E93" stopOpacity="0.65" />
          <stop offset="0.78" stopColor="#B85CFF" stopOpacity="0.2" />
          <stop offset="1" stopColor="#FFCB83" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      <path
        d={path}
        fill="none"
        stroke={`url(#${id}-spectrum)`}
        strokeWidth="7"
        strokeOpacity={engaged ? 0.09 : 0.035}
        strokeLinejoin="bevel"
      />

      <path
        d={path}
        fill="none"
        stroke={`url(#${id}-spectrum)`}
        strokeWidth="1"
        strokeOpacity={engaged ? 0.8 : 0.45}
      />

      <motion.path
        d={innerPath}
        fill="none"
        stroke="#FF65B4"
        strokeWidth="0.65"
        initial={false}
        animate={{
          opacity: moving
            ? [engaged ? 0.18 : 0.06, engaged ? 0.42 : 0.18, engaged ? 0.18 : 0.06]
            : 0.12,
        }}
        transition={{
          duration: moving ? 5.5 : 0,
          repeat: moving ? Infinity : 0,
          ease: "easeInOut",
        }}
      />

      {moving && (
        <>
          <motion.path
            ref={(element) => element?.setAttribute("pathLength", "1000")}
            d={path}
            fill="none"
            stroke={danger ? "#FFB7BA" : "#A7DCFF"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${packet} ${1000 - packet}`}
            initial={{ strokeDashoffset: 0 }}
            animate={{ strokeDashoffset: -1000 }}
            transition={{
              duration: engaged ? 3.8 : 9,
              repeat: Infinity,
              ease: "linear",
            }}
            opacity={engaged ? 0.85 : 0.42}
          />

          <motion.path
            ref={(element) => element?.setAttribute("pathLength", "1000")}
            d={innerPath}
            fill="none"
            stroke="#FF87CC"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={`${packet * 0.6} ${1000 - packet * 0.6}`}
            initial={{ strokeDashoffset: -480 }}
            animate={{ strokeDashoffset: 520 }}
            transition={{
              duration: engaged ? 5.5 : 13,
              repeat: Infinity,
              ease: "linear",
            }}
            opacity={engaged ? 0.9 : 0.4}
          />

          <motion.path
            ref={(element) => element?.setAttribute("pathLength", "1000")}
            d={path}
            fill="none"
            stroke="#FFF4DC"
            strokeWidth="2"
            strokeLinecap="square"
            strokeDasharray="2 998"
            initial={{ strokeDashoffset: -160, opacity: 0 }}
            animate={{
              strokeDashoffset: -1160,
              opacity: [0, 0.7, 0.7, 0],
            }}
            transition={{
              duration: 7,
              repeat: Infinity,
              repeatDelay: 3,
              ease: "linear",
            }}
          />
        </>
      )}
    </g>
  );
}
