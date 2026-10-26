import {
  useCallback,
  useEffect,
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
import { useLiveChain } from "./hooks/useLiveChain";
import { LiquidPanelBorder } from "./LiquidPanel";
import type { LiquidPanelVariant } from "./LiquidPanel";
import { MorphButton } from "./MorphButton";
import { InterstellarSection } from "./InterstellarBridge";
import { LivingPhobos } from "./LivingPhobos";
import { PresaleBanner } from "./PresaleBanner";
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
} from "./MicroMotion";
import { SoundToggle } from "./SoundToggle";
import { CookieConsent, openCookieSettings } from "./CookieConsent";
import { t, useI18n, tr } from "./i18n";
import { LangSwitcher } from "./i18n/LangSwitcher";
import { useSounds } from "./useSounds";
import {
  assets,
  faq,
  features,
  gameConfig,
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
    <img
      className={className}
      src="/ares/glyphs/check.webp"
      alt=""
      aria-hidden="true"
      width="34"
      height="34"
      style={{ objectFit: "contain" }}
    />
  )
}


const FEATURE_EMBLEM: Record<FeatureIconName, string> = {
  sprout: "sprout",
  "sun-phobos": "moon",
  scales: "percent",
  helmets: "shield",
};

function FeatureIcon({ name }: { readonly name: FeatureIconName }): JSX.Element {
  // эмблема единого арт-сета ARES-1 (бронза/янтарь) вместо generic line-иконки
  return (
    <img
      src={`/ares/icons/${FEATURE_EMBLEM[name]}.webp`}
      alt=""
      aria-hidden="true"
      width={48}
      height={48}
      style={{ width: 48, height: 48, objectFit: "contain", display: "block" }}
    />
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
    <motion.img
      className="section-divider"
      src="/ares/divider-strip.webp"
      alt=""
      aria-hidden="true"
      initial={reduced ? false : { opacity: 0, scaleX: 0.6 }}
      whileInView={{ opacity: 1, scaleX: 1 }}
      viewport={{ once: true }}
      transition={{ duration: reduced ? 0 : 1.2, ease: "easeInOut" }}
    />
  );
}

// Живописный фон секции (арт-интерьеры колонии)
const ART_BY_SECTION: Record<string, string> = {
  mechanics: "/ares/bg-reactor.jpg",
  mascot: "/ares/bg-cargo.jpg",
  faq: "/ares/bg-maproom.jpg",
  tokenomics: "/ares/bg-vault.jpg",
};

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
      data-bg-art={ART_BY_SECTION[id] ? "" : undefined}
      style={
        ART_BY_SECTION[id]
          ? ({
              "--section-bg": `url('${ART_BY_SECTION[id]}')`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {ART_BY_SECTION[id] && (
        <span className="section-bg-art" aria-hidden="true" />
      )}
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

      <motion.div
        className="terrain terrain--far"
        style={{ y: farY }}
        aria-hidden="true"
      >
        <span
          style={{
            display: 'block', position: 'absolute', inset: 0,
            background:
              'linear-gradient(to bottom, rgba(112,70,87,0) 0%, rgba(112,70,87,0.9) 12%, #1e121c 45%), radial-gradient(60% 100% at 25% 100%, #704657 0 30%, transparent 31%), radial-gradient(50% 90% at 70% 100%, #5d3a4b 0 36%, transparent 37%)',
          }}
        />
      </motion.div>

      <motion.div
        className="terrain terrain--mid"
        style={{ y: midY }}
        aria-hidden="true"
      >
        <span
          style={{
            display: 'block', position: 'absolute', inset: 0,
            background:
              'linear-gradient(to bottom, rgba(156,73,47,0) 0%, rgba(156,73,47,0.85) 14%, #291018 50%), radial-gradient(55% 100% at 18% 100%, #9c492f 0 34%, transparent 35%), radial-gradient(70% 110% at 60% 100%, #7d3a28 0 40%, transparent 41%), radial-gradient(45% 90% at 92% 100%, #8a4230 0 32%, transparent 33%)',
          }}
        />
      </motion.div>

      <motion.div className="dome-layer" style={{ y: domeY }}>
        <img
          src="/ares/dome-colony.webp"
          className="dome-art"
          alt=""
          aria-hidden="true"
        />

        <div className="dome-callout">
          <span className="status-dot" />
          {t("КУПОЛ ARES-1")}
          <small>{t("6 КАССЕТ · ВИЗУАЛИЗАЦИЯ МОДУЛЯ")}</small>
        </div>
      </motion.div>

      <motion.div className="dust-layer" style={{ y: dustY }}>
        <span
          aria-hidden="true"
          style={{
            display: 'block', position: 'absolute', inset: 0,
            background:
              'radial-gradient(120% 140% at 12% 130%, #1b0d14 0 58%, transparent 59%), radial-gradient(90% 120% at 45% 140%, #22101a 0 52%, transparent 53%), radial-gradient(110% 130% at 85% 135%, #1b0d14 0 60%, transparent 61%), linear-gradient(to top, rgba(177,100,67,0.22) 0, transparent 14%)',
          }}
        />
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

function Hero(): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  useI18n();
  const title = useTypewriter({ text: SC.hero.title });

  return (
    <section ref={ref} id="hero" className="hero" aria-labelledby="hero-title">
      <MarsScene target={ref} />
      <div className="container hero-inner">
        <div className="hero-content">
          <Reveal>
            <div className="hero-badge">
              <span className="status-dot" />
              {t("ARES-1 · DEVNET FIELD GAME")}
              <span className="badge-code">BETA</span>
            </div>
          </Reveal>
          <h1 id="hero-title" className="hero-title">
            <span className="sr-only">{SC.hero.title}</span>
            <span className="typewriter-reserve" aria-hidden="true">{SC.hero.title}</span>
            <span className="typewriter-visible" aria-hidden="true">
              {title.displayedText}{!title.isComplete && <span className="type-caret" />}
            </span>
          </h1>
          <Reveal delay={0.15}>
            <p className="hero-description">
              {t("ARES-1 сейчас — devnet-бета с реальными on-chain-полями и действиями. Пресейл за SKR закрыт; строительство колонии пока не подключено.")}
            </p>
          </Reveal>
          <Reveal className="hero-actions" delay={0.25}>
            <a className="cta-play" href={PC.url} target="_blank" rel="noopener noreferrer">
              <Play size={18} aria-hidden="true" />{t("ОТКРЫТЬ DEVNET-БЕТУ")}
            </a>
            <a className="cta-buy" href="#launch-status">{t("СТАТУС ПОКУПКИ")}</a>
          </Reveal>
          <p className="hero-habitat-note">
            {t("Внутри купола — шесть гидропонных кассет: ростки, листва и клубни. Дрон показывает цикл осмотра.")}
            {t("Сцена иллюстративная, не телеметрия твоей фермы.")}
          </p>
        </div>
        <div className="hero-side-label" aria-hidden="true">
          {t("ДОЛИНА МАРИНЕРА")}<span>{t("14° Ю. Ш. · МАРС")}</span>
        </div>
        <div className="hero-bottom">
          <p><span className="status-dot" />SOLANA DEVNET</p>
          <span>{t("ИСХОДНИКИ ОТКРЫТЫ · ПРОГРАММА ОБНОВЛЯЕТСЯ")}</span>
          <a href="#problem" aria-label={t("Узнать о колонии")}><ChevronDown size={18} aria-hidden="true" /></a>
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
          {t("ARES-1 сейчас — devnet-бета с on-chain-полями и действиями. Тестовые токены не имеют денежной стоимости; постоянное строительство колонии ещё не подключено.")}
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
function Product(): JSX.Element {
  useI18n();
  return (
    <Section id="product" speed={0.5}>
      <SectionHeading
        id="product-title"
        eyebrow={t("СТАТУС ПРОДУКТА")}
        title={t("ARES-1 · DEVNET FIELD GAME")}
        text={t("Сейчас ARES-1 — игра с on-chain-полями в Solana devnet. Подключай кошелёк в игре, создавай поля за тестовый POTATO и используй действия контракта. Это не постоянная колония: аккаунты и правила строительства ещё не реализованы.")}
      />

      <div className="product-grid">
        <Reveal className="product-poster" delay={0.1}>
          <img
            src="/ares/product-poster.jpg"
            alt={t("Постер игры ARES-1: картофельная ферма под куполами Марса")}
            width={1376}
            height={768}
            loading="lazy"
            decoding="async"
          />
        </Reveal>
        <Reveal className="product-points" delay={0.2}>
          <ul>
          <li>
            <Check size={18} aria-hidden="true" />
            <span>{t("ПОЛЯ И СУЩЕСТВУЮЩИЕ ДЕЙСТВИЯ РАБОТАЮТ В SOLANA DEVNET")}</span>
          </li>
          <li>
            <Check size={18} aria-hidden="true" />
            <span>{t("СОЗДАНИЕ ПОЛЯ ДОСТУПНО ВНУТРИ ИГРЫ ЗА ТЕСТОВЫЙ POTATO")}</span>
          </li>
          <li>
            <Check size={18} aria-hidden="true" />
            <span>{t("ПОСТОЯННОЕ СТРОИТЕЛЬСТВО КОЛОНИИ ЕЩЁ НЕ РЕАЛИЗОВАНО")}</span>
          </li>
          </ul>
          <Action href={PC.url} target="_blank" rel="noopener noreferrer">
            {t("Играть в ARES-1")}
            <ArrowUpRight size={16} aria-hidden="true" />
          </Action>
        </Reveal>
      </div>
    </Section>
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
        text={t("Полевая игра использует on-chain-аккаунты Solana; постоянное строительство колонии пока не доступно.")}
      />

      <div className="feature-grid">
        {FEATURES.map((feature, index) => (
          <Reveal key={feature.id} delay={index * 0.08} className="feature-reveal">
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


      <Reveal className="tier-panel panel" panel="accent">
        <div className="tier-intro">
          <p className="eyebrow">{t("СТАТУС ПРОДУКТА")}</p>
          <h3>{t("ОДНО ПОЛЕ — НЕ КОЛОНИЯ")}</h3>
          <p>{t("Покупка поля создаёт отдельный on-chain аккаунт. Она не создаёт базу, строительные ресурсы или постоянную лабораторию.")}</p>
        </div>
        <div className="product-status-list">
          <p><span className="status-dot" />{t("АГРО · действующие on-chain поля")}</p>
          <p><span className="status-dot" />{t("ЛАБ · просмотр тех же полей и действий")}</p>
          <p><span className="status-dot status-dot--amber" />{t("КОЛОНИЯ · строительство ещё не реализовано")}</p>
        </div>
        <p className="tier-disclaimer">{t("SKR-пресейл закрыт. Devnet-активы тестовые; до отдельного одобрения не отправляйте средства.")}</p>
      </Reveal>
    </Section>
  );
}

function FirstGreenhouseOperation(): JSX.Element {
  useI18n();
  const systems = [
    { step: "01", title: t("ПОЛЯ"), goal: t("Действующие поля — отдельные on-chain аккаунты выбранного кошелька.") },
    { step: "02", title: t("ДЕЙСТВИЯ"), goal: t("Сбор и другие доступные действия выполняются через существующие транзакции.") },
    { step: "03", title: t("ЛАБОРАТОРИЯ"), goal: t("Лаборатория показывает те же поля и не создаёт пробный стенд или локальный урожай.") },
    { step: "04", title: t("КОЛОНИЯ"), goal: t("Постоянные аккаунты строительства и правила размещения пока не подключены.") },
  ];

  return (
    <Section id="operation" className="operation-section" speed={0.55}>
      <SectionHeading
        id="operation-title"
        eyebrow={t("СТАТУС · DEVNET")}
        title={t("ДЕЙСТВУЮЩАЯ ИГРА")}
        text={t("Это обзор текущего продукта, а не кампания, обучение или локальная симуляция.")}
      />

      <Reveal className="panel operation-panel" panel="accent">
        <div className="operation-chapters">
          {systems.map((system) => (
            <article className="operation-chapter" key={system.step}>
              <span className="small-code">ARES-1 / {system.step}</span>
              <h3>{system.title}</h3>
              <p>{system.goal}</p>
            </article>
          ))}
        </div>
        <div className="operation-status">
          <p>
            {t("Личный devnet-журнал сверяет задачи с состоянием on-chain аккаунтов. Он не выдаёт сезонные очки или награды; тестовый прогресс не переносится в mainnet.")}
          </p>
          <Action href={`${PC.url}/operation`} target="_blank" rel="noopener noreferrer" variant="primary">
            {t("ОТКРЫТЬ ЖУРНАЛ СОСТОЯНИЯ")}
            <ArrowUpRight size={16} aria-hidden="true" />
          </Action>
        </div>
      </Reveal>
      <p className="section-footnote">
        {t("Действия поля подтверждаются в кошельке и записываются в devnet-контракт; на лендинге нет локальных игровых ресурсов или начислений.")}
      </p>
    </Section>
  );
}

function TuberArt(): JSX.Element {
  return (
    <img
      src="/ares/tuber9-happy.webp"
      className="tuber-art"
      width={420}
      height={460}
      alt=""
      aria-hidden="true"
    />
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
            <span className="small-code">MINT → FLOW → BURN / TREASURY</span>
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
        <div className="burn-symbol" aria-hidden="true">9–12<span>%</span></div>
        <div>
          <p className="eyebrow">{t("ЦЕЛЕВАЯ V2 · КОМИССИЯ РЫНКА")}</p>
          <p>{SC.tokenomics.deflation}</p>
        </div>
        <span className="burn-tag">{t("ИЗ ВЫПЛАТЫ ПРОДАВЦУ")}<br />{t("В КАЗНУ В SOL / SKR")}</span>
      </Reveal>

      <Reveal className="tokenomics-notes">
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

        {/*
          Legal pages are intentionally absent per the owner's 2026-10-06 decision.
          This does not mean legal review is complete: no real-payment launch is
          approved until terms, refunds, delivery, privacy and applicable notices
          are explicitly reviewed. Keep the consent controls available here.
        */}
        <nav aria-label={t("Настройки cookies")} className="footer-legal">
          <button type="button" className="footer-legal__button" onClick={openCookieSettings}>
            {t("Настройки cookies")}
          </button>
        </nav>

        <div className="footer-middle">
          <p>{SC.footer.copyright}</p>
          <p className="footer-contact">
            {t("Связь с командой")}:{" "}
            <a
              href="https://github.com/Leo88q/ares1/security/advisories/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub Security Advisory
            </a>
          </p>
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
        <PresaleBanner />
        <Product />
        <Problem />
        <Mechanics />
        <FirstGreenhouseOperation />
        <Mascot />
        <Tokenomics />
        <InterstellarSection />
        <Roadmap />
        <LiveStats notify={notify} />
        <FAQ />
      </main>
      <Footer />
      <Overlays />
      <Cursor />
      <Toast message={notice} close={closeNotice} />
      <GamificationHud />
      <ScrollRocket />
      {/* Consent UI (§4.3). Mounted last so it paints above everything, and it
          is not a modal: rejecting must never block the page. */}
      <CookieConsent />
    </>
  );
}
