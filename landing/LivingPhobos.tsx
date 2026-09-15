import { useId } from "react";
import { t } from "./i18n";
import { motion } from "framer-motion";
import { useLivingScene } from "./useLivingScene";
import "./dome-habitat.css";

export function LivingPhobos(): JSX.Element {
  const { ref, active } = useLivingScene<HTMLDivElement>();
  const id = useId().replace(/:/g, "");

  const outline =
    "M31 22 69 10 103 23 124 49 130 78 111 111 79 131 43 124 17 99 8 65Z";

  return (
    <div ref={ref} className="living-phobos">
      <motion.div
        className="living-phobos-body"
        initial={false}
        animate={{
          x: active ? [-14, 23, 36, 4, -14] : 0,
          y: active ? [8, -7, 5, 15, 8] : 0,
          scale: active ? [0.97, 1.025, 1, 0.97] : 1,
        }}
        transition={{
          x: { duration: active ? 42 : 0, repeat: active ? Infinity : 0, ease: "easeInOut" },
          y: { duration: active ? 42 : 0, repeat: active ? Infinity : 0, ease: "easeInOut" },
          scale: { duration: active ? 42 : 0, repeat: active ? Infinity : 0, ease: "easeInOut" },
        }}
      >
        <motion.svg
          viewBox="0 0 140 140"
          width="140"
          height="140"
          aria-hidden="true"
          initial={false}
          animate={{ rotate: active ? [-8, 7, -8] : -4 }}
          transition={{
            duration: active ? 57 : 0,
            repeat: active ? Infinity : 0,
            ease: "easeInOut",
          }}
        >
          <defs>
            <radialGradient id={`${id}-stone`} cx="25%" cy="17%" r="85%">
              <stop stopColor="#C4B2A7" />
              <stop offset="0.25" stopColor="#8E7E81" />
              <stop offset="0.58" stopColor="#574A59" />
              <stop offset="0.85" stopColor="#242132" />
              <stop offset="1" stopColor="#10101A" />
            </radialGradient>

            <linearGradient id={`${id}-night`} x1="0" y1="0" x2="1" y2="0.6">
              <stop offset="0.25" stopColor="#060610" stopOpacity="0" />
              <stop offset="0.8" stopColor="#060610" stopOpacity="0.62" />
              <stop offset="1" stopColor="#060610" stopOpacity="0.9" />
            </linearGradient>

            <radialGradient id={`${id}-crater`} cx="65%" cy="70%">
              <stop stopColor="#3E3443" />
              <stop offset="0.7" stopColor="#292534" />
              <stop offset="1" stopColor="#5B4E5C" />
            </radialGradient>

            <clipPath id={`${id}-shape`}>
              <path d={outline} />
            </clipPath>

            <pattern
              id={`${id}-grain`}
              width="13"
              height="11"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="3" r="0.6" fill="#E0C8BD" opacity="0.2" />
              <circle cx="8" cy="7" r="0.9" fill="#120F20" opacity="0.2" />
              <path d="M4 9h2" stroke="#A4929A" strokeWidth="0.5" opacity="0.25" />
            </pattern>
          </defs>

          <path d={outline} fill={`url(#${id}-stone)`} />

          <g clipPath={`url(#${id}-shape)`}>
            <path
              d="m14 47 31-16 22 7 27-11 24 19-10 33-28 14-31-9-26 12"
              fill="#BBB0B2"
              opacity="0.055"
            />

            <g fill="none" strokeLinecap="round">
              <path d="M23 73 48 66 60 43M30 93l30-11 23 6M65 117l14-26 27-6" stroke="#231E30" strokeWidth="2" opacity="0.65" />
              <path d="M24 71 48 64 59 43M31 91l29-11 23 6" stroke="#C2ABAA" strokeWidth="0.6" opacity="0.3" />
              <path d="m75 30 5 22 20 7M14 61l20-8" stroke="#D0B8AB" strokeWidth="0.6" opacity="0.3" />
            </g>

            {[
              { x: 45, y: 46, rx: 17, ry: 12 },
              { x: 88, y: 78, rx: 24, ry: 27 },
              { x: 45, y: 98, rx: 10, ry: 7 },
              { x: 72, y: 29, rx: 6, ry: 4 },
              { x: 24, y: 70, rx: 5, ry: 7 },
              { x: 66, y: 108, rx: 5, ry: 4 },
              { x: 109, y: 45, rx: 8, ry: 6 },
            ].map((crater, index) => (
              <g key={index}>
                <ellipse
                  cx={crater.x}
                  cy={crater.y}
                  rx={crater.rx + 1.5}
                  ry={crater.ry + 1.3}
                  fill="#B4A09D"
                  opacity="0.17"
                />
                <ellipse
                  {...crater}
                  fill={`url(#${id}-crater)`}
                />
                <ellipse
                  cx={crater.x - crater.rx * 0.1}
                  cy={crater.y + crater.ry * 0.35}
                  rx={crater.rx * 0.68}
                  ry={crater.ry * 0.46}
                  fill="#8D7880"
                  opacity="0.16"
                />
              </g>
            ))}

            <path d={outline} fill={`url(#${id}-grain)`} />
            <path d={outline} fill={`url(#${id}-night)`} />
          </g>

          <path
            d="M13 57 32 23 69 11 91 18"
            fill="none"
            stroke="#D4B9AA"
            strokeOpacity="0.38"
            strokeWidth="1.1"
          />
          <path
            d="M110 109 79 130 45 124"
            fill="none"
            stroke="#7894C9"
            strokeOpacity="0.18"
            strokeWidth="0.7"
          />
        </motion.svg>

        <div className="living-phobos-caption">
          <span className="living-phobos-dot" />
          {t("ФОБОС")}
          <small>{t("СПУТНИК МАРСА")}</small>
        </div>
      </motion.div>
    </div>
  );
}
