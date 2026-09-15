import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import { t } from "./i18n";
import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "./hooks";
import "./dome-habitat.css";

interface SceneVisibility<T extends Element> {
  readonly ref: RefObject<T>;
  readonly active: boolean;
}

function useSvgVisibility<T extends Element>(): SceneVisibility<T> {
  const ref = useRef<T>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(Boolean(entries[0]?.isIntersecting));
      },
      { threshold: 0 },
    );

    function refresh(): void {
      setPageVisible(!document.hidden);
    }

    observer.observe(element);
    document.addEventListener("visibilitychange", refresh);
    refresh();

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return {
    ref,
    active: visible && pageVisible && !reducedMotion,
  };
}

interface CropProps {
  readonly active: boolean;
  readonly stage: number;
  readonly index: number;
}

function PotatoCrop({
  active,
  stage,
  index,
}: CropProps): JSX.Element {
  const id = useId().replace(/:/g, "");

  return (
    <g>
      <defs>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#C4FF88" />
          <stop offset="0.35" stopColor="#78EA67" />
          <stop offset="0.7" stopColor="#32A759" />
          <stop offset="1" stopColor="#1B543B" />
        </linearGradient>

        <linearGradient id={`${id}-tuber`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#E9C08A" />
          <stop offset="0.55" stopColor="#BD8656" />
          <stop offset="1" stopColor="#755033" />
        </linearGradient>
      </defs>

      <motion.g
        style={{ transformOrigin: "0px 0px" }}
        animate={{
          rotate: active ? [-1.6, 1.3, -1.6] : 0,
        }}
        transition={{
          duration: active ? 4.5 + index * 0.37 : 0,
          repeat: active ? Infinity : 0,
          ease: "easeInOut",
        }}
      >
        <path
          d="M0 1C-2-11 2-29 0-44"
          fill="none"
          stroke="#245E38"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <path
          d="M-.7 0C-2-14 1-31 0-43"
          fill="none"
          stroke="#C1F19B"
          strokeWidth="1"
        />

        <path
          d="M0-13C-16-9-25-21-24-31C-10-32-1-23 0-13Z"
          fill={`url(#${id}-leaf)`}
          stroke="#A0EE80"
          strokeWidth="0.55"
        />
        <path
          d="M0-24C14-19 26-29 25-40C10-42 1-32 0-24Z"
          fill={`url(#${id}-leaf)`}
          stroke="#A0EE80"
          strokeWidth="0.55"
        />
        <path
          d="M0-34C-13-32-20-41-18-50C-6-48 0-43 0-34Z"
          fill={`url(#${id}-leaf)`}
        />
        <path
          d="M0-42C12-41 17-50 13-58C4-55 0-50 0-42Z"
          fill={`url(#${id}-leaf)`}
          stroke="#BDFFA0"
          strokeWidth="0.45"
        />

        {stage >= 1 && (
          <>
            <path
              d="M0-7C15-3 27-9 28-21C14-25 3-17 0-7Z"
              fill={`url(#${id}-leaf)`}
              stroke="#9FEA7D"
              strokeWidth="0.6"
            />
            <path
              d="M-1-25C-26-21-33-34-32-41C-20-42-6-35-1-25Z"
              fill={`url(#${id}-leaf)`}
              stroke="#9FEA7D"
              strokeWidth="0.45"
            />
          </>
        )}

        <g
          stroke="#C9FF9B"
          strokeWidth="0.55"
          strokeOpacity="0.75"
          fill="none"
        >
          <path d="M-21-28-1-14M22-37 1-25M-16-47-1-35M12-54 0-43" />
          <path d="m-14-23-1-5m5 9-1-5m20-7 6 0m-11 4 6 1" />
          {stage >= 1 && <path d="M24-18 2-8M-29-38-2-26" />}
        </g>

        {stage === 2 && (
          <g transform="translate(1 -51)">
            <path
              d="M0 2V-8m0 4 5-3"
              stroke="#90D76A"
              strokeWidth="0.8"
            />
            <g fill="#DEC7FF" stroke="#9D76C4" strokeWidth="0.3">
              <ellipse cx="0" cy="-10" rx="2" ry="3" />
              <ellipse cx="-3" cy="-8" rx="3" ry="1.8" />
              <ellipse cx="3" cy="-8" rx="3" ry="1.8" />
              <ellipse cx="-2" cy="-5" rx="1.8" ry="3" />
              <ellipse cx="2" cy="-5" rx="1.8" ry="3" />
            </g>
            <circle cx="0" cy="-7" r="1.5" fill="#FFD46F" />
          </g>
        )}
      </motion.g>

      <g stroke="#E0D8AF" strokeWidth="0.7" fill="none" opacity="0.8">
        <path d="M0 3c-6 7-1 14-10 20M0 4c4 6 1 14 10 19M0 4v19" />
        <path d="m-4 12-6 2m7-6-5 1m12 4 6 3m-6-7 5 1M0 16l-4 4" />
      </g>

      {stage >= 1 && (
        <g fill={`url(#${id}-tuber)`} stroke="#D9BA8D" strokeWidth="0.4">
          <ellipse cx="-7" cy="17" rx="5.5" ry="3.6" transform="rotate(-24 -7 17)" />
          {stage === 2 && (
            <>
              <ellipse cx="7" cy="21" rx="6" ry="4" transform="rotate(17 7 21)" />
              <ellipse cx="0" cy="11" rx="4" ry="3" />
            </>
          )}
          <g fill="#765032" stroke="none">
            <circle cx="-8" cy="16" r="0.55" />
            <circle cx="-5" cy="18" r="0.5" />
            {stage === 2 && <circle cx="8" cy="20" r="0.6" />}
          </g>
        </g>
      )}
    </g>
  );
}

interface BedProps {
  readonly index: number;
  readonly active: boolean;
  readonly selected: boolean;
}

function HydroponicBed({
  index,
  active,
  selected,
}: BedProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const stage = index % 3;
  const stages = [t("РОСТОК"), t("ЛИСТВА"), t("КЛУБНИ")] as const;
  const accent = selected ? "#7CFF6B" : "#FF64BB";

  return (
    <g transform={`translate(${167 + index * 79} 367)`}>
      <defs>
        <linearGradient id={`${id}-housing`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#A095AD" />
          <stop offset="0.24" stopColor="#514456" />
          <stop offset="1" stopColor="#17131F" />
        </linearGradient>

        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FF6FBF" stopOpacity="0.19" />
          <stop offset="1" stopColor="#FF6FBF" stopOpacity="0" />
        </linearGradient>

        <linearGradient id={`${id}-solution`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#3FD9C8" stopOpacity="0.5" />
          <stop offset="1" stopColor="#0C403E" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      <ellipse cx="0" cy="41" rx="39" ry="12" fill="#05080F" opacity="0.65" />

      <path d="M-26-84-36 10H36L26-84Z" fill={`url(#${id}-light)`} />

      <g stroke="#665A70" strokeWidth="1.5">
        <path d="M-31-90V-139M31-90V-139" />
      </g>
      <path d="M-36-91h72l-4 8h-64Z" fill="#423A4C" stroke="#BA91BA" strokeWidth="0.8" />
      <path d="M-30-83h60" stroke="#FFD3EC" strokeWidth="1.7" />
      <path d="M-29-82h58" stroke="#FF2E93" strokeWidth="5" strokeOpacity="0.25" />

      <path
        d="M-34 1-9-13H15L35 0 31 28 7 42-30 25Z"
        fill={`url(#${id}-housing)`}
        stroke="#928298"
        strokeWidth="0.8"
      />
      <path
        d="M-34 1 2 20 35 0"
        fill="#261D31"
        stroke="#AA7D9F"
        strokeWidth="0.6"
      />
      <path
        d="M2 20v22M-30 25 2 42 31 28"
        fill="none"
        stroke="#0A0C15"
        strokeWidth="2"
      />

      <path d="M-28 0-8-10h21l16 10-27 14Z" fill="#111D20" stroke="#739590" strokeWidth="0.65" />
      <path d="M-25 0 1 12 26 0" fill="none" stroke={accent} strokeWidth="1.8" />

      <path
        d="M-26 11-3 23v11l-23-12ZM7 24l20-12v11L7 35Z"
        fill={`url(#${id}-solution)`}
        stroke="#75BBAC"
        strokeOpacity="0.4"
        strokeWidth="0.6"
      />

      <g transform="translate(0 -3)">
        <PotatoCrop active={active} stage={stage} index={index} />
      </g>

      <path d="M-24 29-24 37m43-4v7" stroke="#817889" strokeWidth="3" />
      <path d="M-24 37h8m30 3h8" stroke="#242333" strokeWidth="4" />

      <g transform="translate(-24 17)">
        <path d="M0 0 15 7v7L0 7Z" fill="#171622" stroke="#6E6579" strokeWidth="0.5" />
        <path d="M3 4 11 8" stroke={accent} strokeWidth="1" />
      </g>

      <g transform="translate(-23 54)">
        <path d="M0 0h47v13H0Z" fill="#10121E" stroke="#5B5267" strokeWidth="0.5" />
        <text
          x="23.5"
          y="8.5"
          textAnchor="middle"
          fill={selected ? "#C9FFB8" : "#CCB4D8"}
          fontSize="4.8"
          fontFamily="'JetBrains Mono', monospace"
          letterSpacing="0.5"
        >
          {String(index + 1).padStart(2, "0")} / {stages[stage]}
        </text>
      </g>

      {selected && (
        <motion.g
          initial={false}
          animate={{ opacity: active ? [0.35, 0.95, 0.35] : 0.6 }}
          transition={{
            duration: active ? 2.3 : 0,
            repeat: active ? Infinity : 0,
            ease: "easeInOut",
          }}
        >
          <path
            d="M-40-20v-10h10M40-20v-10H30M-40 23v10h10M40 23v10H30"
            fill="none"
            stroke="#9AFF85"
            strokeWidth="1"
          />
          <circle cx="0" cy="75" r="2" fill="#7CFF6B" />
        </motion.g>
      )}
    </g>
  );
}

export function DomeHabitatInterior(): JSX.Element {
  const { ref, active } = useSvgVisibility<SVGGElement>();
  const [selected, setSelected] = useState(0);
  const id = useId().replace(/:/g, "");

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = window.setInterval(() => {
      setSelected((current) => (current + 1) % 6);
    }, 4200);

    return () => {
      window.clearInterval(interval);
    };
  }, [active]);

  return (
    <g ref={ref} className="dome-habitat-interior">
      <defs>
        <linearGradient id={`${id}-deck`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#2D273E" />
          <stop offset="1" stopColor="#0A111C" />
        </linearGradient>
        <radialGradient id={`${id}-floor-light`}>
          <stop stopColor="#FF2E93" stopOpacity="0.16" />
          <stop offset="1" stopColor="#FF2E93" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="410" cy="422" rx="288" ry="66" fill={`url(#${id}-deck)`} />
      <ellipse cx="410" cy="410" rx="278" ry="57" fill={`url(#${id}-floor-light)`} />

      <g fill="none" stroke="#8C83B0" strokeOpacity="0.18" strokeWidth="0.7">
        <path d="M155 390c124 39 385 39 510 0M134 413c141 48 411 48 552 0M180 441c140 35 320 35 460 0" />
        <path d="M200 382 177 447M285 381 276 466M365 383v91M455 383v91M540 382l10 83M620 381l24 64" />
      </g>

      <path
        d="M135 388c133 39 415 39 550 0"
        fill="none"
        stroke="#151F2D"
        strokeWidth="8"
      />
      <path
        d="M135 388c133 39 415 39 550 0"
        fill="none"
        stroke="#5AA9AA"
        strokeOpacity="0.65"
        strokeWidth="1.8"
      />
      <path
        d="M140 395c134 39 407 39 540 0"
        fill="none"
        stroke="#7CFF6B"
        strokeOpacity="0.14"
        strokeWidth="1"
      />

      <g stroke="#8990B1" strokeWidth="1" fill="none">
        <path d="M155 228h507M155 232h507" strokeOpacity="0.45" />
        <path d="M174 222v13m78-13v13m80-13v13m78-13v13m79-13v13m80-13v13" strokeOpacity="0.45" />
      </g>

      {Array.from({ length: 6 }, (_, index) => (
        <HydroponicBed
          key={index}
          index={index}
          active={active}
          selected={selected === index}
        />
      ))}

      <motion.g
        animate={{
          x: active ? [190, 620, 190] : 350,
          y: active ? [219, 213, 219] : 219,
        }}
        transition={{
          x: { duration: active ? 25.2 : 0, repeat: active ? Infinity : 0, ease: "easeInOut" },
          y: { duration: active ? 4 : 0, repeat: active ? Infinity : 0, ease: "easeInOut" },
        }}
      >
        <path d="M-12-6H12L17 0 10 8H-10L-17 0Z" fill="#51455C" stroke="#B6ADC8" strokeWidth="0.8" />
        <path d="M-8-4H8v6H-8Z" fill="#131F2A" />
        <path d="M-5-2H5" stroke="#7CFF6B" strokeWidth="1.4" />
        <path d="M-22 0h8m28 0h8" stroke="#857E97" strokeWidth="1.5" />
        <circle cx="0" cy="6" r="3" fill="#FFBF6F" />
        <path
          d="M-2 10-30 73H30L2 10Z"
          fill="#7CFF6B"
          opacity="0.035"
        />
        <motion.path
          d="M-17-3h-9m43 0h9"
          stroke="#A4E6FF"
          strokeWidth="2"
          animate={{ opacity: active ? [0.25, 0.8, 0.25] : 0.4 }}
          transition={{ duration: active ? 1.8 : 0, repeat: active ? Infinity : 0 }}
        />
      </motion.g>

      <g transform="translate(326 175)">
        <path d="M0 0h168l8 8v31H-8V8Z" fill="#171927" stroke="#817193" strokeWidth="0.8" />
        <path d="M1 6h166" stroke="#FF91CE" strokeWidth="1" />
        <text
          x="84"
          y="18"
          textAnchor="middle"
          fill="#E0CBEA"
          fontSize="7"
          fontFamily="'JetBrains Mono', monospace"
          letterSpacing="1.1"
        > {t("АГРООТСЕК / ARES-1")}
        </text>
        {Array.from({ length: 6 }, (_, index) => (
          <rect
            key={index}
            x={48 + index * 13}
            y="26"
            width="8"
            height="3"
            fill={selected === index ? "#A1FF89" : "#554362"}
          />
        ))}
      </g>

      {Array.from({ length: 12 }, (_, index) => (
        <motion.circle
          key={index}
          cx={165 + ((index * 47) % 490)}
          cy={255 + ((index * 31) % 130)}
          r={index % 3 === 0 ? 1.1 : 0.6}
          fill={index % 2 ? "#CCFFA6" : "#C5E4FF"}
          initial={false}
          animate={
            active
              ? { y: [15, -20], opacity: [0, 0.6, 0] }
              : { y: 0, opacity: 0.2 }
          }
          transition={{
            duration: active ? 5 + index % 4 : 0,
            delay: active ? index * 0.3 : 0,
            repeat: active ? Infinity : 0,
            ease: "linear",
          }}
        />
      ))}
    </g>
  );
}

export function DomeHabitatHardware(): JSX.Element {
  const { ref, active } = useSvgVisibility<SVGGElement>();

  return (
    <g ref={ref} className="dome-habitat-hardware">
      <path
        d="M121 419c142 60 436 60 578 0"
        fill="none"
        stroke="#0A0C14"
        strokeWidth="7"
      />
      <path
        d="M123 419c140 59 434 59 574 0"
        fill="none"
        stroke="#BE9BC2"
        strokeWidth="1.3"
      />
      <path
        d="M124 431c142 59 430 59 572 0"
        fill="none"
        stroke="#6B93D6"
        strokeOpacity="0.65"
        strokeWidth="1"
      />

      <motion.path
        d="M127 440c143 57 423 57 566 0"
        fill="none"
        stroke="#FF63B5"
        strokeWidth="1.5"
        initial={false}
        animate={{ opacity: active ? [0.15, 0.55, 0.15] : 0.25 }}
        transition={{
          duration: active ? 5 : 0,
          repeat: active ? Infinity : 0,
          ease: "easeInOut",
        }}
      />

      <g fill="#2C2C3B" stroke="#A19BAF" strokeWidth="0.7">
        <path d="m164 251 9-2 3 11-9 2Z" />
        <path d="m647 249 9 2-3 11-9-2Z" />
        <path d="m121 355 9-1 1 12-9 1Z" />
        <path d="m690 354 9 1-1 12-9-1Z" />
        <path d="m405 250h10v12h-10Z" />
        <path d="m405 368h10v12h-10Z" />
      </g>

      <g stroke="#FFD4A2" strokeWidth="0.8">
        <path d="m168 254 3 5M650 254l-3 5M409 253v6M409 371v6" />
      </g>

      <path
        d="M406 130h8l5 8h-18Z"
        fill="#5C5268"
        stroke="#BEB3CD"
      />
      <path d="M410 130v-17" stroke="#94859F" strokeWidth="1.5" />
      <circle cx="410" cy="111" r="2" fill="#FFB347" />

      <path
        d="M245 458v15m45-4v14m230-14v14m46-25v15"
        stroke="#887B95"
        strokeWidth="2"
      />

      {[205, 550].map((x) => (
        <g key={x} transform={`translate(${x} 446)`}>
          <path
            d="M0 0 47 10v23L0 20Z"
            fill="#282231"
            stroke="#73667C"
            strokeWidth="0.7"
          />
          {Array.from({ length: 6 }, (_, index) => (
            <path
              key={index}
              d={`M${7 + index * 6} ${7 + index * 1.3}v10`}
              stroke="#090B11"
              strokeWidth="2"
            />
          ))}
          <path d="M5 20 17 23" stroke="#FFB347" strokeWidth="1.5" />
        </g>
      ))}

      <g transform="translate(341 426)">
        <path
          d="M0 7 12 0h113l12 7v79h-12V12H12v74H0Z"
          fill="#302B3A"
          stroke="#9E8AA8"
          strokeWidth="0.8"
        />
        <path d="M4 12v66m129-66v66" stroke="#6B93D6" strokeWidth="1.6" />
        <path d="M14 2h109" stroke="#FFC379" strokeWidth="1.6" />
        <g fill="#FFBA64" opacity="0.8">
          <path d="m1 77 4-4 4 4-4 4Z" />
          <path d="m128 77 4-4 4 4-4 4Z" />
        </g>
      </g>
    </g>
  );
}
