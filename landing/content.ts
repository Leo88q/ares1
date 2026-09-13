export interface TokenAllocation {
  readonly label: string;
  readonly percent: number;
  readonly highlight?: boolean;
}

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

export interface SocialLink {
  readonly id: "telegram" | "x" | "discord";
  readonly label: string;
  readonly href: string;
}

export interface PresaleConfig {
  readonly priceSkr: number;
  readonly sold: number;
  readonly supply: number;
  readonly endsAt: string | null;
  readonly network: "devnet";
}

export const presale = {
  priceSkr: 1053,
  sold: 47,
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
      "Каждую секунду твой модуль генерирует $POTATO. Копи до 48 часов, забирай одним харвестом. Чем выше уровень — тем быстрее капает.",
  },
  {
    id: "day-night",
    label: "ДЕНЬ/НОЧЬ",
    icon: "sun-phobos",
    title: "СОЛНЦЕ МАРСА",
    description:
      "Реальный цикл дня и ночи по твоим часам. Днём урожай +40%, ночью — тишина и звёзды. Лови «золотой час» на рассвете.",
  },
  {
    id: "marketplace",
    label: "СНАБЖЕНИЕ (РЫНОК)",
    icon: "scales",
    title: "ТОРГОВАЯ БИРЖА КОЛОНИИ",
    description:
      "Прогрессивная комиссия: от 9% до 12% в зависимости от объёма сделки. 60% сжигается навсегда, 40% идёт в казну колонии на инфраструктуру. Минимум 10 POTATO в ордере.",
  },
  {
    id: "referrals",
    label: "ВЫЗВАТЬ ПОСЕЛЕНЦА",
    icon: "helmets",
    title: "ПРИВЕДИ СОСЕДА",
    description:
      "Регистрация реферера стоит 5 POTATO (burn). Получай 0.5% от каждой сделки приглашённого на бирже. Ему — скидка 1% на комиссию.",
  },
  {
    id: "lunar-cycle",
    label: "ЛУННЫЙ ЦИКЛ",
    icon: "sun-phobos",
    title: "ФАЗЫ ФОБОСА",
    description:
      "28 эпох по 24 часа. Множитель эмиссии от 0.85× (новолуние) до 1.15× (полнолуние). Планируй харвесты под пик цикла.",
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
      "Случайные мутации при покупке модуля. Golden (+25% к урожаю) и Silicon (половина скорости деградации). Редкие экземпляры ценятся на бирже.",
  },
  {
    id: "export-license",
    label: "ЭКСПОРТНАЯ ЛИЦЕНЗИЯ",
    icon: "scales",
    title: "СВОБОДА ТОРГОВЛИ",
    description:
      "Купи лицензию на 30 дней за 500 SKR и получи скидку 3% на комиссию биржи. Для активных трейдеров — обязательный инструмент.",
  },
] as const satisfies readonly ColonyFeature[];

export const tokenAllocation = [
  { label: "Пресейл колонистам", percent: 30, highlight: true },
  { label: "Награды за квесты", percent: 20 },
  { label: "Межигровая ликвидность · Age of Farming", percent: 20 },
  { label: "Команда (вестинг 24 мес)", percent: 15 },
  { label: "Маркетинг и партнёрства", percent: 10 },
  { label: "Резервный фонд", percent: 5 },
] as const satisfies readonly TokenAllocation[];

// ── Модель Фазы 1: майнинг принадлежит игрокам, аллокации нет ──
export const tokenCycle = {
  manifesto: "100% POTATO РОЖДАЕТСЯ В РУКАХ ИГРОКОВ",
  manifestoSub:
    "Миллиард — это потолок, а не обещание. Supply растёт ровно настолько, насколько вы майните, и уменьшается с каждой комиссией.",
  birth: {
    title: "РОЖДЕНИЕ · MINT",
    items: [
      "Харвест: эластичный кап эпохи 250–750K POTATO",
      "Лунный цикл: множитель эмиссии 0.85×–1.15×",
      "Квесты: награды минтит только сервер, не клиент",
      "Реферал: 0.5% комиссии минтится рефереру",
    ],
  },
  flow: {
    title: "ОБРАЩЕНИЕ",
    items: [
      "Кошельки колонистов и накопления на модулях",
      "Escrow-ордера торговой биржи",
      "Мост в Age of Farming: только burn, без пулов ликвидности",
    ],
  },
  death: {
    title: "СМЕРТЬ · BURN",
    items: [
      "60% комиссии рынка (9–12% от объёма)",
      "Налог на харвест: 2–10% по мере роста supply",
      "Ремонт, улучшения, удобрения",
      "Регистрация реферера: 5 POTATO",
      "Рецепты и ритуалы Age of Farming",
    ],
  },
  teamNote:
    "Команда не майнит POTATO. Доход команды — пресейл модулей и экспортные лицензии в SKR. В эмиссии нет скрытых кошельков.",
  treasuryNote:
    "40% комиссии рынка уходит в казну колонии (PDA программы) — на инфраструктуру и события, не в карман команды.",
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
  /** Заполнить адресом минта $POTATO из devnet-конфига программы */
  potatoMint: null as string | null,
  maxSupply: 1_000_000_000,
  /** Program ID лендинга и игры — один и тот же контракт */
  programId: "48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha" as string,
  /** SKR минт (devnet test) */
  skrMint: "HnKpKz5sSfMqRcPjwQZmKqGqHqZmKqGqHqZmKqGqHqZm" as string,
  /** Цена модуля в presale: 1053 SKR = 1053 * 1e6 atoms */
  presalePriceSkrAtoms: 1_053_000_000n as bigint,
} as const;

export interface AofSink {
  readonly id: string;
  readonly cost: number;
  readonly tag: string;
  readonly title: string;
  readonly description: string;
  readonly lore: string;
}

export const aofBridge = {
  eyebrow: "ДВА МИРА — ОДИН КОРНЕПЛОД",
  title: "Где $POTATO сгорает вне колонии",
  intro:
    "ARES-1 — не единственный мир, где растёт $POTATO. В Age of Farming марсианский клубень — ресурс из другого мира: его пекут в коллаборационные рецепты, сжигают ради ускорения, меняют на предметы, которых нет в природе. Каждый межигровой расход — burn без возврата: картошка уходит из предложения навсегда, связывая экономики двух миров в один дефляционный контур.",
  footnote:
    "Межигровые расходы раскрываются по мере интеграции ARES-1 и Age of Farming. Цифры и рецепты выше — целевой дизайн: точные механики фиксируются в клиенте к моменту релиза. Все перечисленные расходы — burn: предложение $POTATO уменьшается в обоих мирах.",
  ritualNotice:
    "Художественный текст сайта, не инструкция сети. Не подписывай транзакции с условиями «обмена», пока механика не появилась в официальном клиенте.",
} as const;

export const aofSinks = [
  {
    id: "craft",
    cost: 3,
    tag: "CRAFT · КОЛЛАБОРАЦИОННЫЕ РЕЦЕПТЫ",
    title: "Картофельный пир, ритуальный хлеб, сезонный эликсир",
    description:
      "Расходуется в особых рецептах: каждый рецепт сжигает определённое количество POTATO.",
    lore:
      "В печи POTATO ведёт себя как обычный корнеплод: румянится, пахнет, отдаёт жар. Но знающие мастера видят: когда он сгорает, в дыму мелькают силуэты из другого мира. Это не магия — это память токена.",
  },
  {
    id: "boost",
    cost: 5,
    tag: "BOOST · УСКОРЕНИЕ ПРОЦЕССОВ",
    title: "Минус 20% времени активности",
    description:
      "Сжигание 5 POTATO сокращает время текущей активности на 20%: рост урожая, перемол, ковку. Не работает на аукционах и PvP.",
    lore:
      "POTATO горит быстро и ярко, как солома. За эти несколько секунд игровое время сжимается. Мастера используют его перед длинными сменами, когда нужно успеть больше, чем позволяет день.",
  },
  {
    id: "cosmetic",
    cost: 10,
    tag: "COSMETIC · КОСМЕТИЧЕСКИЕ ПРЕДМЕТЫ",
    title: "Скин «Пришелец» и украшения верстака",
    description:
      "Обмен 10 POTATO на уникальный скин инструмента или украшение верстака. Предметы не дают игровых преимуществ — только визуал.",
    lore:
      "Скин «Пришелец» на топоре: лезвие покрыто узором, которого нет в природе AOF. Это след другого мира. Кто-то коллекционирует такие предметы, кто-то смеётся над ними. Но все признают: это красиво.",
  },
  {
    id: "access",
    cost: 1,
    tag: "ACCESS · СПЕЦИАЛЬНЫЕ СОБЫТИЯ",
    title: "Билет к гостям из других миров",
    description:
      "Билет на сезонные коллаборационные события: турниры, совместные квесты, встречи с NPC-гостями из других игр.",
    lore:
      "Один POTATO — один билет. События длятся несколько дней, и POTATO сгорает в момент входа. Мастера говорят: «Лучше прийти с одной картошкой, чем не прийти вовсе».",
  },
  {
    id: "ritual",
    cost: 10,
    tag: "RITUAL · ОБМЕН НА SKR",
    title: "Ритуал благодарности",
    description:
      "Художественный образ: «10 POTATO + Love Heart → 50 SKR». Это не рыночный обмен — это ритуал благодарности.",
    lore:
      "Два токена из разных миров встречаются на верстаке, сгорают вместе, оставляя медные монеты. Мастера проводят его в полнолуние, без свидетелей.",
  },
] as const satisfies readonly AofSink[];

export const roadmap = [
  {
    period: "Q1 2026",
    title: "ЗАПУСК ПРЕСЕЙЛА",
    done: true,
    description:
      "500 модулей первой волны, ончейн на Seeker devnet, интеграция SKR-платежей, маркетплейс.",
  },
  {
    period: "Q2 2026",
    title: "ПОЛНАЯ ЭКОНОМИКА",
    done: false,
    description:
      "6 ончейн-квестов, система удобрений, налоги, прокачка до уровня 10.",
  },
  {
    period: "Q3 2026",
    title: "ГРУЗ С ЗЕМЛИ",
    done: false,
    description:
      "Сезонные события, турниры колонистов, штормы (эпизодические события с риском потерь). Мутации Golden/Silicon уже реализованы в Фазе 1.",
  },
  {
    period: "Q4 2026",
    title: "MAINNET ARES-1",
    done: false,
    description:
      "Переход на mainnet Seeker, листинг $POTATO на DEX, мобильное приложение, партнёрства.",
  },
] as const satisfies readonly RoadmapMilestone[];

export const faq = [
  {
    question: "Что такое ARES-1?",
    answer:
      "Первая ончейн-колония на Марсе в экосистеме Seeker. Ты покупаешь гидропонный модуль, растишь картофель под куполом, получаешь $POTATO и торгуешь с другими колонистами. Игровые механики работают в блокчейне, исходники открыты. Сейчас проект работает в devnet, программа может обновляться.",
  },
  {
    question: "Зачем покупать модуль в пресейле?",
    answer:
      "Первая волна — 500 модулей по цене 1 053 SKR. Пресейл даёт случайный тир: 70% шанс получить COMMON, 25% — RARE, 5% — EPIC. Игровой показатель урожая EPIC — 210%, в 6 раз больше COMMON. Это характеристика модуля, а не финансовая доходность.",
  },
  {
    question: "Что такое SKR и $POTATO?",
    answer:
      "SKR — внутренняя валюта экосистемы Seeker, ей ты платишь за модули и ордера. $POTATO — игровой токен колонии, который ты выращиваешь в модуле. Это не инвестиция, это топливо игровой экономики.",
  },
  {
    question: "Что если я перестану играть?",
    answer:
      "Урожай накапливается до 48 часов: если не собирать его дольше, накопление остановится на лимите. Модуль и $POTATO учитываются ончейн. Сейчас игра работает в devnet, программа обновляется — сохранность тестовых активов навсегда не гарантируется.",
  },
  {
    question: "Как работает дефляция?",
    answer:
      "С каждой сделки на маркетплейсе 60% комиссии сжигается безвозвратно, а 40% уходит в казну колонии. Дополнительно сгорают налог на харвест, ремонт, улучшения, удобрения, экспортные лицензии и регистрация рефереров. Сжигание уменьшает предложение $POTATO. Это механика игры, а не гарантия роста цены: стоимость зависит не только от количества токенов.",
  },
  {
    question: "Это финансовый инструмент?",
    answer:
      "Нет. $POTATO — утилитарный игровой токен. Мы не обещаем доходности, не гарантируем рост цены и не являемся инвестиционным советом. Играй ответственно, крипто-активы волатильны.",
  },
] as const satisfies readonly FaqItem[];

export const socialLinks = [
  { id: "telegram", label: "Telegram", href: "#" },
  { id: "x", label: "X", href: "#" },
  { id: "discord", label: "Discord", href: "#" },
] as const satisfies readonly SocialLink[];

export const testimonials = [
  {
    handle: "@astro_farm",
    quote: "первый EPIC-модуль, это законно вообще?",
  },
  {
    handle: "@martian_potato",
    quote: "собрал 400 POTATO за неделю, торгую на бирже",
  },
  {
    handle: "@seeker_daily",
    quote: "ARES-1 — самый честный ончейн-проект квартала",
  },
  {
    handle: "@hydro_queen",
    quote: "Редкий RARE выпал с третьего модуля, удача!",
  },
  {
    handle: "@tuber9_fan",
    quote: "ТЮБЕР-9 — мой новый маскот, прыгает мило",
  },
] as const;

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
    capacityHours: 48,
    daylightBonusPercent: 40,
  },
  dayCycle: [
    { id: "dawn", label: "Рассвет", startHour: 5, endHour: 8 },
    { id: "day", label: "День", startHour: 8, endHour: 17 },
    { id: "sunset", label: "Синий закат", startHour: 17, endHour: 20 },
    { id: "night", label: "Ночь", startHour: 20, endHour: 5 },
  ],
  marketplace: {
    minimumOrderPotato: 10,
    minimumPaymentSkr: 1,
    treasuryFeeSharePercent: 80,
    burnedFeeSharePercent: 20,
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
    taxIntervalDays: 7,
    maximumPlannedLevel: 10,
  },
  referrals: {
    firstModuleRewardPercent: 10,
    marketplaceRewardPercent: 5,
    rewardCurrency: "$POTATO",
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
  ageOfFarmingUrl: null,
  status: "planned",
};

export const interstellarContent = {
  title: "ОДИН ТОКЕН — ДВЕ ИМПЕРИИ",
  subtitle: "$POTATO пересёк границу ARES-1",
  eyebrow: "МЕЖПЛАНЕТНАЯ ЭКОНОМИКА",
  plannedLabel: "Интеграция готовится",
  availableLabel: "Игровой переход доступен",
  narrativeLabel: "Художественный лор интеграции",
  narrativeNotice:
    "Описание целевого игрового сценария. Доступность переводов, предметов и наград зависит от фактически запущенных механик обеих игр.",
  paragraphs: [
    "Когда инженеры колонии ARES-1 впервые расшифровали сигнал с Земли, они не поверили своим датчикам. На частоте 17.42 ГГц, сквозь космическую пыль и радиацию, шёл чистый цифровой поток. Это была вторая колония. Age of Farming — земная ферма нового поколения, построенная на тех же принципах ончейн-прозрачности.",
    "Сигнал нёс не координаты и не инструкции. Сигнал нёс токен. Тот самый $POTATO, который колонисты ARES-1 выращивали под марсианским куполом, теперь имел значение и на Земле. Один токен — две реальности. Один кошелёк — две империи.",
    "Отныне картошка, собранная под красным солнцем Марса, может быть отправлена через квантовый мост на земные поля Age of Farming. Там она превращается в семена редких культур, удобрения нового поколения, артефакты фермерской легенды. И наоборот: земные достижения Age of Farming открывают эксклюзивные модули в ARES-1. Экономика стала межпланетной.",
  ],
  mars: {
    name: "ARES-1",
    planet: "МАРС",
    description: "Гидропоника под стеклом. Жизнь под красным небом.",
    benefits: [
      "Урожай $POTATO под марсианским куполом",
      "Эксклюзивные модули за земные достижения",
      "Один игровой токен для двух миров",
    ],
  },
  earth: {
    name: "Age of Farming",
    planet: "ЗЕМЛЯ",
    description: "Земные поля. Новые культуры. Та же история.",
    benefits: [
      "Сгорает в коллаборационных рецептах и сезонных эликсирах",
      "Ускоряет урожай, перемол и ковку",
      "Меняется на косметику и украшения верстака",
      "Открывает билеты на совместные события и турниры",
      "Каждый расход — burn без возврата",
    ],
  },
  cta: "ПЕРЕВЕЗТИ $POTATO НА ЗЕМЛЮ",
  gameCta: "Открыть Age of Farming",
  detailsCta: "Как работает мост",
  dialogTitle: "КВАНТОВЫЙ МОСТ",
  dialogDescription:
    "Связь между ARES-1 и Age of Farming. Здесь появятся доступные маршруты, правила обмена и подтверждённая статистика.",
  routeLabel: "МАРС ↔ ЗЕМЛЯ",
  frequencyLabel: "ЧАСТОТА СИГНАЛА · 17.42 ГГц",
  transferLabel: "Перевезено через мост",
  nextFlightLabel: "Следующий рейс",
  noMetrics: "Данные не подключены",
  noSchedule: "Расписание не объявлено",
  awaitingSchedule: "Ожидаем обновление расписания",
  plannedNotice:
    "Мост пока не выполняет переводы. На этой странице нельзя списать SKR или отправить $POTATO.",
  openNotice:
    "Открытие второй игры не переводит токены. Любая операция с активами требует отдельного подтверждения и доступной игровой механики.",
  unavailableLink: "Адрес Age of Farming ещё не опубликован.",
  close: "Закрыть",
  benefitsLabel: "Возможности интеграции",
  benefitHint: "Наведи курсор, выбери планету или перейди к ней клавишей Tab.",
  reserve:
    "20% токенов $POTATO зарезервированы под кросс-игровую экономику с Age of Farming — межпланетная ликвидность без посредников.",
  reserveNotice:
    "Это назначение существующей доли ликвидности, а не дополнительная эмиссия. Реализация и условия использования резерва требуют подтверждения в опубликованных правилах проекта.",
  transferSuccess:
    "✓ Квантовый мост активирован. Твои $POTATO уже на полях Age of Farming.",
} as const;

export const siteContent = {
  header: {
    logo: "POTATO · ARES-1",
    navigation: [
      { label: "Механики", href: "#mechanics" },
      { label: "Токеномика", href: "#tokenomics" },
      { label: "Дорожная карта", href: "#roadmap" },
      { label: "FAQ", href: "#faq" },
    ],
    wallet: "⬡ Подключить кошелёк",
    openMenu: "Открыть меню",
    closeMenu: "Закрыть меню",
    navigationLabel: "Основная навигация",
    homeLabel: "POTATO · ARES-1 — на главную",
    walletNotice:
      "Подключение кошелька появится после интеграции с Seeker.",
  },
  hero: {
    title: "ВЫРАСТИ ПЕРВУЮ КАРТОШКУ НА МАРСЕ",
    subtitle:
      "ARES-1 — первая ончейн-колония на Seeker. Купи гидропонный модуль за 1 053 SKR, расти $POTATO под куполом и торгуй с колонистами. Всего 500 модулей в первой волне.",
    primaryCta: "⚡ Войти в пресейл",
    primaryHref: "#waitlist",
    secondaryCta: "◈ Читать whitepaper",
    secondaryHref: "#",
    soldLabel: "47 / 500 модулей продано",
    progressLabel: "Модули первой волны",
    countdownLabel: "До конца волны:",
    countdownUnavailable: "Дата завершения волны пока не объявлена",
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
      "На этой странице нет оплаты. Форма ниже — запись на следующую волну пресейла.",
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
        "100% ончейн на Seeker: программа открыта, код читается",
        "Урожай считает блокчейн, а не человек",
        "Дефляция через сжигание: 60% комиссии каждой сделки уменьшает предложение $POTATO",
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
      "Утилитарный токен колонии. Общее предложение: 1 000 000 000",
    deflation:
      "Механика дефляции: 60% комиссии с маркетплейса сжигается навсегда, 40% уходит в казну колонии. Дополнительно сжигаются: налог на харвест, ремонт модулей, улучшения, удобрения, экспортные лицензии, регистрация рефереров. Каждая транзакция уменьшает предложение $POTATO, но не гарантирует рост его стоимости.",
    distributionLabel: "Распределение предложения $POTATO",
    allocationColumn: "Назначение",
    percentColumn: "Доля",
  },
  roadmap: {
    title: "ПУТЬ КОЛОНИИ",
    completedLabel: "Выполнено",
    plannedLabel: "Запланировано",
  },
  social: {
    title: "КОЛОНИЯ РАСТЁТ",
    colonistsCount: 12847,
    counterSuffix: "колонистов уже на Марсе",
    counterText: "12 847 колонистов уже на Марсе",
    linksLabel: "Сообщества колонии",
    testimonialsLabel: "Отзывы колонистов",
    demoNotice:
      "Демонстрационные данные: счётчик и отзывы из концепции лендинга, не проверенная статистика.",
    contentVerified: false,
  },
  faq: {
    title: "ОТВЕТЫ КОЛОНИИ",
  },
  waitlist: {
    title: "СТАНЬ КОЛОНИСТОМ ПЕРВЫМ",
    subtitle:
      "Оставь контакт — получишь ранний доступ к следующей волне пресейла и 100 $POTATO на старте.",
    emailLabel: "Электронная почта",
    telegramLabel: "Телеграм",
    emailPlaceholder: "колонист@ares1.mars",
    telegramPlaceholder: "@tuber9_fan",
    telegramHint: "Можно вставить имя с @ — уберём символ автоматически.",
    idle: "⚡ Занять место в шлюзе",
    loading: "⏳ Сканируем биометрию...",
    success:
      "✓ Добро пожаловать в ARES-1! Проверь почту — там твой пропуск.",
    demoSuccess:
      "✓ Контакт проверен. Это деморежим: заявка не отправлена, письмо и токены не начислены.",
    demoNotice:
      "Демонстрационная форма: данные не отправляются и не сохраняются после закрытия страницы.",
    emailError:
      "Некорректный email. Марсианская почта должна быть земной.",
    telegramError:
      "Юзернейм без @, только латиница и цифры, 5+ символов",
    submitError:
      "Не удалось завершить проверку. Попробуй ещё раз.",
    retryLabel: "Попробовать снова",
    mode: "demo",
  },
  footer: {
    copyright: "© 2026 ARES-1 Colony · Построено на Seeker",
    links: [
      { label: "Whitepaper", href: "#" },
      { label: "GitHub", href: "#" },
      { label: "Контакты", href: "#" },
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
      "ARES-1 — первая ончейн-колония на Seeker. Выращивай картофель под марсианским куполом, собирай $POTATO и торгуй с колонистами за SKR.",
    ogTitle: "ВЫРАСТИ ПЕРВУЮ КАРТОШКУ НА МАРСЕ",
    ogDescription:
      "500 гидропонных модулей первой волны. Марсианская колония ARES-1, игровая экономика $POTATO и платежи в SKR. Сейчас в devnet.",
    ogImageAlt: "Картофельная колония ARES-1 под куполом на Марсе",
  },
} as const;

export const numberFormatter = new Intl.NumberFormat("ru-RU");

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}
