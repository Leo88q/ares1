
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
      "Каждую секунду твой модуль генерирует $POTATO. Копи до 48 часов, забирай одним харвестом. Чем выше уровень — тем быстрее капает.",
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
      "Ссылка бесплатна. Новый игрок открывает её — регистрируется ончейн автоматически: с его баланса разово сгорает 5 POTATO (антиспам). Тебе — 0.5% от суммы его сделок на бирже, ему — −1% от суммы из комиссии.",
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
      "При улучшении поля 5% шанс мутации: Golden Sprout (3%) — +25% к урожаю навсегда, Silicon Skin (2%) — износ прочности в 2 раза медленнее.",
  },
  {
    id: "export-license",
    label: "ЭКСПОРТНАЯ ЛИЦЕНЗИЯ",
    icon: "scales",
    title: "СВОБОДА ТОРГОВЛИ",
    description:
      "500 SKR за 30 дней, продлевается. Пока лицензия активна, −3% от суммы ордера вычитается из комиссии маркета при каждой твоей продаже.",
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
    "Миллиард — это потолок, а не обещание. Supply растёт ровно настолько, насколько вы майните, и уменьшается с каждой комиссией.",
  birth: {
    title: "РОЖДЕНИЕ · MINT",
    items: [
      "Харвест: эластичный кап эпохи 250–750K POTATO",
      "Лунный цикл: множитель эмиссии 0.85×–1.15×",
      "Квесты: награды минтит только сервер, не клиент",
      "Реферал: 0.5% от суммы сделки платится рефереру из эскроу ордера (без свежего минта)",
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
      "60% комиссии рынка (комиссия 9–12% от объёма ордера)",
      "Налог на харвест 2–10%: половина сгорает, половина — в казну",
      "Ремонт, улучшения, удобрения",
      "Регистрация приглашённого по реферальной ссылке: 5 POTATO",
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
      "500 модулей первой волны, ончейн на Solana devnet: платежи SOL/SKR, маркетплейс, рефералка, экспортные лицензии.",
  },
  {
    period: "Q2 2026",
    title: "ПОЛНАЯ ЭКОНОМИКА",
    done: true,
    description:
      "6 ончейн-квестов (пул 550 POTATO), удобрения, растущий налог, мутации Golden/Silicon, прокачка поля до 50 уровня. Всё работает на devnet.",
  },
  {
    period: "Q3 2026",
    title: "ГРУЗ С ЗЕМЛИ",
    done: false,
    description:
      "Сезонные события, турниры колонистов, штормы (эпизодические события с риском потерь).",
  },
  {
    period: "Q4 2026",
    title: "MAINNET ARES-1",
    done: false,
    description:
      "Переход на mainnet Solana, листинг $POTATO на DEX, мобильное приложение, партнёрства.",
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
      "Первая волна — 500 модулей по 0.25 SOL или 1 053 SKR. Тип модуля роллится ончейн случайно: 70% — COMMON (урожай 35%), 25% — RARE (100%), 5% — EPIC (210%). Это игровая характеристика модуля, а не финансовая доходность.",
  },
  {
    question: "Что такое SKR и $POTATO?",
    answer:
      "SKR — платёжный токен платформы, им оплачиваются модули (альтернатива SOL) и экспортные лицензии. $POTATO — игровой токен колонии, который ты выращиваешь в модуле. Сейчас оба токена в devnet. Это не инвестиция, это топливо игровой экономики.",
  },
  {
    question: "Где исходники и как проверить цифры?",
    answer:
      "Проект open source: github.com/Leo88q/ares1. Вся экономика — в программе (constants: комиссия 9–12%, капы 250K–750K, налог 2–10%, мутации 5%). Все цифры на этом сайте совпадают с кодом и живым состоянием devnet-цепи.",
  },
  {
    question: "Что если я перестану играть?",
    answer:
      "Урожай накапливается до 48 часов: если не собирать его дольше, накопление остановится на лимите. Модуль и $POTATO учитываются ончейн. Сейчас игра работает в devnet, программа обновляется — сохранность тестовых активов навсегда не гарантируется.",
  },
  {
    question: "Как работает дефляция?",
    answer:
      "С каждой сделки на маркетплейсе 60% комиссии сжигается безвозвратно, а 40% уходит в казну колонии (PDA программы). Дополнительно сгорают: половина налога на харвест, ремонт, улучшения, удобрения и разовая регистрация приглашённого (5 POTATO). Экспортные лицензии платятся в SKR, $POTATO они не сжигают. Сжигание уменьшает предложение $POTATO. Это механика игры, а не гарантия роста цены: стоимость зависит не только от количества токенов.",
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
    capacityHours: 48,
  },
  marketplace: {
    minimumOrderPotato: 10,
    minimumPaymentSkr: 1,
    treasuryFeeSharePercent: 40,
    burnedFeeSharePercent: 60,
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
    referrerRewardPercentOfAmount: 0.5,
    inviteeFeeDiscountPercentOfAmount: 1,
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
      "Phantom: подключение читает твой баланс SKR (devnet) и позволяет купить модуль прямо с сайта.",
  },
  hero: {
    title: "ВЫРАСТИ ПЕРВУЮ КАРТОШКУ НА МАРСЕ",
    subtitle:
      "ARES-1 — ончейн-колония на Solana (devnet). Купи гидропонный модуль за 0.25 SOL или 1 053 SKR, расти $POTATO под куполом и торгуй с колонистами. Всего 500 модулей в первой волне — цена и счётчик ниже живые, читаются с devnet.",
    primaryCta: "⚡ Купить модуль",
    primaryHref: "#packs",
    secondaryCta: "◈ Открыть игру",
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
      price: "0.25 SOL · 1 053 SKR / МОДУЛЬ",
    },
    presaleNotice:
      "Покупка модуля — реальная devnet-транзакция (0.25 SOL или 1 053 SKR). В devnet SOL и SKR — тестовые монеты, реальной стоимости не имеют.",
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
      "Утилитарный токен колонии. Потолок supply: 1 000 000 000 — premine нет, весь токен эмитуется игроками",
    deflation:
      "Механика дефляции: 60% комиссии с маркетплейса сжигается навсегда, 40% уходит в казну колонии (PDA программы). Дополнительно сгорают: половина налога на харвест, ремонт модулей, улучшения, удобрения и регистрация приглашённых. Экспортные лицензии оплачиваются в SKR. Каждая транзакция уменьшает предложение $POTATO, но не гарантирует рост его стоимости.",
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
      "ARES-1 — ончейн-колония на Solana (devnet). Выращивай картофель под марсианским куполом, собирай $POTATO и торгуй с колонистами. Платежи 0.25 SOL / 1 053 SKR.",
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
