
import * as i18nCore from "./i18n/index";

const LOCALES: Record<string, string> = {
  en: "en-US",
  ru: "ru-RU",
  "pt-BR": "pt-BR",
  "es-419": "es-MX",
  vi: "vi-VN",
  id: "id-ID",
  tl: "fil-PH",
};

export interface RoadmapMilestone {
  readonly period: string;
  readonly title: string;
  readonly done: boolean;
  readonly description: string;
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

export type FeatureIconName = "sprout" | "sun-phobos" | "scales" | "helmets";

export interface ColonyFeature {
  readonly id: string;
  readonly label: string;
  readonly icon: FeatureIconName;
  readonly title: string;
  readonly description: string;
}

export interface ModuleTier {
  readonly id: "common" | "rare" | "epic";
  readonly label: string;
  readonly color: string;
  readonly chancePercent: number;
  readonly gameYieldPercent: number;
}

export interface PresaleConfig {
  readonly priceSkr: number;
  readonly priceSol: string;
  readonly sold: number;
  readonly supply: number;
  readonly endsAt: string | null;
  readonly network: "devnet";
}

export const presale = {
  priceSkr: 1053,
  priceSol: "0.25",
  sold: 0, // fallback; live-значение читается с PresaleState.sold (App.tsx)
  supply: 500,
  endsAt: null,
  network: "devnet",
} as const satisfies PresaleConfig;

export const moduleTiers = [
  {
    id: "common",
    label: "COMMON",
    color: "#A5A7B0",
    chancePercent: 70,
    gameYieldPercent: 35,
  },
  {
    id: "rare",
    label: "RARE",
    color: "#B85CFF",
    chancePercent: 25,
    gameYieldPercent: 100,
  },
  {
    id: "epic",
    label: "EPIC",
    color: "#FFB347",
    chancePercent: 5,
    gameYieldPercent: 210,
  },
] as const satisfies readonly ModuleTier[];

export const features = [
  {
    id: "harvest",
    label: "СБОР УРОЖАЯ",
    icon: "sprout",
    title: "КАПЛЯ ЗА КАПЛЕЙ",
    description:
      "Каждую секунду твой модуль генерирует $POTATO. Копи до 7 суток, забирай одним харвестом. Чем выше уровень — тем быстрее капает.",
  },
  {
    id: "marketplace",
    label: "СНАБЖЕНИЕ (РЫНОК)",
    icon: "scales",
    title: "ТОРГОВАЯ БИРЖА КОЛОНИИ",
    description:
      "Целевая версия V2: 9–12% от gross-суммы удерживается только при успешном fill из выплаты продавцу и поступает в казну в валюте расчёта (SOL или SKR). Суточные маржинальные tiers зависят от суммарного POTATO-объёма seller-wallet и общие для SOL/SKR-пар — дробление ордеров одного адреса не должно обходить ставку. Конкретные границы tiers — рабочий проект и будут опубликованы после финального решения перед релизом. Sybil-кошельки без identity-системы не блокируются. Сейчас devnet-контракт — legacy SOL/POTATO; V2 и пара POTATO/SKR ещё не активны.",
  },
  {
    id: "referrals",
    label: "ВЫЗВАТЬ ПОСЕЛЕНЦА",
    icon: "helmets",
    title: "ПРИВЕДИ СОСЕДА",
    description:
      "Ссылка бесплатна. В текущем devnet-контракте регистрация приглашённого сжигает 5 POTATO; referral-выплаты/скидки относятся к legacy-рынку. Их совместимость с новой 9–12% settlement-комиссией ещё не включена: новая комиссия в казну не уменьшается.",
  },
  {
    id: "lunar-cycle",
    label: "ЛУННЫЙ ЦИКЛ",
    icon: "sun-phobos",
    title: "ФАЗЫ ФОБОСА",
    description:
      "28 эпох по 24 часа в целевом лунном цикле. Множитель эмиссии от 0.85× до 1.15×. Фактическое время цикла зависит от своевременного on-chain roll_epoch.",
  },
  {
    id: "first-greenhouse",
    label: "СЕЗОННАЯ ОПЕРАЦИЯ",
    icon: "sprout",
    title: "ОПЕРАЦИЯ: ПЕРВАЯ ТЕПЛИЦА",
    description:
      "28-дневная кампания из четырёх глав: Посадка, Вода, Ремонт колонии и Первый урожай. Сейчас в игре доступен devnet-журнал личных условий по on-chain состоянию; сезонные очки, глобальный рейтинг и призы появятся только после внедрения отдельного учёта.",
  },
  {
    id: "growing-tax",
    label: "РАСТУЩИЙ НАЛОГ",
    icon: "scales",
    title: "НАЛОГ НА ХАРВЕСТ",
    description:
      "Базовая ставка 2% растёт квадратично с заполнением supply до 10%. Чем ближе к максимуму — тем выше налог. Мотивирует держать токены, а не копить.",
  },
  {
    id: "elastic-cap",
    label: "ЭЛАСТИЧНЫЙ КАП",
    icon: "sprout",
    title: "АДАПТИВНАЯ ЭМИССИЯ",
    description:
      "Суточный лимит эмиссии меняется от 250K до 750K POTATO. Зависит от burn-объёмов и заполненности предыдущей эпохи. Экономика дышит вместе с игроками.",
  },
  {
    id: "mutations",
    label: "МУТАЦИИ",
    icon: "sprout",
    title: "ЗОЛОТО И КРЕМНИЙ",
    description:
      "При улучшении поля 5% шанс мутации: Golden Sprout (3%) — +25% к урожаю навсегда, Silicon Skin (2%) — износ прочности в 2 раза медленнее.",
  },
  {
    id: "export-license",
    label: "ЭКСПОРТНАЯ ЛИЦЕНЗИЯ",
    icon: "scales",
    title: "СВОБОДА ТОРГОВЛИ",
    description:
      "Legacy-функция devnet: лицензия стоит 500 SKR на 30 дней и даёт скидку к старой POTATO-комиссии. Эта скидка не относится к целевой V2-модели 9–12% в валюте расчёта и не будет уменьшать казначейскую комиссию.",
  },
  {
    id: "quests",
    label: "КВЕСТЫ КОЛОНИИ",
    icon: "helmets",
    title: "НАШИВКИ ЭКИПАЖА",
    description:
      "6 ончейн-квестов (первое поле, первый урожай, 1 000 POTATO и другие). Одноразовый пул 550 POTATO: награды минтит сервер в пределах капа эпохи, клиент только заявляет.",
  },
] as const satisfies readonly ColonyFeature[];

// Аллокаций нет: 100% $POTATO эмитуется в игре (harvest / квесты),
// premine и «доля команды» отсутствуют — см. tokenCycle.

// ── Модель Фазы 1: майнинг принадлежит игрокам, аллокации нет ──
export const tokenCycle = {
  manifesto: "100% POTATO РОЖДАЕТСЯ В РУКАХ ИГРОКОВ",
  manifestoSub:
    "Миллиард — это потолок, а не обещание. Supply растёт по правилам эмиссии и сокращается только при фактическом burn. Целевая V2-комиссия рынка в SOL/SKR не сжигает $POTATO.",
  birth: {
    title: "РОЖДЕНИЕ · MINT",
    items: [
      "Харвест: эластичный кап эпохи 250–750K POTATO",
      "Лунный цикл: множитель эмиссии 0.85×–1.15×",
      "Квесты: награды минтит только сервер, не клиент",
      "Реферальные выплаты legacy-рынка не уменьшают новую 9–12% settlement-комиссию; совместимость ещё не включена",
    ],
  },
  flow: {
    title: "ОБРАЩЕНИЕ",
    items: [
      "Кошельки колонистов и накопления на модулях",
      "Escrow-ордера торговой биржи",
      "P2P-обмен $POTATO: текущий devnet — legacy SOL-пара; SKR-пара готовится в V2",
    ],
  },
  death: {
    title: "BURN · TREASURY",
    items: [
      "Legacy V1 devnet: 60% старой POTATO-комиссии сжигается при исполнении; это не новая модель",
      "V2: 9–12% удерживается из SOL/SKR выплаты продавцу и поступает в казну; POTATO не сжигается",
      "Налог на харвест 2–10%: половина сгорает, половина — в казну",
      "Ремонт, улучшения, удобрения",
      "Регистрация приглашённого по реферальной ссылке: 5 POTATO",
      "Межигровые расходы не включены в текущую версию ARES-1",
    ],
  },
  teamNote:
    "Продажа паков и рыночная комиссия — разные потоки учёта. Разработчик может получать выплаты только из проектной казны через on-chain authority-процесс; это не означает автоматическую выплату или гарантированную прибыль.",
  treasuryNote:
    "Целевая V2-комиссия поступает в казну в валюте расчёта (SOL/SKR). Выводы проходят отдельный двухшаговый on-chain процесс с timelock; новая комиссия и её выводы не активны до релиза V2 и отдельных launch approvals.",
  capNote:
    "Максимальный supply 1 000 000 000 не изменится. Это потолок: эмиссия остановится на нём, даже если майнить будут все.",
} as const;

export const playConfig = {
  /** Dev: localhost:5175 · Prod: заменить на боевой домен игры */
  url: "https://ares1-play.pages.dev",
  label: "НАЧАТЬ ИГРАТЬ",
  labelShort: "ИГРАТЬ",
} as const;

export const chainConfig = {
  rpcUrl: "https://api.devnet.solana.com",
  /** Монт $POTATO (devnet) — из devnet-конфига программы */
  potatoMint: "HFEL9rBqmYwYDsZNxuV2ZonfS7adbjENUc3CdgbaiYxv" as string,
  maxSupply: 1_000_000_000,
  /** Program ID лендинга и игры — один и тот же контракт (devnet) */
  programId: "DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf" as string,
  /** Монт SKR (devnet) */
  skrMint: "Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o" as string,
  /** Цена модуля в presale: 1053 SKR = 1053 * 1e6 atoms · 0.25 SOL = 250_000_000 lamports */
  presalePriceSkrAtoms: 1_053_000_000n as bigint,
  presalePriceSolLamports: 250_000_000n as bigint,
} as const;


export const roadmap = [
  {
    period: "Q1 2026",
    title: "ЗАПУСК ПРЕСЕЙЛА",
    done: true,
    description:
      "500 модулей первой волны, ончейн на Solana devnet: платежи SKR, маркетплейс, рефералка, экспортные лицензии.",
  },
  {
    period: "Q2 2026",
    title: "ПОЛНАЯ ЭКОНОМИКА",
    done: true,
    description:
      "6 ончейн-квестов (пул 550 POTATO), удобрения, растущий налог, мутации Golden/Silicon, прокачка поля до 50 уровня. Всё работает на devnet.",
  },
  {
    period: "V2 · DEVNET + АУДИТ",
    title: "РЫНОК V2",
    done: false,
    description:
      "Накопительные tiers 9/10/11/12%, удержание fee в quote-валюте и отдельная пара POTATO/SKR. Нужны версия программы, тесты и аудит; legacy devnet-рынок остаётся отдельным.",
  },
  {
    period: "Q4 2026 · devnet",
    title: "ОПЕРАЦИЯ: ПЕРВАЯ ТЕПЛИЦА",
    done: false,
    description:
      "28-дневная кампания: Посадка → Вода → Ремонт колонии → Первый урожай. Сейчас доступен журнал состояния; сезонный on-chain учёт и награды ещё не включены.",
  },
  {
    period: "После отдельного GO/NO-GO",
    title: "MAINNET ARES-1",
    done: false,
    description:
      "Только после внешнего аудита, подтверждения mainnet-конфигурации, Squads/authority, казны, операционных rehearsals и отдельного решения владельца. Дата не обещана.",
  },
] as const satisfies readonly RoadmapMilestone[];

export const faq = [
  {
    question: "Что такое ARES-1?",
    answer:
      "Первая ончейн-колония на Марсе: Solana (devnet), экосистема Seeker. Ты покупаешь гидропонный модуль, растишь картофель под куполом, получаешь $POTATO и торгуешь с другими колонистами. Игровые механики работают в блокчейне, исходники открыты. Сейчас проект работает в devnet, программа может обновляться.",
  },
  {
    question: "Что нужно, чтобы начать играть?",
    answer:
      "Кошелёк Phantom и игра по адресу ares1-play.pages.dev. Проект сейчас в devnet — тестовой сети Solana: SOL и SKR там тестовые и не имеют реальной стоимости. Модуль покупается в игре или прямо на этом сайте (реальная devnet-транзакция).",
  },
  {
    question: "Зачем покупать модуль в пресейле?",
    answer:
      "Первая волна — 500 модулей по 1 053 SKR. Тип роллится ончейн случайно: 70% — COMMON (урожай 35%), 25% — RARE (100%), 5% — EPIC (210%). SOL-рельс программы (0.1 / 0.25 / 0.5 SOL, тип выбирает покупатель) в интерфейсе пока не подключён. Это игровая характеристика модуля, а не финансовая доходность.",
  },
  {
    question: "Что такое SKR и $POTATO?",
    answer:
      "SKR — платёжный токен платформы, им оплачиваются модули и экспортные лицензии. $POTATO — игровой токен колонии, который ты выращиваешь в модуле. Сейчас оба токена в devnet. Это не инвестиция, это топливо игровой экономики.",
  },
  {
    question: "Где исходники и как проверить цифры?",
    answer:
      "Проект open source: github.com/Leo88q/ares1. В исходниках devnet V1 сейчас действует legacy-комиссия 9–12% в POTATO с порогом по одному ордеру. Целевая V2-комиссия 9–12% в валюте расчёта и отдельная пара POTATO/SKR — утверждённый продуктовый план, но пока не часть on-chain программы. Остальные параметры, например капы 250K–750K и налог 2–10%, сверяй с исходниками; devnet может отставать от коммита.",
  },
  {
    question: "Что если я перестану играть?",
    answer:
      "Урожай накапливается до 7 суток: если не собирать его дольше, накопление остановится на лимите. Модуль и $POTATO учитываются ончейн. Сейчас игра работает в devnet, программа обновляется — сохранность тестовых активов навсегда не гарантируется.",
  },
  {
    question: "Как работает дефляция?",
    answer:
      "Текущий devnet-контракт V1 сжигает 60% старой комиссии, которую продавец вносит в POTATO при создании ордера; эта схема legacy. Целевая V2-комиссия 9–12% удерживается при успешной сделке из выплаты продавцу в SOL или SKR и идёт в казну — она не сжигает POTATO. Другие игровые расходы могут сжигать POTATO по правилам контракта. Релиз V2 ещё не включён; burn не гарантирует рост цены.",
  },
  {
    question: "Что такое «Операция: Первая теплица»?",
    answer:
      "Это утверждённая 28-дневная кампания из четырёх глав: Посадка, Вода, Ремонт колонии и Первый урожай. Игровой экран сейчас показывает devnet-журнал по текущим on-chain аккаунтам. Сезонные очки, общий рейтинг, награды и архив не активны до отдельного on-chain учёта; тестовый прогресс не переносится в mainnet.",
  },
  {
    question: "Это финансовый инструмент?",
    answer:
      "Нет. $POTATO — утилитарный игровой токен. Мы не обещаем доходности, не гарантируем рост цены и не являемся инвестиционным советом. Играй ответственно, крипто-активы волатильны.",
  },
] as const satisfies readonly FaqItem[];

export const GITHUB_REPO_URL = "https://github.com/Leo88q/ares1";

export const assets = {
  marsFar: "/mars-far.webp",
  marsMid: "/mars-mid.png",
  marsNear: "/mars-near.png",
  dome: "/dome.png",
  tuberIdle: "/tuber9-happy.png",
  tuberJump: "/tuber9-jump.png",
  stars: "/stars.png",
  phobos: "/phobos.png",
  condensation: "/glass-condensation.png",
  ogImage: "/og-image.png",
} as const;

export const gameConfig = {
  platform: "Seeker",
  paymentCurrency: "SKR",
  token: "$POTATO",
  network: "devnet",
  programUpgradeable: true,
  openSource: true,
  storyYear: 2031,
  location: "Долина Маринера",
  colony: "ARES-1",
  totalTokenSupply: 1_000_000_000,
  harvest: {
    // MAX_ACCRUAL_SECONDS в программе = 7 суток (168 ч) с 21.09.2026.
    capacityHours: 168,
  },
  marketplace: {
    minimumOrderPotato: 10,
    devnetLegacy: {
      quoteAssets: ["SOL"],
      feeCurrency: "POTATO",
      feeCollectedAt: "order creation",
    },
    plannedV2: {
      quoteAssets: ["SOL", "SKR"],
      sellerFeePercent: [9, 10, 11, 12],
      sellerVolumeWindowHours: 24,
      feeCollectedAt: "successful fill",
      feeDestination: "treasury in quote asset",
    },
  },
  quests: {
    count: 6,
    fullyOnchain: true,
    backendRequired: false,
    rewardAmountsPotato: [50, 50, 100, 100, 200, 50],
    featured: [
      { title: "Первый росток", rewardPotato: 50 },
      { title: "Фермер-магнат", rewardPotato: 100 },
    ],
  },
  upgrades: {
    durabilityRepair: true,
    fertilizerMultiplier: 1.5,
    fertilizerDurationHours: 24,
    fertilizerPrepayMaxDays: 7,
    maximumLevel: 50,
  },
  referrals: {
    inviteeBurnPotato: 5,
    devnetLegacy: {
      referrerRewardPercentOfAmount: 0.5,
      inviteeFeeDiscountPercentOfAmount: 1,
    },
    plannedV2: {
      settlementFeeDiscountPercent: 0,
      rewardStatus: "not configured",
    },
  },
} as const;

export const motionConfig = {
  reveal: {
    duration: 0.65,
    stagger: 0.08,
    viewportAmount: 0.2,
  },
  reduced: {
    duration: 0.15,
  },
  springs: {
    counter: { stiffness: 60, damping: 20 },
    magnetic: { stiffness: 150, damping: 15 },
    tilt: { stiffness: 180, damping: 24 },
    accordion: { stiffness: 180, damping: 26 },
  },
  hero: {
    typewriterDelayMs: 80,
    parallaxSpeeds: {
      stars: 0.1,
      phobos: 0.2,
      marsFar: 0.4,
      marsMid: 0.6,
      dome: 0.8,
      dust: 1.2,
    },
  },
  magnetic: {
    radiusPx: 80,
    strength: 0.18,
    maxOffsetPx: 18,
  },
  tilt: {
    maximumDegrees: 6,
    scale: 1.02,
  },
  marqueePixelsPerSecond: 50,
  smoothScrollSeconds: 1.2,
  glowPulseSeconds: 2.4,
  meshSeconds: 20,
  scanLineSeconds: 8,
  condensationSeconds: 6,
} as const;

export interface InterstellarConfig {
  readonly ageOfFarmingUrl: string | null;
  readonly status: "planned" | "available";
}

export const interstellarConfig: InterstellarConfig = {
  ageOfFarmingUrl: "https://aof.pages.dev",
  // The external app exists, but no verified ARES-1 ↔ Age of Farming token route is live.
  status: "planned",
};

export const interstellarContent = {
  title: "КОНЦЕПЦИЯ: ARES-1 × NEUROFORGE",
  subtitle: "Планируемая интеграция; мост и переводы $POTATO пока не работают.",
  eyebrow: "ПЛАН МЕЖИГРОВОЙ ИНТЕГРАЦИИ",
  plannedLabel: "ПЛАН · НЕ ЗАПУЩЕНО",
  availableLabel: "Кросс-игра на Solana",
  narrativeLabel: "Художественный лор — не описание функций",
  narrativeNotice:
    "Интеграция ARES-1 ↔ NeuroForge не запущена: нет работающего маршрута, переводов $POTATO, межигрового burn, предметов или наград. Текст ниже — концепция, а не действующая механика.",
  paragraphs: [
    "В художественном сценарии ARES-1 получает сигнал от NeuroForge. Это вымышленная часть лора и не подтверждает работающую связь между приложениями.",
    "Будущий сценарий мог бы использовать $POTATO в отдельных игровых механиках NeuroForge. Сейчас в ARES-1 нет on-chain-маршрута к этому приложению и нет интеграции токена.",
    "Квантовый мост, межигровой burn, крафт, общие предметы и передача достижений недоступны. Их возможный запуск потребует реализации, проверки и отдельного объявления; сроки не обещаны.",
  ],
  mars: {
    name: "ARES-1",
    planet: "МАРС",
    description: "Гидропоника под стеклом. Жизнь под красным небом.",
    benefits: [
      "Урожай $POTATO каждую секунду под марсианским куполом",
      "3 тира модулей: Common, Rare и Epic с шансом мутаций",
      "Планируемая V2-комиссия 9–12% удерживается из seller payout и идёт в казну в SOL/SKR",
      "Лунный цикл из 28 эпох; фактический тайминг зависит от roll_epoch",
      "Операция «Первая теплица»: 28-дневный сезонный план, devnet-журнал без призов пока не подключён on-chain учёт",
    ],
  },
  earth: {
    name: "NeuroForge",
    planet: "ПЛАНИРУЕМАЯ СВЯЗЬ · SOLANA",
    description: "Отдельное приложение; связь с ARES-1 не запущена.",
    benefits: [
      "Перевод $POTATO между ARES-1 и NeuroForge не работает.",
      "Общие предметы, достижения, награды и крафт не подключены.",
      "Межигровой burn и рыночный маршрут не реализованы.",
      "Цифры и механики NeuroForge из лора не подтверждены как функции интеграции.",
    ],
  },
  cta: "Посмотреть статус интеграции",
  gameCta: "Открыть Age of Farming ↗",
  externalAppNotice:
    "Age of Farming — отдельное приложение; переход по ссылке не подключает его к ARES-1.",
  detailsCta: "Подробнее о статусе",
  dialogTitle: "СТАТУС ИНТЕГРАЦИИ",
  dialogDescription:
    "Мост ARES-1 ↔ NeuroForge не запущен: отправить или получить $POTATO здесь нельзя. Внешняя ссылка открывает отдельное приложение Age of Farming, не связанное с этой интеграцией.",
  routeLabel: "ПЛАН · МАРС ↔ NEUROFORGE",
  frequencyLabel: "ЧАСТОТА В ХУДОЖЕСТВЕННОМ ЛОРЕ · 17.42 ГГц",
  transferLabel: "Переводы $POTATO через мост",
  nextFlightLabel: "Дата запуска интеграции",
  noMetrics: "Данные не подключены",
  noSchedule: "Расписание не объявлено",
  plannedMetrics: "Переводы не запущены",
  plannedSchedule: "Запуск не объявлен",
  awaitingSchedule: "Ожидаем официальное объявление",
  plannedNotice:
    "Интеграция не запущена: переводы не выполняются. На этой странице нельзя отправить $POTATO или списать SOL/SKR.",
  openNotice:
    "Внешняя ссылка не связывает приложения и не переводит токены. До подписания любой операции проверьте адрес программы, сеть и условия транзакции.",
  unavailableLink: "Ссылка на отдельное приложение не настроена.",
  close: "Закрыть",
  benefitsLabel: "Статус интеграции",
  benefitHint: "Выберите карточку; кросс-игровые функции пока не подключены.",
} as const;

export const siteContent = {
  header: {
    logo: "POTATO · ARES-1",
    navigation: [
      { label: "Продукт", href: "#product" },
      { label: "Механики", href: "#mechanics" },
      { label: "Операция", href: "#operation" },
      { label: "Токеномика", href: "#tokenomics" },
      { label: "Дорожная карта", href: "#roadmap" },
      { label: "FAQ", href: "#faq" },
    ],
    openMenu: "Открыть меню",
    closeMenu: "Закрыть меню",
    navigationLabel: "Основная навигация",
    homeLabel: "POTATO · ARES-1 — на главную",
    walletNotice:
      "Phantom: подключение читает твой баланс SKR (devnet) и позволяет купить модуль прямо с сайта.",
  },
  hero: {
    title: "ВЫРАСТИ ПЕРВУЮ КАРТОШКУ НА МАРСЕ",
    subtitle:
      "ARES-1 — ончейн-колония на Solana (devnet). Купи гидропонный модуль за 1 053 SKR, расти $POTATO под куполом и торгуй с колонистами. Всего 500 модулей в первой волне — цена и счётчик ниже живые, читаются с devnet.",
    primaryCta: "Купить модуль",
    primaryHref: "#packs",
    secondaryCta: "Открыть игру",
    secondaryHref: "https://ares1-play.pages.dev",
    soldLabel: "0 / 500 модулей продано",
    progressLabel: "Модули первой волны",
    countdownLabel: "Статус волны:",
    countdownUnavailable: "Идёт до распродажи всех 500 модулей",
    countdownEnded: "Волна завершена",
    countdownUnits: {
      days: "дни",
      hours: "часы",
      minutes: "минуты",
      seconds: "секунды",
    },
    sceneLabel: "Колония ARES-1 под стеклянным куполом на Марсе",
    telemetry: {
      colony: "КОЛОНИЯ ARES-1",
      location: "ДОЛИНА МАРИНЕРА",
      year: "2031",
      network: "ТЕСТОВАЯ СЕТЬ · DEVNET",
      price: "1 053 SKR / МОДУЛЬ",
    },
    presaleNotice:
      "Покупка модуля — реальная devnet-транзакция (1 053 SKR). В devnet SOL и SKR — тестовые монеты, реальной стоимости не имеют.",
  },
  story: {
    text:
      "2031 год. Колония ARES-1 под стеклянным куполом в долине Маринера. Земля далеко, грузы идут месяцами. Единственная стабильная еда — картофель, выращенный в гидропонных модулях под искусственным солнцем. Каждый колонист получает свой модуль, растит картошку, собирает $POTATO, торгует с соседями, улучшает ферму и ждёт следующий груз с Земли.",
  },
  problem: {
    title: "ПОЧЕМУ ОБЫЧНЫЕ ФЕРМЫ УМИРАЮТ",
    before: {
      title: "БЫЛО",
      items: [
        "Офчейн-базы данных, которые могут закрыть в любой момент",
        "Команда решает, сколько ты заработал",
        "Продай токен — и рынок рухнет",
      ],
    },
    after: {
      title: "СТАЛО",
      items: [
        "100% ончейн на Solana: программа открыта (GitHub), код читается",
        "Урожай считает блокчейн, а не человек",
        "Текущий devnet-контракт — legacy; целевая комиссия V2 удерживается из выплаты продавцу в SOL/SKR и идёт в казну, а не сжигает $POTATO",
      ],
    },
  },
  mechanics: {
    title: "МЕХАНИКИ КОЛОНИИ",
  },
  mascot: {
    title: "ЗНАКОМЬСЯ: ТЮБЕР-9",
    text:
      "Главный агроном колонии ARES-1. Родился в гидропонной лаборатории модуля №7, прошёл отбор среди 10 000 клубней, получил скафандр и диплом по марсианской ботанике. Любит прыгать в низкой гравитации, шутить про компрессию данных и напоминать, что «картошка — это не еда, это валюта». Кликни по нему — он прыгнет.",
    counterLabel: "прыжков за сессию:",
    imageAlt: "ТЮБЕР-9 — картофелина-космонавт в оранжевом скафандре ARES",
    buttonLabel: "Попросить ТЮБЕР-9 прыгнуть",
    dustNote: "Собирает космическую пыль и шутит про гравитацию.",
  },
  tokenomics: {
    title: "ЭКОНОМИКА $POTATO",
    subtitle:
      "Утилитарный токен колонии. Потолок supply: 1 000 000 000 — premine нет, весь токен эмитуется игроками",
    deflation:
      "Текущий devnet V1 сжигает часть legacy-комиссии рынка в POTATO. В целевой V2-модели 9–12% от settlement-суммы удерживается из выплаты продавцу и отправляется в казну в SOL или SKR — без burn POTATO. Налог на harvest и игровые действия могут сжигать POTATO по правилам контракта. V2 пока не развёрнута; burn не обещает рост стоимости.",
  },

  roadmap: {
    title: "ПУТЬ КОЛОНИИ",
    completedLabel: "Выполнено",
    plannedLabel: "Запланировано",
  },
  social: {
    title: "ТЕЛЕМЕТРИЯ КОЛОНИИ · LIVE",
    subtitle:
      "Все цифры ниже читаются напрямую с devnet-цепи Solana (общий RPC, обновление каждые 60 секунд). Никаких накрученных счётчиков.",
    stats: {
      sold: "модулей продано",
      fields: "активных полей",
      players: "игроков с полями",
      burned: "POTATO сожжено",
      supply: "текущий supply $POTATO",
      treasury: "SOL в казне колонии",
    },
    liveTag: "LIVE",
    offline: "Сеть devnet недоступна прямо сейчас — показаны данные из кэша. Проверь консоль / RPC.",
  },
  faq: {
    title: "ОТВЕТЫ КОЛОНИИ",
  },
  footer: {
    copyright: "© 2026 ARES-1 Colony · Построено на Solana (devnet)",
    links: [
      { label: "Исходный код", href: GITHUB_REPO_URL },
      { label: "Игра", href: playConfig.url },
      { label: "Devnet-программа", href: "https://explorer.solana.com/address/DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf?cluster=devnet" },
    ],
    navigationLabel: "Информация о проекте",
    disclaimer:
      "$POTATO — игровой утилитарный токен проекта Potato Farm: ARES-1. Не является ценной бумагой, инвестиционным советом или предложением о покупке активов. Используйте ответственно. Крипто-активы волатильны, их стоимость может упасть до нуля. Игра предназначена для лиц 18+.",
  },
  accessibility: {
    skipToContent: "Перейти к содержимому",
    closeNotification: "Закрыть уведомление",
    externalUnavailable: "Ссылка будет опубликована позже.",
  },
  seo: {
    title: "Potato Farm: ARES-1 — картофельная колония на Марсе",
    description:
      "ARES-1 — ончейн-колония на Solana (devnet). Выращивай картофель под марсианским куполом, собирай $POTATO и торгуй с колонистами. Платежи за SKR — 1 053 за модуль.",
    ogTitle: "ВЫРАСТИ ПЕРВУЮ КАРТОШКУ НА МАРСЕ",
    ogDescription:
      "500 гидропонных модулей первой волны. Марсианская колония ARES-1, игровая экономика $POTATO и платежи в SKR. Сейчас в devnet.",
    ogImageAlt: "Картофельная колония ARES-1 под куполом на Марсе",
  },
} as const;

export function formatNumber(value: number): string {
  let locale = "ru-RU";
  try {
    // Ленивый импорт, чтобы не создавать цикл content ↔ i18n на уровне модулей.
    const mod = i18nCore;
    locale = LOCALES[mod.getLang()] ?? "ru-RU";
  } catch {
    /* i18n ещё не инициализирован */
  }
  return new Intl.NumberFormat(locale).format(value);
}
