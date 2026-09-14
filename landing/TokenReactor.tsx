import { useId, useState } from "react";
import { motion } from "framer-motion";
import { tokenCycle } from "./content";
import { useLivingScene } from "./useLivingScene";
import "./living-engineering.css";

interface ReactorSector {
  readonly label: string;
  readonly hint: string;
  readonly path: string;
  readonly color: readonly [string, string, string];
}

function polar(radius: number, degrees: number): { x: number; y: number } {
  const radians = degrees * Math.PI / 180;

  return {
    x: 250 + Math.cos(radians) * radius,
    y: 250 + Math.sin(radians) * radius,
  };
}

function ringSegment(start: number, end: number): string {
  const outerStart = polar(180, start);
  const outerEnd = polar(180, end);
  const innerEnd = polar(132, end);
  const innerStart = polar(132, start);
  const large = end - start > 180 ? 1 : 0;

  return [
    `M${outerStart.x} ${outerStart.y}`,
    `A180 180 0 ${large} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L${innerEnd.x} ${innerEnd.y}`,
    `A132 132 0 ${large} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function createSectors(): readonly ReactorSector[] {
  const cycleColors = [
    ["#0DE1B9", "#BBFFE7", "#125347"],
    ["#398FFF", "#B8EAFF", "#143568"],
    ["#FF249D", "#FFA6DB", "#681044"],
  ] as const;
  const cycle = [
    { label: tokenCycle.birth.title, hint: "эмиссия эпохи" },
    { label: tokenCycle.flow.title, hint: "кошельки · ордера · мост AOF" },
    { label: tokenCycle.death.title, hint: "комиссии · налоги · рецепты" },
  ];

  let angle = -90;
  return cycle.map((item, index) => {
    const start = angle;
    angle += 120; // три равные фазы цикла
    return {
      label: item.label,
      hint: item.hint,
      path: ringSegment(start + 1.2, angle - 1.2),
      color: cycleColors[index] ?? cycleColors[0],
    };
  });
}

const sectors = createSectors();

export function TokenReactor(): JSX.Element {
  const { ref, active, reducedMotion } = useLivingScene<HTMLDivElement>();
  const id = useId().replace(/:/g, "");
  const [selected, setSelected] = useState(0);
  const sector = sectors[selected] ?? sectors[0];

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
          <svg
            className="reactor-svg"
            viewBox="0 0 500 540"
            width="500"
            height="540"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id={`${id}-core`}>
                <stop stopColor="#482048" />
                <stop offset="0.55" stopColor="#191729" />
                <stop offset="1" stopColor="#070C15" />
              </radialGradient>

              <radialGradient id={`${id}-field`}>
                <stop stopColor="#FF2E93" stopOpacity="0.18" />
                <stop offset="0.7" stopColor="#824FFF" stopOpacity="0.04" />
                <stop offset="1" stopColor="#824FFF" stopOpacity="0" />
              </radialGradient>

              {sectors.map((item, index) => (
                <linearGradient
                  key={item.label}
                  id={`${id}-sector-${index}`}
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop stopColor={item.color[1]} />
                  <stop offset="0.24" stopColor={item.color[0]} />
                  <stop offset="0.55" stopColor={item.color[1]} />
                  <stop offset="0.62" stopColor={item.color[0]} />
                  <stop offset="1" stopColor={item.color[2]} />
                </linearGradient>
              ))}
            </defs>

            <circle cx="250" cy="250" r="242" fill={`url(#${id}-field)`} />

            <ellipse cx="250" cy="285" rx="201" ry="198" fill="#080811" stroke="#413447" />

            <g transform="translate(0 20)">
              <circle cx="250" cy="250" r="196" fill="#20202C" stroke="#6C5A76" />
              <circle cx="250" cy="250" r="189" fill="#0C0C15" />
              {sectors.map((item) => (
                <path
                  key={item.label}
                  d={item.path}
                  fill={item.color[2]}
                  stroke="#0B0912"
                  strokeWidth="2"
                />
              ))}
            </g>

            <circle cx="250" cy="250" r="196" fill="#232331" stroke="#A79DB5" strokeOpacity="0.6" />
            <circle cx="250" cy="250" r="188" fill="#080C15" stroke="#090711" strokeWidth="3" />

            {sectors.map((item, index) => (
              <g key={item.label}>
                <path
                  d={item.path}
                  fill={`url(#${id}-sector-${index})`}
                  stroke={item.color[1]}
                  strokeOpacity={selected === index ? 0.85 : 0.35}
                  strokeWidth={selected === index ? 1.8 : 0.8}
                />
                <motion.path
                  d={item.path}
                  fill={item.color[1]}
                  initial={false}
                  animate={{
                    opacity:
                      selected === index && active
                        ? [0, 0.18, 0]
                        : selected === index ? 0.08 : 0,
                  }}
                  transition={{
                    duration: active ? 2.8 : 0,
                    repeat: selected === index && active ? Infinity : 0,
                    ease: "easeInOut",
                  }}
                />
              </g>
            ))}

            <circle cx="250" cy="250" r="129" fill={`url(#${id}-core)`} stroke="#A088B5" strokeOpacity="0.5" />
            <circle cx="250" cy="250" r="116" fill="none" stroke="#5D4668" strokeDasharray="1 8" />

            <motion.g
              style={{ transformOrigin: "250px 250px" }}
              animate={{ rotate: active ? [0, 360] : 0 }}
              transition={{
                duration: active ? 40 : 0,
                repeat: active ? Infinity : 0,
                ease: "linear",
              }}
            >
              <circle cx="250" cy="250" r="213" fill="none" stroke="#9C6CB5" strokeOpacity="0.3" strokeDasharray="1 12" />
              <path d="M250 37a213 213 0 0 1 150 62" fill="none" stroke="#B38DDA" strokeWidth="2" />
              <circle cx="400" cy="99" r="4" fill="#DFC2FF" />
            </motion.g>

            <motion.g
              style={{ transformOrigin: "250px 250px" }}
              animate={{ rotate: active ? [0, -360] : 0 }}
              transition={{
                duration: active ? 18 : 0,
                repeat: active ? Infinity : 0,
                ease: "linear",
              }}
            >
              <path
                d="M250 128a122 122 0 0 1 105 60"
                fill="none"
                stroke="#FF7CC5"
                strokeWidth="1.7"
              />
              <circle cx="355" cy="188" r="3" fill="#FFF1FC" />
            </motion.g>

            {Array.from({ length: 12 }, (_, index) => {
              const point = polar(196, index * 30);
              return (
                <g key={index} transform={`translate(${point.x} ${point.y}) rotate(${index * 30})`}>
                  <rect x="-4" y="-7" width="8" height="14" rx="1" fill="#161520" stroke="#8D7A99" />
                  <path d="M-2 0h4" stroke="#DED2E5" strokeWidth="1" />
                </g>
              );
            })}

            <path
              d="M250 184 276 199v30l-26 15-26-15v-30Z"
              fill="#301729"
              stroke="#FF80C5"
              strokeWidth="1.5"
            />
            <path
              d="m236 226 14-27 14 27m-23-9h18"
              fill="none"
              stroke="#FFD5EC"
              strokeWidth="2.5"
            />

            <text x="250" y="278" textAnchor="middle" fill="#FFF0F8" fontSize="26" fontFamily="'JetBrains Mono', monospace">
              $POTATO
            </text>
            <text x="250" y="301" textAnchor="middle" fill="#C2B8D6" fontSize="8" fontFamily="'JetBrains Mono', monospace" letterSpacing="2">
              ЯДРО ЭКОНОМИКИ
            </text>
            <path d="M216 323h68" stroke="#7CFF6B" strokeWidth="2" strokeOpacity="0.7" />
          </svg>
        </motion.div>
      </div>

      <div className="reactor-selector" role="group" aria-label="Фаза цикла токена">
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
        <span>ПОТОЛОК ПРЕДЛОЖЕНИЯ</span>
        <strong>1 000 000 000</strong>
        <small>Майнится игроками · горит в комиссиях</small>
      </div>
    </div>
  );
}
