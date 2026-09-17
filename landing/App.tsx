import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Menu,
  X, Play} from "lucide-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useLandingWallet } from "./hooks/useLandingWallet";
import { useLiveChain } from "./hooks/useLiveChain";
import {
  TEST_SKR_MINT,
  buybackSkrAta,
  buyerPresalePda,
  decodeConfig,
  ixBuyFieldSkr,
  pdas,
  presaleStatePda,
  randomU64,
  treasurySkrAta,
  treasurySolPda,
} from "./utils/anchorClient";
import { LiquidPanelBorder } from "./LiquidPanel";
import type { LiquidPanelVariant } from "./LiquidPanel";
import { MorphButton } from "./MorphButton";
import { InterstellarSection } from "./InterstellarBridge";
import {
  DomeHabitatInterior,
  DomeHabitatHardware,
} from "./DomeHabitat";
import { LivingPhobos } from "./LivingPhobos";
import { RarityModules } from "./RarityModules";
import { TokenReactor } from "./TokenReactor";
import { GamificationHud } from "./GamificationHud";
import {
  elementXpOrigin,
  useGamification,
} from "./Gamification";
import type { XpOrigin } from "./Gamification";
import {
  AnimatedTextLink,
  MotionIcon,
  RollingNumber,
  ScrollRocket,
  SparkProgress,
} from "./MicroMotion";
import { SoundToggle } from "./SoundToggle";
import { t, useI18n, tr } from "./i18n";
import { LangSwitcher } from "./i18n/LangSwitcher";
import { useSounds } from "./useSounds";
import {
  assets,
  faq,
  features,
  gameConfig,

  presale,
  roadmap,
  siteContent,
  tokenCycle,
  chainConfig,
  playConfig,
} from "./content";
import type { FeatureIconName } from "./content";
import {
  useMousePosition,
  usePrefersReducedMotion,
  useTypewriter,
} from "./hooks";

const easeOut = [0.22, 1, 0.36, 1] as const;

type Notify = (message: string) => void;

interface ChildrenProps {
  readonly children: ReactNode;
}

interface RevealProps extends ChildrenProps {
  readonly className?: string;
  readonly delay?: number;
  readonly panel?: LiquidPanelVariant;
  readonly runningLight?: boolean;
}

interface SectionProps extends ChildrenProps {
  readonly id: string;
  readonly className?: string;
  readonly speed?: number;
}

interface SectionHeadingProps {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly text?: string;
}

interface ActionProps extends ChildrenProps {
  readonly href?: string;
  readonly target?: string;
  readonly rel?: string;
  readonly onClick?: () => void;
  readonly variant?: "primary" | "secondary";
  readonly type?: "button" | "submit";
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly success?: boolean;
  readonly className?: string;
}

// Click effects are owned by MorphButton.

const SC = tr(siteContent);
const TC = tr(tokenCycle);
const FEATURES = tr(features);
const ROADMAP = tr(roadmap);
const FAQ_ITEMS = tr(faq);
const PC = tr(playConfig);

function Mark({ className = "" }: { readonly className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      width="36"
      height="40"
      viewBox="0 0 36 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M18 2 34 11v18L18 38 2 29V11L18 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="m9 27 9-17 9 17M13 21h10"
        stroke="currentColor"
        strokeWidth="2.3"
      />
      <path d="M15 30h6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function FeatureIcon({ name }: { readonly name: FeatureIconName }): JSX.Element {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "sprout" && (
        <>
          <path d="M17 6h14M19 6v11L10 34a5 5 0 0 0 4 8h20a5 5 0 0 0 4-8l-9-17V6" />
          <path d="M15 31h18M24 32V21M24 26c-7 0-9-5-9-5s8-2 9 5ZM24 23c0-7 8-9 8-9s0 8-8 9Z" />
          <path d="M19 36h1m8 0h1" />
        </>
      )}
      {name === "sun-phobos" && (
        <>
          <circle cx="21" cy="22" r="10" />
          <path d="M21 4v4m0 28v4M3 22h4m28 0h4M8 9l3 3m20 20 3 3M8 35l3-3M31 12l3-3" />
          <path d="m34 29 7 3 2 7-6 5-7-3-1-7 5-5Z" />
          <path d="m35 35 3 2" />
        </>
      )}
      {name === "scales" && (
        <>
          <path d="M24 7v33M16 41h16M9 15h30M24 7l-3 4h6l-3-4ZM10 16 4 29h12l-6-13ZM38 16l-6 13h12l-6-13Z" />
          <path d="M4 29c1 7 11 7 12 0M32 29c1 7 11 7 12 0" />
        </>
      )}
      {name === "helmets" && (
        <>
          <path d="M4 26v-5a10 10 0 0 1 20 0v5M4 26v10h20V26M24 18a10 10 0 0 1 20 3v15H29" />
          <rect x="8" y="19" width="12" height="9" rx="4" />
          <path d="M29 19h7a4 4 0 0 1 0 9h-7M9 32h10m12 0h8M13 15h2m18 0h2" />
        </>
      )}
    </svg>
  );
}

function Reveal({
  children,
  className = "",
  delay = 0,
  panel,
  runningLight = true,
}: RevealProps): JSX.Element {
  const reduced = usePrefersReducedMotion();

  return (
    <motion.div
      className={className}
      data-liquid-panel={panel}
      initial={{ opacity: 0, y: reduced ? 0 : 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{
        duration: reduced ? 0.15 : 0.65,
        delay: reduced ? 0 : delay,
        ease: easeOut,
      }}
    >
      {panel && (
        <LiquidPanelBorder
          variant={panel}
          runningLight={runningLight}
        />
      )}
      {children}
    </motion.div>
  );
}

function Divider(): JSX.Element {
  const reduced = usePrefersReducedMotion();

  return (
    <svg
      className="section-divider"
      viewBox="0 0 1200 32"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <motion.path
        d="M0 16H440L458 4H530L549 28H650L670 16H1200"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        initial={{ pathLength: reduced ? 1 : 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: reduced ? 0 : 1.8, ease: "easeInOut" }}
      />
    </svg>
  );
}

function Section({
  id,
  children,
  className = "",
  speed = 0.6,
}: SectionProps): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const y = useTransform(
    scrollYProgress,
    [0, 1],
    reduced ? [0, 0] : [30 * speed, -30 * speed],
  );

  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={`${id}-title`}
      className={`section ${className}`}
    >
      <motion.div className="section-orbit" style={{ y }} aria-hidden="true" />
      <div className="container">{children}</div>
      <Divider />
    </section>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  text,
}: SectionHeadingProps): JSX.Element {
  const reduced = usePrefersReducedMotion();

  return (
    <div className="section-heading">
      <Reveal>
        <p className="eyebrow">
          <span className="status-dot" />
          {eyebrow}
        </p>
      </Reveal>

      <motion.h2
        id={id}
        initial={{
          opacity: 0,
          clipPath: reduced ? "none" : "inset(0 100% 0 0)",
        }}
        whileInView={{
          opacity: 1,
          clipPath: reduced ? "none" : "inset(0 0% 0 0)",
        }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: reduced ? 0.15 : 0.85, ease: easeOut }}
      >
        {title}
      </motion.h2>

      {text && (
        <Reveal delay={0.1}>
          <p className="section-description">{text}</p>
        </Reveal>
      )}
    </div>
  );
}

function Action({
  children,
  href,
  target,
  rel,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
  loading = false,
  success = false,
  className = "",
}: ActionProps): JSX.Element {
  const fullWidth = className.split(/\s+/).includes("form-submit");

  if (href) {
    return (
      <MorphButton
        href={href}
        target={target}
        rel={rel}
        variant={variant}
        disabled={disabled}
        loading={loading}
        success={success}
        magnetic={true}
        fullWidth={fullWidth}
        className={className}
        onClick={() => onClick?.()}
      >
        {children}
      </MorphButton>
    );
  }

  return (
    <MorphButton
      type={type}
      variant={variant}
      disabled={disabled}
      loading={loading}
      success={success}
        magnetic={true}
        fullWidth={fullWidth}
        className={className}
        onClick={() => onClick?.()}
    >
      {children}
    </MorphButton>
  );
}

function Ambient(): JSX.Element {
  const reduced = usePrefersReducedMotion();

  return (
    <div className="ambient" aria-hidden="true">
      {["rust", "blue", "grow"].map((color, index) => (
        <motion.div
          key={color}
          className={`mesh mesh--${color}`}
          animate={
            reduced
              ? { opacity: 0.35 }
              : {
                  x: ["-4%", "5%", "-4%"],
                  y: ["0%", "-7%", "0%"],
                  scale: [1, 1.12, 1],
                  opacity: [0.3, 0.5, 0.3],
                }
          }
          transition={{
            duration: reduced ? 0.15 : 20 + index * 3,
            repeat: reduced ? 0 : Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

function Overlays(): JSX.Element {
  const reduced = usePrefersReducedMotion();

  return (
    <>
      <div className="noise" aria-hidden="true" />
      {!reduced && (
        <motion.div
          className="scan-line"
          aria-hidden="true"
          initial={{ y: "-20vh" }}
          animate={{ y: "100vh" }}
          transition={{ duration: 8, ease: "linear", repeat: Infinity }}
        />
      )}
    </>
  );
}

function Cursor(): JSX.Element | null {
  const mouse = useMousePosition();
  const trailX = useSpring(mouse.x, { stiffness: 140, damping: 22 });
  const trailY = useSpring(mouse.y, { stiffness: 140, damping: 22 });

  if (!mouse.isActive) {
    return null;
  }

  return (
    <>
      <motion.div
        className="cursor-dot"
        data-cursor-decoration
        aria-hidden="true"
        style={{ x: mouse.x, y: mouse.y }}
      />
      <motion.div
        className="cursor-trail"
        data-cursor-decoration
        aria-hidden="true"
        style={{ x: trailX, y: trailY }}
      />
    </>
  );
}


function WalletButton(): JSX.Element {
  const { connected, publicKey, balanceSkr, connect, disconnect, connecting } = useLandingWallet();
  useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  if (connecting) {
    return (
      <button className="morph-button morph-button--header" disabled>
        <span className="wallet-full">{t("Подключение…")}</span>
        <span className="wallet-short">⬡ …</span>
      </button>
    );
  }

  if (!connected || !publicKey) {
    return (
      <button onClick={() => { void connect(); }} className="morph-button morph-button--header">
        <span className="wallet-full">{t("Подключить кошелёк")}</span>
        <span className="wallet-short">⬡ {t("Кошелёк")}</span>
      </button>
    );
  }

  const addr = publicKey.toBase58();
  const short = addr.slice(0, 4) + "…" + addr.slice(-4);
  const balance = (Number(balanceSkr) / 1e6).toFixed(2);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="morph-button morph-button--header"
      >
        <span className="wallet-full">{short} · {balance} SKR</span>
        <span className="wallet-short">{short}</span>
      </button>
      {menuOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            background: "rgba(18,18,26,0.97)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "12px 14px",
            minWidth: 200,
            zIndex: 1200,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 10, wordBreak: "break-all" }}>{addr}</div>
          <button
            onClick={() => { void disconnect(); setMenuOpen(false); }}
            style={{
              width: "100%",
              padding: "8px 12px",
              background: "rgba(255,255,255,0.08)",
              border: "none",
              borderRadius: 6,
              color: "inherit",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t("Отключить")}
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ notify }: { readonly notify: Notify }): JSX.Element {
  const [scrolled, setScrolled] = useState(false);
  useI18n();
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion() ?? false;
  void notify;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`header ${scrolled || open ? "header--scrolled" : ""}`}>
      <div className="container header-inner">
        <a href="#hero" className="brand" aria-label={SC.header.homeLabel}>
          <Mark />
          <span className="brand-text">ARES-1</span>
        </a>

        <nav
          className="desktop-nav"
          aria-label={SC.header.navigationLabel}
        >
          {SC.header.navigation.map((link) => (
            <AnimatedTextLink key={link.href} href={link.href}>
              {link.label}
              <MotionIcon>
                <ArrowUpRight size={16} aria-hidden="true" />
              </MotionIcon>
            </AnimatedTextLink>
          ))}
        </nav>

        <div className="header-actions">
          <a
            className="header-play"
            href={PC.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={PC.label}
          >
            <Play size={14} aria-hidden="true" />
            <span className="header-play-full">{PC.labelShort}</span>
          </a>
          <LangSwitcher />
          <SoundToggle />
          <span className="network-label">
            <span className="status-dot" />
            DEVNET
          </span>
          <WalletButton />
          <button
            className="menu-toggle"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? SC.header.closeMenu : SC.header.openMenu}
            aria-controls={open ? "mobile-navigation" : undefined}
          >
            {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.nav
            key="mobile-navigation"
            id="mobile-navigation"
            className="mobile-nav"
            aria-label={SC.header.navigationLabel}
            initial={{ height: reduced ? "auto" : 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: reduced ? "auto" : 0, opacity: 0 }}
            transition={{ duration: reduced ? 0.15 : 0.25 }}
          >
            <div className="container mobile-nav-inner">
              {SC.header.navigation.map((link) => (
                <AnimatedTextLink
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                  <MotionIcon>
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </MotionIcon>
                </AnimatedTextLink>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}


function MarsScene({
  target,
}: {
  readonly target: React.RefObject<HTMLElement>;
}): JSX.Element {
  useI18n();
  const reduced = usePrefersReducedMotion();
  const id = useId().replace(/:/g, "");
  const { scrollYProgress } = useScroll({
    target,
    offset: ["start start", "end start"],
  });

  const starsY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 35]);
  const phobosY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 70]);
  const farY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 140]);
  const midY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 210]);
  const domeY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 280]);
  const dustY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 420]);

  return (
    <div className="mars-scene" aria-hidden="true">
      <div className="mars-sky" />

      <motion.div className="star-field" style={{ y: starsY }}>
        {Array.from({ length: 46 }, (_, index) => (
          <i
            key={index}
            style={{
              left: `${(index * 37 + 13) % 100}%`,
              top: `${(index * 19 + 7) % 73}%`,
              opacity: 0.2 + (index % 5) * 0.13,
              width: index % 7 === 0 ? 3 : 1,
              height: index % 7 === 0 ? 3 : 1,
            }}
          />
        ))}
      </motion.div>

      <motion.div className="phobos-orbit" style={{ y: phobosY }}>
        <LivingPhobos />
      </motion.div>

      <motion.svg
        className="terrain terrain--far"
        viewBox="0 0 1600 600"
        preserveAspectRatio="none"
        style={{ y: farY }}
      >
        <defs>
          <linearGradient id={`${id}-far`} x2="0" y2="1">
            <stop stopColor="#704657" />
            <stop offset="1" stopColor="#1e121c" />
          </linearGradient>
        </defs>
        <path
          d="M0 270 100 250 190 290 320 155 430 182 570 100 690 144 780 80 900 140 1020 120 1190 260 1340 210 1460 260 1600 225V600H0Z"
          fill={`url(#${id}-far)`}
        />
        <path
          d="m320 155 110 27 140-82 120 44 90-64 120 60 120-20"
          fill="none"
          stroke="#a6818b"
          strokeOpacity=".4"
        />
      </motion.svg>

      <motion.svg
        className="terrain terrain--mid"
        viewBox="0 0 1600 600"
        preserveAspectRatio="none"
        style={{ y: midY }}
      >
        <defs>
          <linearGradient id={`${id}-mid`} x2=".2" y2="1">
            <stop stopColor="#9c492f" />
            <stop offset="1" stopColor="#291018" />
          </linearGradient>
        </defs>
        <path
          d="M0 240 180 280 270 245 440 310 600 275 810 340 990 295 1150 270 1310 190 1490 210 1600 170V600H0Z"
          fill={`url(#${id}-mid)`}
        />
        <g fill="none" stroke="#d78355" strokeOpacity=".18">
          <path d="m0 280 210 46 180-13 230 70 440-37 250-90 290-7" />
          <path d="m0 355 190 24 260-9 295 62 340-16 250-90 265-15" />
          <path d="m0 425 265 18 225-4 240 40 370-17 300-63 200 5" />
        </g>
      </motion.svg>

      <motion.div className="dome-layer" style={{ y: domeY }}>
        <svg viewBox="0 0 820 620" className="dome-art">
          <defs>
            <linearGradient id={`${id}-glass`} x1="0" y1="0" x2=".8" y2="1">
              <stop stopColor="#B5D9F5" stopOpacity=".13" />
              <stop offset=".4" stopColor="#6B93D6" stopOpacity=".025" />
              <stop offset="1" stopColor="#FF2E93" stopOpacity=".075" />
            </linearGradient>
            <radialGradient id={`${id}-grow`}>
              <stop stopColor="#ff2e93" stopOpacity=".65" />
              <stop offset="1" stopColor="#ff2e93" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-base`} x2="0" y2="1">
              <stop stopColor="#77707d" />
              <stop offset=".25" stopColor="#2a2531" />
              <stop offset="1" stopColor="#100b15" />
            </linearGradient>
            <clipPath id={`${id}-inside`}>
              <path d="M120 420a290 290 0 0 1 580 0c-142 60-438 60-580 0Z" />
            </clipPath>
          </defs>

          <ellipse cx="410" cy="490" rx="360" ry="66" fill="#08060c" opacity=".55" />
          <ellipse
            cx="410"
            cy="410"
            rx="350"
            ry="160"
            fill={`url(#${id}-grow)`}
          />

          <path
            d="M116 420v33c142 70 446 70 588 0v-33"
            fill={`url(#${id}-base)`}
            stroke="#938295"
            strokeOpacity=".4"
          />
          <ellipse cx="410" cy="420" rx="294" ry="67" fill="#170e21" />

          <g clipPath={`url(#${id}-inside)`}>
            <DomeHabitatInterior />
            <motion.ellipse
              cx="400"
              cy="272"
              rx="290"
              ry="250"
              fill={`url(#${id}-glass)`}
              animate={
                reduced ? { opacity: 0.35 } : { opacity: [0.22, 0.4, 0.22] }
              }
              transition={{
                duration: reduced ? 0.15 : 6,
                repeat: reduced ? 0 : Infinity,
                ease: "easeInOut",
              }}
            />
          </g>

          <path
            d="M120 420a290 290 0 0 1 580 0c-142 60-438 60-580 0Z"
            fill={`url(#${id}-glass)`}
            stroke="#b8c8e5"
            strokeWidth="2"
            strokeOpacity=".8"
          />
          <g fill="none" stroke="#afbeda" strokeOpacity=".5">
            <path d="M410 130v338M410 130c-161 92-200 203-167 328M410 130c161 92 200 203 167 328" />
            <path d="M410 130c-78 126-94 236-72 337M410 130c78 126 94 236 72 337" />
            <path d="M169 257c132 47 350 47 482 0M126 360c145 63 423 63 568 0" />
            <path d="M231 194c101 33 257 33 358 0" />
          </g>
          <path
            d="M180 293c27-59 68-103 120-130"
            stroke="#e4f2ff"
            strokeOpacity=".58"
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
          />

          <DomeHabitatHardware />

          <g transform="translate(353 428)">
            <path d="M0 0h113v78H0Z" fill="#332832" stroke="#a08c90" />
            <path d="M13 13h87v66H13Z" fill="#0b0911" stroke="#6f6878" />
            <path d="M23 23h67v54H23Z" fill="#352139" />
            <path d="M23 23h67" stroke="#7cff6b" strokeWidth="3" />
            <path d="M56 25v50" stroke="#ae819b" />
            <circle cx="80" cy="44" r="3" fill="#7cff6b" />
            <path d="M-10 79h133l22 13H-31Z" fill="#53414b" />
          </g>

          <g fill="#ffb347">
            <circle cx="171" cy="449" r="3" />
            <circle cx="227" cy="465" r="3" />
            <circle cx="596" cy="465" r="3" />
            <circle cx="651" cy="449" r="3" />
          </g>
          <path d="M665 371v-112m-12 15h25" stroke="#8f8496" strokeWidth="3" />
          <circle cx="665" cy="259" r="4" fill="#7cff6b" />
        </svg>

        <div className="dome-callout">
          <span className="status-dot" />
          {t("КУПОЛ ARES-1")}
          <small>{t("6 КАССЕТ · ВИЗУАЛИЗАЦИЯ МОДУЛЯ")}</small>
        </div>
      </motion.div>

      <motion.div className="dust-layer" style={{ y: dustY }}>
        <svg viewBox="0 0 1600 280" preserveAspectRatio="none">
          <path
            d="M0 80 220 120 450 105 650 160 950 175 1200 118 1430 130 1600 65V280H0Z"
            fill="#1b0d14"
          />
          <path
            d="m0 82 220 41 230-16 200 55 300 16 250-57 230 12 170-66"
            stroke="#b16443"
            strokeOpacity=".3"
            fill="none"
          />
        </svg>
        {Array.from({ length: 14 }, (_, index) => (
          <motion.i
            key={index}
            className="dust-particle"
            style={{
              left: `${(index * 17 + 3) % 100}%`,
              top: `${(index * 29) % 80}%`,
            }}
            animate={
              reduced
                ? { opacity: 0.2 }
                : {
                    x: [0, 30 + index * 3],
                    y: [0, -15 - index],
                    opacity: [0, 0.5, 0],
                  }
            }
            transition={{
              duration: reduced ? 0.15 : 6 + (index % 4),
              delay: reduced ? 0 : index * 0.25,
              repeat: reduced ? 0 : Infinity,
              ease: "linear",
            }}
          />
        ))}
      </motion.div>
      <div className="scene-vignette" />
    </div>
  );
}

function FlipValue({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}): JSX.Element {
  const reduced = usePrefersReducedMotion();

  return (
    <div className="flip-unit">
      <div className="flip-window">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ rotateX: reduced ? 0 : -85, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={{ rotateX: reduced ? 0 : 85, opacity: 0 }}
            transition={{ duration: reduced ? 0.15 : 0.3 }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </div>
      <small>{label}</small>
    </div>
  );
}

function Countdown(): JSX.Element {
  const configuredEnd: string | null = presale.endsAt;
  useI18n();
  const end = configuredEnd === null ? NaN : Date.parse(configuredEnd);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!Number.isFinite(end)) {
      return;
    }

    const timer = window.setInterval(() => {
      if (!document.hidden) {
        setNow(Date.now());
      }
    }, 1000);

    function refresh(): void {
      if (!document.hidden) {
        setNow(Date.now());
      }
    }

    refresh();
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [end]);

  if (!Number.isFinite(end)) {
    return (
      <p className="countdown-note">
        <span className="status-dot status-dot--amber" />
        {SC.hero.countdownUnavailable}
      </p>
    );
  }

  const seconds = Math.max(0, Math.floor((end - now) / 1000));
  const units = [
    { value: Math.floor(seconds / 86400), label: t("дни") },
    { value: Math.floor((seconds % 86400) / 3600), label: t("часы") },
    { value: Math.floor((seconds % 3600) / 60), label: t("минуты") },
    { value: seconds % 60, label: t("секунды") },
  ];

  return (
    <div className="countdown">
      <p>
        {seconds === 0
          ? SC.hero.countdownEnded
          : SC.hero.countdownLabel}
      </p>
      <div className="flip-timer" role="timer" aria-live="off">
        {units.map((unit) => (
          <FlipValue
            key={unit.label}
            value={String(unit.value).padStart(2, "0")}
            label={unit.label}
          />
        ))}
      </div>
    </div>
  );
}

function Hero(): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  useI18n();
  const title = useTypewriter({ text: SC.hero.title });
  const live = useLiveChain();
  const sold = live.online ? live.sold : 0;

  return (
    <section ref={ref} id="hero" className="hero" aria-labelledby="hero-title">
      <MarsScene target={ref} />

      <div className="container hero-inner">
        <div className="hero-content">
          <Reveal>
            <div className="hero-badge">
              <span className="status-dot" />
              {t("ПЕРВАЯ КАРТОФЕЛЬНАЯ КОЛОНИЯ")}
              <span className="badge-code">2031</span>
            </div>
          </Reveal>

          <h1 id="hero-title" className="hero-title">
            <span className="sr-only">{SC.hero.title}</span>
            <span className="typewriter-reserve" aria-hidden="true">
              {SC.hero.title}
            </span>
            <span className="typewriter-visible" aria-hidden="true">
              {title.displayedText}
              {!title.isComplete && <span className="type-caret" />}
            </span>
          </h1>

          <Reveal delay={0.15}>
            <p className="hero-description">{SC.hero.subtitle}</p>
          </Reveal>

          <Reveal className="hero-actions" delay={0.25}>
            <a
              className="cta-play"
              href={PC.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Play size={18} aria-hidden="true" />
              {PC.label}
            </a>
            <Action href={SC.hero.primaryHref}>
              {SC.hero.primaryCta}
            </Action>
            <Action
              variant="secondary"
              href={SC.hero.secondaryHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {SC.hero.secondaryCta}
              <ArrowUpRight size={16} aria-hidden="true" />
            </Action>
          </Reveal>

          <Reveal className="presale-panel" delay={0.35} panel="accent">
            <div className="presale-top">
              <span>{t("ПЕРВАЯ ВОЛНА · LIVE")}</span>
              <span>
                <strong>
                  <RollingNumber value={sold} />
                </strong>
                {" / "}
                <RollingNumber value={live.online ? live.cap : presale.supply} />
              </span>
            </div>

            <SparkProgress
              value={sold}
              max={live.online ? live.cap : presale.supply}
              label={SC.hero.progressLabel}
              valueText={
                live.online
                  ? t("{n} модулей продано", { n: `${sold} / ${live.online ? live.cap : presale.supply}` })
                  : t("подключение к devnet…")
              }
              color="#FF2E93"
            />

            <div className="presale-bottom">
              <span>
                {live.online ? t("данные с devnet-цепи") : t("ожидание ответа RPC")}
              </span>
              <strong>{t("0.25 SOL · 1 053 SKR / модуль")}</strong>
            </div>
            <Countdown />
          </Reveal>

          <p className="hero-habitat-note">
            {t("Внутри купола — шесть гидропонных кассет: ростки, листва и клубни. Дрон показывает цикл осмотра.")}
            {t("Сцена иллюстративная, не телеметрия твоей фермы.")}
          </p>
        </div>

        <div className="hero-side-label" aria-hidden="true">
          {t("ДОЛИНА МАРИНЕРА")}
          <span>{t("14° Ю. Ш. · МАРС")}</span>
        </div>

        <div className="hero-bottom">
          <p>
            <span className="status-dot" />
            SOLANA DEVNET
          </p>
          <span>{t("ИСХОДНИКИ ОТКРЫТЫ · ПРОГРАММА ОБНОВЛЯЕТСЯ")}</span>
          <a href="#problem" aria-label={t("Узнать о колонии")}>
            <ChevronDown size={18} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
function Problem(): JSX.Element {
  useI18n();
  return (
    <Section id="problem" className="problem-section" speed={0.3}>
      <SectionHeading
        id="problem-title"
        eyebrow={t("01 / ДРУГИЕ ПРАВИЛА")}
        title={SC.problem.title}
      />

      <div className="problem-grid">
        <Reveal
          className="panel comparison comparison--before"
          panel="danger"
          runningLight={false}
        >
          <div className="panel-topline">
            <span className="panel-label">{SC.problem.before.title}</span>
            <span className="small-code">{t("ЗЕМЛЯ / ОФЧЕЙН")}</span>
          </div>
          <ul>
            {SC.problem.before.items.map((item) => (
              <li key={item}>
                <X size={19} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal
          className="panel comparison comparison--after"
          delay={0.12}
          panel="accent"
        >
          <div className="panel-topline">
            <span className="panel-label">{SC.problem.after.title}</span>
            <Mark className="mini-mark" />
          </div>
          <ul>
            {SC.problem.after.items.map((item) => (
              <li key={item}>
                <Check size={19} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>

      <Reveal>
        <p className="section-footnote">
          {t("Сейчас колония работает в devnet. Открытый код позволяет изучить правила,")}
          {t("но не исключает обновлений программы и рисков тестовой сети.")}
        </p>
      </Reveal>
    </Section>
  );
}

interface TiltCardProps extends ChildrenProps {
  readonly xpKey: string;
}

function TiltCard({ children, xpKey }: TiltCardProps): JSX.Element {
  const { award } = useGamification();
  const reduced = usePrefersReducedMotion();
  const rotateX = useSpring(0, { stiffness: 180, damping: 24 });
  const rotateY = useSpring(0, { stiffness: 180, damping: 24 });

  function handleMove(event: ReactMouseEvent<HTMLElement>): void {
    if (reduced || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    rotateX.set(-((event.clientY - rect.top) / rect.height - 0.5) * 12);
    rotateY.set(((event.clientX - rect.left) / rect.width - 0.5) * 12);
  }

  function reset(): void {
    rotateX.set(0);
    rotateY.set(0);
  }

  useEffect(() => {
    if (reduced) {
      rotateX.jump(0);
      rotateY.jump(0);
    }
  }, [reduced, rotateX, rotateY]);

  return (
    <motion.article
      className="panel feature-card ares-equipment-card"
      data-liquid-panel="accent"
      tabIndex={0}
      style={{ rotateX, rotateY, transformPerspective: 1000 }}
      onMouseEnter={(event) => {
        award(
          { kind: "feature", id: xpKey },
          elementXpOrigin(event.currentTarget),
        );
      }}
      onFocus={(event) => {
        award(
          { kind: "feature", id: xpKey },
          elementXpOrigin(event.currentTarget),
        );
      }}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      whileHover={reduced ? undefined : { scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      <LiquidPanelBorder variant="accent" runningLight={true} />
      {children}
    </motion.article>
  );
}
function Mechanics(): JSX.Element {
  useI18n();
  return (
    <Section id="mechanics" speed={0.8}>
      <SectionHeading
        id="mechanics-title"
        eyebrow={t("02 / ЖИЗНЬ ПОД КУПОЛОМ")}
        title={SC.mechanics.title}
        text={t("Один модуль. Свой ритм. Целая колония возможностей.")}
      />

      <div className="feature-grid">
        {FEATURES.map((feature, index) => (
          <Reveal key={feature.id} delay={index * 0.08}>
            <TiltCard xpKey={feature.id}>
              <div className="feature-top">
                <div className="feature-icon">
                  <FeatureIcon name={feature.icon} />
                </div>
                <span className="feature-number">0{index + 1}</span>
              </div>
              <p className="eyebrow feature-label">{feature.label}</p>
              <h3>{feature.title}</h3>
              <p className="feature-description">{feature.description}</p>
              <span className="card-corner" aria-hidden="true">⌑</span>
            </TiltCard>
          </Reveal>
        ))}
      </div>

      <Reveal className="colony-manual">
        <div>
          <span className="small-code">{t("СИСТЕМНОЕ ВРЕМЯ")}</span>
          <p>{t("05–08 рассвет · 08–17 день · 17–20 синий закат · 20–05 ночь")}</p>
        </div>
        <div>
          <span className="small-code">{t("ОБСЛУЖИВАНИЕ МОДУЛЯ")}</span>
          <p>{t("Ремонт · удобрения ×1,5 на 24 ч · налог раз в 7 дней · уровни")}</p>
        </div>
        <div>
          <span className="small-code">{t("БИРЖА И ДОСТИЖЕНИЯ")}</span>
          <p>{t("Ордер от 10 POTATO и 1 SKR · 6 ончейн-квестов без бэкенда")}</p>
        </div>
      </Reveal>

      <Reveal className="tier-panel panel" panel="accent">
        <div className="tier-intro">
          <p className="eyebrow">{t("ЛОТЕРЕЯ МОДУЛЕЙ")}</p>
          <h3>{t("ОДНА ЦЕНА.")}<br />{t("ТРИ ХАРАКТЕРА.")}</h3>
          <p>{t("1 053 SKR за модуль. Тир определяется случайно.")}</p>
        </div>
        <RarityModules />
        <p className="tier-disclaimer">
          {t("Проценты урожая — игровые характеристики, не финансовая доходность.")}
        </p>
      </Reveal>
    </Section>
  );
}

function TuberArt(): JSX.Element {
  const id = useId().replace(/:/g, "");

  return (
    <svg
      viewBox="0 0 420 460"
      width="420"
      height="460"
      className="tuber-art"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-suit`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#ffbd62" />
          <stop offset=".45" stopColor="#f47c23" />
          <stop offset="1" stopColor="#b63e16" />
        </linearGradient>
        <radialGradient id={`${id}-visor`} cx="35%" cy="20%">
          <stop stopColor="#434367" />
          <stop offset="1" stopColor="#0b0d20" />
        </radialGradient>
        <linearGradient id={`${id}-potato`} x2=".8" y2="1">
          <stop stopColor="#efc689" />
          <stop offset="1" stopColor="#bb7e49" />
        </linearGradient>
      </defs>

      <rect x="102" y="193" width="215" height="152" rx="40" fill="#57343a" stroke="#ab6953" strokeWidth="7" />
      <path d="M139 326 127 400c-2 27 58 31 61 6l18-70M222 336l16 67c7 30 65 18 57-7l-22-74" fill={`url(#${id}-suit)`} stroke="#6c352b" strokeWidth="5" />
      <path d="M123 393c-30 25-9 41 38 33l28-9-4-27M236 395l4 23c24 15 77 13 69-9l-17-21" fill="#292b38" stroke="#6f6671" strokeWidth="5" />
      <path d="M128 226c-27-4-43 17-57 45l-24 29c-15 21 15 45 35 27l31-32 29-37M290 226c21-5 35-28 42-48l7-22c8-24 43-12 38 12l-9 37c-11 42-35 71-65 74" fill={`url(#${id}-suit)`} stroke="#6c352b" strokeWidth="5" />
      <path d="m46 292-9 13c-17 25 12 46 34 27l13-12M337 162l-1-18c0-20 29-28 40-10l8 15c10 18-1 32-12 35" fill="#30323f" stroke="#74707b" strokeWidth="5" />

      <path d="M128 211c-12 24-20 86-2 122 17 35 136 40 166 0 18-25 8-99-8-122Z" fill={`url(#${id}-suit)`} stroke="#6c352b" strokeWidth="6" />
      <path d="M160 233v105m100-105v105" stroke="#ffc686" strokeWidth="8" />
      <path d="M126 302h170" stroke="#4b3a44" strokeWidth="15" />
      <rect x="174" y="250" width="72" height="69" rx="10" fill="#333341" stroke="#d2b3a0" strokeWidth="4" />
      <rect x="186" y="262" width="47" height="18" rx="3" fill="#102522" />
      <path d="M190 272h7l4-5 7 9 5-6h16" fill="none" stroke="#7cff6b" strokeWidth="2" />
      <circle cx="190" cy="297" r="5" fill="#7cff6b" />
      <circle cx="209" cy="297" r="5" fill="#ffb347" />
      <circle cx="229" cy="297" r="5" fill="#ff2e93" />

      <circle cx="207" cy="158" r="108" fill="#e1d8d4" stroke="#71636d" strokeWidth="7" />
      <circle cx="207" cy="158" r="92" fill={`url(#${id}-visor)`} stroke="#2d2b3e" strokeWidth="7" />
      <path d="M159 169c-14-63 30-94 63-75 24 12 44 43 43 76-1 43-91 54-106-1Z" fill={`url(#${id}-potato)`} />
      <g fill="#a66b42" opacity=".6">
        <ellipse cx="180" cy="123" rx="4" ry="3" />
        <ellipse cx="244" cy="170" rx="4" ry="5" />
        <ellipse cx="183" cy="182" rx="3" ry="4" />
        <ellipse cx="219" cy="110" rx="3" ry="2" />
      </g>
      <ellipse cx="190" cy="150" rx="7" ry="10" fill="#241728" />
      <ellipse cx="229" cy="150" rx="7" ry="10" fill="#241728" />
      <circle cx="192" cy="147" r="2" fill="white" />
      <circle cx="231" cy="147" r="2" fill="white" />
      <path d="M195 177q15 17 30-2" fill="none" stroke="#6a3536" strokeWidth="4" strokeLinecap="round" />
      <path d="M151 117c13-26 32-36 54-37" stroke="white" strokeOpacity=".5" strokeWidth="9" strokeLinecap="round" fill="none" />

      <rect x="94" y="137" width="21" height="46" rx="8" fill="#827b87" />
      <rect x="300" y="137" width="21" height="46" rx="8" fill="#827b87" />
      <path d="M310 135V75" stroke="#bab0bc" strokeWidth="5" />
      <circle cx="310" cy="70" r="7" fill="#7cff6b" />
      <path d="m133 252 12-20 12 20m-18-7h12" fill="none" stroke="#51232a" strokeWidth="3" />
    </svg>
  );
}

function Mascot(): JSX.Element {
  const { award } = useGamification();
  useI18n();
  const { play } = useSounds();
  const reduced = usePrefersReducedMotion();
  const controls = useAnimationControls();
  const [jumps, setJumps] = useState(0);
  const [jumping, setJumping] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      controls.stop();
    };
  }, [controls]);

  useEffect(() => {
    if (reduced) {
      controls.stop();
      controls.set({ y: 0, scaleX: 1, scaleY: 1, rotate: 0 });
      busy.current = false;
      setJumping(false);
    }
  }, [reduced, controls]);

  async function jump(origin: XpOrigin): Promise<void> {
    if (busy.current) {
      return;
    }

    award({ kind: "mascot" }, origin);
    play("mascot.jump", 0.45);
    setJumps((current) => current + 1);

    if (reduced) {
      return;
    }

    busy.current = true;
    setJumping(true);

    try {
      await controls.start({
        y: [0, 10, -75, -90, 0],
        scaleY: [1, 0.7, 1.2, 1.05, 1],
        scaleX: [1, 1.15, 0.9, 0.98, 1],
        rotate: [0, -3, 3, -2, 0],
        transition: {
          duration: 0.5,
          times: [0, 0.18, 0.45, 0.66, 1],
          ease: [0.33, 0, 0.67, 1],
        },
      });
    } finally {
      busy.current = false;

      if (mounted.current) {
        setJumping(false);
      }
    }
  }

  return (
    <Section id="mascot" className="mascot-section" speed={1.2}>
      <div className="mascot-grid">
        <Reveal className="mascot-visual">
          <div className="mascot-orbit mascot-orbit--one" aria-hidden="true" />
          <div className="mascot-orbit mascot-orbit--two" aria-hidden="true" />
          <span className="mascot-coordinate" aria-hidden="true">{t("МОДУЛЬ №7")}</span>
          <div className="mascot-shadow" aria-hidden="true" />

          <button
            type="button"
            className="mascot-button"
            onClick={(event) => {
              void jump(elementXpOrigin(event.currentTarget));
            }}
            aria-label={SC.mascot.buttonLabel}
          >
            <motion.span
              className="mascot-body"
              animate={controls}
              style={{ transformOrigin: "50% 90%" }}
            >
              {imageFailed ? (
                <TuberArt />
              ) : (
                <img
                  src={jumping ? assets.tuberJump : assets.tuberIdle}
                  alt=""
                  width={420}
                  height={460}
                  loading="lazy"
                  decoding="async"
                  onError={() => setImageFailed(true)}
                />
              )}
            </motion.span>
          </button>

          <div className="mascot-counter" aria-live="polite" aria-atomic="true">
            <span>{SC.mascot.counterLabel}</span>
            <strong>
              <RollingNumber value={jumps} minimumDigits={3} />
            </strong>
          </div>
        </Reveal>

        <div className="mascot-copy">
          <SectionHeading
            id="mascot-title"
            eyebrow={t("03 / ЭКИПАЖ ARES-1")}
            title={SC.mascot.title}
          />
          <Reveal>
            <p className="body-copy">{SC.mascot.text}</p>
            <div className="mascot-quote">
              <span aria-hidden="true">“</span>
              <p>{t("Гравитация ниже.")}<br />{t("Планы — выше.")}</p>
              <small>{t("ТЮБЕР-9 · ГЛАВНЫЙ АГРОНОМ")}</small>
            </div>
            <div className="quest-chips">
              {gameConfig.quests.featured.map((quest) => (
                <span key={quest.title}>
                  <Check size={14} aria-hidden="true" />
                  {t(quest.title)}
                  <b>+{quest.rewardPotato} $POTATO</b>
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

function Tokenomics(): JSX.Element {
  const [supply, setSupply] = useState<number | null>(null);
  useI18n();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!chainConfig.potatoMint) return;
      try {
        const res = await fetch(chainConfig.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [chainConfig.potatoMint, { encoding: "jsonParsed" }],
          }),
        });
        const json = await res.json();
        const raw = json?.result?.value?.data?.parsed?.info?.supply;
        if (alive && typeof raw === "string") setSupply(Number(raw) / 1e6);
      } catch {
        /* лендинг работает без цепи */
      }
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const supplyPct = supply === null ? null : (supply / chainConfig.maxSupply) * 100;

  return (
    <Section id="tokenomics" speed={0.5}>
      <SectionHeading
        id="tokenomics-title"
        eyebrow={t("04 / ТОПЛИВО КОЛОНИИ")}
        title={TC.manifesto}
        text={TC.manifestoSub}
      />

      <div className="tokenomics-grid">
        <Reveal className="token-visual">
          <TokenReactor />
          {chainConfig.potatoMint && (
            <div className="token-live">
              {supply === null ? (
                <span className="small-code">{t("ПОДКЛЮЧЕНИЕ К ЦЕПИ…")}</span>
              ) : (
                <>
                  <span className="token-live-value">
                    <RollingNumber value={Math.round(supply)} /> POTATO
                  </span>
                  <span className="small-code">
                    {t("В ОБРАЩЕНИИ · {pct}% ПОТОЛКА", { pct: (supplyPct ?? 0).toFixed(2) })}
                  </span>
                </>
              )}
            </div>
          )}
        </Reveal>

        <Reveal className="cycle-panel panel" panel="default">
          <div className="panel-topline">
            <span className="panel-label">{t("ЦИКЛ ТОКЕНА")}</span>
            <span className="small-code">MINT → FLOW → BURN</span>
          </div>
          <div className="cycle-columns">
            {[TC.birth, TC.flow, TC.death].map((col) => (
              <div key={col.title} className="cycle-column">
                <div className="cycle-column-title">{col.title}</div>
                <ul>
                  {col.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      <Reveal className="deflation-panel">
        <div className="burn-symbol" aria-hidden="true">60<span>%</span></div>
        <div>
          <p className="eyebrow">{t("КОМИССИИ СЖИГАЕТСЯ")}</p>
          <p>{SC.tokenomics.deflation}</p>
        </div>
        <span className="burn-tag">{t("МЕНЬШЕ ТОКЕНОВ")}<br />{t("НЕ ОБЕЩАНИЕ РОСТА ЦЕНЫ")}</span>
      </Reveal>

      <Reveal className="interstellar-reserve-note">
        <p>{TC.teamNote}</p>
        <p>{TC.treasuryNote}</p>
        <p>{TC.capNote}</p>
      </Reveal>
    </Section>
  );
}

function Roadmap(): JSX.Element {
  const reduced = usePrefersReducedMotion();
  useI18n();

  return (
    <Section id="roadmap" speed={0.9}>
      <SectionHeading
        id="roadmap-title"
        eyebrow={t("05 / ПЛАН ЭКСПЕДИЦИИ")}
        title={SC.roadmap.title}
        text={t("От первого ростка до собственной марсианской экономики.")}
      />

      <ol className="roadmap">
        {ROADMAP.map((milestone, index) => (
          <li key={milestone.period} className={milestone.done ? "roadmap-done" : ""}>
            <Reveal delay={index * 0.08}>
              <div className="roadmap-marker">
                <motion.span
                  className="roadmap-glow"
                  aria-hidden="true"
                  initial={{ opacity: 0.15 }}
                  whileInView={
                    reduced
                      ? { opacity: 0.4 }
                      : { opacity: [0.2, 0.8, 0.2], scale: [1, 1.3, 1] }
                  }
                  viewport={{ amount: 0.5 }}
                  transition={{
                    duration: reduced ? 0.15 : 2.4,
                    repeat: reduced ? 0 : Infinity,
                  }}
                />
                {milestone.done ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <span>{index + 1}</span>
                )}
              </div>
              <div className="roadmap-content">
                <div className="roadmap-period">
                  <span>{milestone.period}</span>
                  <small>
                    {milestone.done
                      ? SC.roadmap.completedLabel
                      : SC.roadmap.plannedLabel}
                  </small>
                </div>
                <h3>{milestone.title}</h3>
                <p>{milestone.description}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>

      <p className="section-footnote">
        {t("План и статусы приведены из концепции проекта. Сроки будущих этапов могут измениться.")}
      </p>
    </Section>
  );
}

function LiveStats({ notify }: { readonly notify: Notify }): JSX.Element {
  const live = useLiveChain();
  useI18n();
  const stats = SC.social.stats;

  const value = (
    number: bigint | number | null,
    decimals = 0,
  ): string => {
    if (number === null) return "—";
    const v = Number(number);
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString("ru-RU", { maximumFractionDigits: decimals });
  };

  const tiles: { key: string; label: string; figure: string; sub?: string }[] = [
    {
      key: "sold",
      label: stats.sold,
      figure: `${live.online ? live.sold : "—"} / ${live.online ? live.cap : presale.supply}`,
    },
    {
      key: "fields",
      label: stats.fields,
      figure: live.online ? value(live.fieldCount) : "—",
    },
    {
      key: "players",
      label: stats.players,
      figure: live.players === null ? "—" : value(live.players),
    },
    {
      key: "burned",
      label: stats.burned,
      figure: live.online ? value(live.burnedMicro / 1_000_000n) : "—",
    },
    {
      key: "supply",
      label: stats.supply,
      figure: live.supplyMicro === null ? "—" : value(live.supplyMicro / 1_000_000n),
      sub: t("потолок 1B · premine нет"),
    },
    {
      key: "treasury",
      label: stats.treasury,
      figure:
        live.treasuryLamports === null
          ? "—"
          : (Number(live.treasuryLamports) / 1e9).toFixed(3),
    },
  ];

  return (
    <Section id="social" className="social-section" speed={1.5}>
      <SectionHeading
        id="social-title"
        eyebrow={t("06 / СИГНАЛ С МАРСА")}
        title={SC.social.title}
        text={SC.social.subtitle}
      />

      {!live.online && (
        <p className="live-offline-note">
          <span className="status-dot status-dot--amber" />
          {SC.social.offline}
        </p>
      )}

      <div className="live-stats-grid">
        {tiles.map((tile, index) => (
          <Reveal key={tile.key} delay={index * 0.05} className="live-stat panel" panel="default">
            <div className="live-stat-figure">{tile.figure}</div>
            <div className="live-stat-label">{tile.label}</div>
            {tile.sub && <div className="live-stat-sub">{tile.sub}</div>}
          </Reveal>
        ))}
      </div>

      <div className="social-bottom">
        <p className="section-footnote">
          {live.online
            ? t("Обновлено {time} · источник: общий devnet RPC Solana", { time: new Date(live.updatedAt).toLocaleTimeString() })
            : t("Секция читает getAccountInfo / getProgramAccounts напрямую из публичного RPC.")}
        </p>
        <a
          className="small-code"
          href="https://explorer.solana.com/address/DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf?cluster=devnet"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => notify(t("Проверка цифр — в Solana Explorer. Программа DUUBi…Eadf."))}
        >
          DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      </div>
    </Section>
  );
}
function FAQ(): JSX.Element {
  const { award } = useGamification();
  useI18n();
  const [active, setActive] = useState<number | null>(0);
  const reduced = usePrefersReducedMotion();

  return (
    <Section id="faq" speed={0.4}>
      <div className="faq-layout">
        <SectionHeading
          id="faq-title"
          eyebrow={t("07 / ЦЕНТР СВЯЗИ")}
          title={SC.faq.title}
          text={t("Всё, что стоит знать до посадки на Марс.")}
        />

        <div className="faq-list">
          {FAQ_ITEMS.map((item, index) => {
            const open = active === index;
            const triggerId = `faq-trigger-${index}`;
            const panelId = `faq-panel-${index}`;

            return (
              <Reveal key={item.question} delay={index * 0.035}>
                <article
                  className={`faq-item ${open ? "faq-item--open" : ""}`}
                  data-liquid-panel={open ? "accent" : undefined}
                >
                  {open && (
                    <LiquidPanelBorder
                      variant="accent"
                      runningLight={false}
                    />
                  )}
                  <h3>
                    <button
                      id={triggerId}
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={(event) => {
                        if (!open) {
                          award(
                            { kind: "faq", id: String(index) },
                            elementXpOrigin(event.currentTarget),
                          );
                        }

                        setActive(open ? null : index);
                      }}
                    >
                      <span className="faq-number">0{index + 1}</span>
                      <span>{item.question}</span>
                      <motion.span
                        className="faq-chevron"
                        animate={{ rotate: reduced ? 0 : open ? 180 : 0 }}
                        transition={{ duration: reduced ? 0 : 0.2 }}
                      >
                        <MotionIcon active={open}>
                          <ChevronDown size={19} aria-hidden="true" />
                        </MotionIcon>
                      </motion.span>
                    </button>
                  </h3>

                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={triggerId}
                  >
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          key={panelId}
                          className="faq-answer-wrap"
                          initial={{ height: reduced ? "auto" : 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: reduced ? "auto" : 0, opacity: 0 }}
                          transition={
                            reduced
                              ? { duration: 0.15 }
                              : { type: "spring", stiffness: 180, damping: 26 }
                          }
                        >
                          <p className="faq-answer">{item.answer}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </Section>
  );
}


function describeTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/user rejected|User rejected/i.test(msg)) {
    return t("Транзакция отменена в кошельке.");
  }
  if (/presalecapreached|PresaleCapReached/i.test(msg)) {
    return t("Волна распродана: cap 500 модулей достигнут.");
  }
  if (/presalewalletlimitreached|PresaleWalletLimitReached/i.test(msg)) {
    return t("Лимит: один кошелёк может купить не больше 5 модулей в пресейле.");
  }
  if (/insufficient funds|INSUFFICIENT_FUNDS|blockhash/i.test(msg)) {
    return t("Недостаточно SOL для комиссии/rent или blockhash протух — попробуй ещё раз.");
  }
  return t("Не удалось отправить транзакцию: {msg}", { msg });
}

function PacksSection(): JSX.Element {
  useI18n();
  const { connected, publicKey, balanceSkr, connect, connecting, connection } =
    useLandingWallet();
  const live = useLiveChain();
  const [purchasing, setPurchasing] = useState(false);
  const [success, setSuccess] = useState<{ tx: string; tier: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const price = chainConfig.presalePriceSkrAtoms;
  const balanceOk = balanceSkr >= price;
  const soldOut = live.online && live.sold >= live.cap;

  const buyPack = async () => {
    if (!connected || !publicKey || purchasing || soldOut) return;
    setPurchasing(true);
    setError(null);
    try {
      // Реальная devnet-транзакция (как в игре): buy_field_skr,
      // тир кидает сама программа: keccak(buyer ‖ sold ‖ slot).
      const programId = new PublicKey(chainConfig.programId);
      const { config: configPda, field } = pdas(programId);

      const cfgInfo = await connection.getAccountInfo(configPda());
      if (!cfgInfo) throw new Error(t("GameConfig PDA не найден — devnet не отвечает."));
      const cfg = decodeConfig(Buffer.from(cfgInfo.data));

      const fieldId = randomU64();
      const buyerSkrAta = getAssociatedTokenAddressSync(TEST_SKR_MINT, publicKey);

      const ataIx = createAssociatedTokenAccountIdempotentInstruction(
        publicKey,
        buyerSkrAta,
        publicKey,
        TEST_SKR_MINT,
      );
      const buyIx = await ixBuyFieldSkr(programId, {
        config: configPda(),
        presaleState: presaleStatePda(programId),
        authority: cfg.authority,
        buyerPresale: buyerPresalePda(programId, publicKey),
        field: field(fieldId),
        buyer: publicKey,
        treasurySol: treasurySolPda(programId),
        skrMint: TEST_SKR_MINT,
        buyerSkrAta,
        treasurySkrAta: treasurySkrAta(programId, TEST_SKR_MINT),
        buybackSkrAta: buybackSkrAta(cfg.authority, TEST_SKR_MINT),
        fieldId,
      });

      const tx = new Transaction().add(ataIx, buyIx);
      tx.feePayer = publicKey;
      const blockhash = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash.blockhash;

      const signed = await window.solana?.signTransaction(tx);
      if (!signed) throw new Error(t("Кошелёк не вернул подписанную транзакцию."));

      const signature = await connection.sendRawTransaction(signed.serialize());
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        },
        "confirmed",
      );
      if (confirmation.value.err) {
        throw new Error(t("Программа отклонила транзакцию: ") + String(confirmation.value.err));
      }

      // Читаем реальный тир из созданного поля: field_type на offset 67
      let tier = 0;
      try {
        const fieldInfo = await connection.getAccountInfo(field(fieldId));
        const onchainTier = fieldInfo?.data[67];
        if (typeof onchainTier === "number") tier = onchainTier;
      } catch {
        /* тир не критичен: показываем COMMON-фолбэк */
      }

      setSuccess({ tx: signature, tier });
    } catch (err: unknown) {
      setError(describeTxError(err));
    } finally {
      setPurchasing(false);
    }
  };

  const addr = publicKey ? publicKey.toBase58() : "";
  const balance = (Number(balanceSkr) / 1e6).toFixed(2);

  return (
    <Section id="packs" className="waitlist-section" speed={0.7}>
      <Reveal className="waitlist-panel panel" panel="accent">
        <div className="waitlist-copy">
          <p className="eyebrow">
            <span className="status-dot" />
            {t("08 / ПРЕСЕЙЛ МОДУЛЕЙ")}
          </p>
          <h2 id="packs-title">{t("Купи модуль колонии")}</h2>
          <p>
            {live.online
              ? t("{n} модулей продано — данные live с devnet.", { n: `${live.sold} / ${live.cap}` })
              : t("Счётчик читается с devnet (общий RPC).")}{" "}
            {t("1053 SKR — и гидропонная кассета твоя. Редкость кидает сама программа: COMMON 70% · RARE 25% · EPIC 5%.")}
            <span className="pack-note" aria-hidden="true">keccak(buyer ‖ sold ‖ slot)</span>
          </p>
          <p className="waitlist-payment-note">
            {t("Реальная devnet-транзакция: модуль записывается на твой кошелёк прямо в контракте,")}
            {t("игра подхватит его автоматически.")}
          </p>

          <div className="boarding-pass" aria-hidden="true">
            <Mark />
            <div>
              <span>{t("ЗЕМЛЯ → МАРС")}</span>
              <strong>ARES-1</strong>
              <small>{t("ГИДРОПОННЫЙ МОДУЛЬ")}</small>
            </div>
            <div className="barcode" />
          </div>
        </div>

        <div className="waitlist-form-area">
          <p className={`form-mode ${connected ? "form-mode--live" : ""}`}>
            <span className={`status-dot ${connected ? "" : "status-dot--amber"}`} />
            {connected ? t("КОШЕЛЁК ПОДКЛЮЧЁН · DEVNET") : t("КОШЕЛЁК НЕ ПОДКЛЮЧЁН")}
          </p>

          {connected ? (
            <>
              <div className="pack-wallet-line">
                <span>{t("адрес")}</span>
                <strong>{addr.slice(0, 4)}…{addr.slice(-4)}</strong>
              </div>
              <div className="pack-wallet-line">
                <span>{t("баланс SKR")}</span>
                <strong style={{ color: balanceOk ? "#35e0c0" : "#ff5470" }}>
                  {balance} SKR
                </strong>
              </div>
              <button
                className="pack-buy-main"
                onClick={() => { void buyPack(); }}
                disabled={purchasing || !balanceOk || soldOut}
              >
                ⚡ {purchasing ? t("Отправка транзакции…") : soldOut ? t("Волна распродана") : t("Купить модуль · 1053 SKR")}
              </button>
              {soldOut && (
                <p className="pack-note">{t("Все {n} модулей первой волны проданы.", { n: live.cap })}</p>
              )}
              {!balanceOk && !soldOut && (
                <p className="pack-note">{t("Недостаточно SKR для покупки модуля.")}</p>
              )}
            </>
          ) : (
            <>
              <button
                className="pack-buy-main"
                onClick={() => { void connect(); }}
                disabled={connecting}
              >
                {connecting ? t("Подключение…") : "⚡ " + t("Подключить кошелёк")}
              </button>
              <p className="pack-note">
                {t("Phantom или Solflare. После подключения кнопка покупки станет активной.")}
              </p>
            </>
          )}

          {error && <p className="pack-note pack-note--error">{error}</p>}

          <p className="pack-note">
            {t("devnet: SKR и SOL тестовые и не имеют реальной стоимости.")}
          </p>
        </div>
      </Reveal>

      {success && (
        <SuccessModal tx={success.tx} tier={success.tier} onClose={() => setSuccess(null)} />
      )}
    </Section>
  );
}

function SuccessModal({ tx, tier, onClose }: { tx: string; tier: number; onClose: () => void }): JSX.Element {
  const TIERS = ["COMMON", "RARE", "EPIC"];
  useI18n();
  const COLORS = ["#9AA0AC", "#B85CFF", "#FFC94A"];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.85)",
          backdropFilter: "blur(8px)",
          zIndex: 2000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.92, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: 440,
            width: "100%",
            background: "rgba(18,18,26,0.97)",
            border: `2px solid ${COLORS[tier]}`,
            borderRadius: 16,
            padding: "36px 28px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 44, marginBottom: 14 }} aria-hidden="true">🥔</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10, color: COLORS[tier], letterSpacing: "0.06em" }}>
            {TIERS[tier]} · {t("МОДУЛЬ КУПЛЕН")}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 18, color: "var(--pf-text-secondary, #b8b8c8)" }}>
            {t("Модуль ждёт вас в игре: он уже записан на твой кошелёк в контракте.")}
            {t("Заходи под тем же кошельком — делянка на месте.")}
          </p>
          <a
            href={`https://explorer.solana.com/tx/${tx}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              padding: "8px 14px",
              background: "rgba(255,255,255,0.07)",
              borderRadius: 6,
              fontSize: 11,
              color: "var(--pf-text-secondary, #b8b8c8)",
              textDecoration: "none",
              marginBottom: 18,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            }}
          >
            {t("транзакция в эксплорере")} ↗
          </a>
          <div>
            <a
              href={PC.url}
              target="_blank"
              rel="noopener noreferrer"
              className="cta-play"
            >
              <Play size={18} aria-hidden="true" />
              {t("ИГРАТЬ")}
            </a>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
function Footer(): JSX.Element {
  useI18n();
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-top">
          <a href="#hero" className="brand" aria-label={SC.header.homeLabel}>
            <Mark />
            <span>
              <strong>POTATO</strong>
              <small>{t("КОЛОНИЯ · ARES-1")}</small>
            </span>
          </a>

          <nav aria-label={SC.footer.navigationLabel} className="footer-links">
            {SC.footer.links.map((link) => (
              <MorphButton
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                variant="ghost"
                className="morph-button--footer"
                magnetic={false}
              >
                {link.label}
                <ArrowUpRight size={14} aria-hidden="true" />
              </MorphButton>
            ))}
          </nav>
        </div>

        <div className="footer-middle">
          <p>{SC.footer.copyright}</p>
        </div>

        <p className="disclaimer">{SC.footer.disclaimer}</p>
        <div className="footer-bottom">
          <span>{t("СДЕЛАНО ДЛЯ НИЗКОЙ ГРАВИТАЦИИ")}</span>
          <AnimatedTextLink href="#hero">{t("НАВЕРХ")} ↑</AnimatedTextLink>
        </div>
      </div>
    </footer>
  );
}

function Toast({
  message,
  close,
}: {
  readonly message: string | null;
  readonly close: () => void;
}): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);

  useEffect(() => {
    function refresh(): void {
      setPageVisible(!document.hidden);
    }

    document.addEventListener("visibilitychange", refresh);

    return () => {
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <div className="toast-container">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {message ?? ""}
      </div>
      <AnimatePresence>
        {message && (
          <motion.div
            key={message}
            className="toast panel"
            initial={{
              opacity: 0,
              x: reduced ? 0 : 80,
              scale: reduced ? 1 : 0.8,
              rotate: reduced ? 0 : -2,
            }}
            animate={{ opacity: 1, x: 0, scale: 1, rotate: 0 }}
            exit={{
              opacity: 0,
              x: reduced ? 0 : 100,
              scale: reduced ? 1 : 0.95,
              rotate: 0,
            }}
            transition={
              reduced
                ? { duration: 0.15 }
                : { type: "spring", stiffness: 210, damping: 24 }
            }
          >
            <motion.span
              className="toast-micro-glow"
              aria-hidden="true"
              animate={
                !reduced && pageVisible
                  ? { opacity: [0.2, 0.65, 0.2] }
                  : { opacity: 0.3 }
              }
              transition={{
                duration: reduced ? 0.15 : 2.4,
                repeat: !reduced && pageVisible ? Infinity : 0,
                ease: "easeInOut",
              }}
            />
            <p>{message}</p>
            <button
              type="button"
              className="icon-button"
              aria-label={SC.accessibility.closeNotification}
              onClick={close}
            >
              <MotionIcon>
                <X size={18} aria-hidden="true" />
              </MotionIcon>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App(): JSX.Element {
  const { lang } = useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // SEO-теги следуют за языком (title, description, og:*, twitter:*, html lang).
  useEffect(() => {
    document.title = SC.seo.title;
    const setMeta = (selector: string, value: string): void => {
      document.head.querySelector(selector)?.setAttribute("content", value);
    };
    setMeta('meta[name="description"]', SC.seo.description);
    setMeta('meta[property="og:title"]', SC.seo.ogTitle);
    setMeta('meta[property="og:description"]', SC.seo.ogDescription);
    setMeta('meta[property="og:image:alt"]', SC.seo.ogImageAlt);
    setMeta('meta[name="twitter:title"]', SC.seo.title);
    setMeta('meta[name="twitter:description"]', SC.seo.description);
    document.documentElement.lang = lang === "es-419" ? "es" : lang;
  }, [lang]);

  const notify = useCallback((message: string): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }

    setNotice(message);
    timer.current = window.setTimeout(() => setNotice(null), 7000);
  }, []);

  const closeNotice = useCallback((): void => {
    setNotice(null);

    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

  return (
    <>
      <a href="#main-content" className="skip-link">
        {SC.accessibility.skipToContent}
      </a>
      <Ambient />
      <Header notify={notify} />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Problem />
        <Mechanics />
        <Mascot />
        <Tokenomics />
        <InterstellarSection />
        <Roadmap />
        <LiveStats notify={notify} />
        <FAQ />
        <PacksSection />
      </main>
      <Footer />
      <Overlays />
      <Cursor />
      <Toast message={notice} close={closeNotice} />
      <GamificationHud />
      <ScrollRocket />
    </>
  );
}
