/**
 * Словарь панелей глубокого слоя. RU и EN обязаны иметь один и тот же набор
 * ключей — это проверяет `tests/offchain/deepCopyParity.test.ts`.
 * SIM-кредиты везде называются кредитами: это игровой бюджет, не токен POTATO.
 */
const en = {
  systems: 'Systems',
  crew: 'Crew', tasks: 'Queue', stores: 'Stores', extraction: 'Extraction',
  life: 'Life support', greenhouse: 'Greenhouse', lab: 'Lab',
  repair: 'Repair', contracts: 'Contracts', journal: 'Journal',

  empty: 'The deep layer starts on the first day.',
  noWorld: 'No deep-sim state yet. Advance one day.',

  // Экипаж
  crewTitle: 'Crew and assignments',
  specialty: 'Specialty', fatigue: 'Fatigue', health: 'Condition',
  task: 'Task', idle: 'idle', hours: 'h available',
  foodDebt: 'food debt', sols: 'sols',

  // Очередь работ
  queueTitle: 'Task queue',
  queueNote: 'Lower priority number runs first. A manual priority overrides the automatic one.',
  target: 'Target', progress: 'Progress', status: 'Status', priority: 'Priority',
  blockedBy: 'Blocked', auto: 'auto', manual: 'manual',
  pause: 'Pause', resume: 'Resume', raise: 'Raise', lower: 'Lower', resetPrio: 'Auto',
  statusQueued: 'queued', statusActive: 'active', statusBlocked: 'blocked', statusPaused: 'paused',

  // Склады
  storesTitle: 'Stores and reserves',
  storesNote: 'Every stock has a capacity. What does not fit is not produced.',
  resource: 'Resource', amount: 'Amount', cap: 'Capacity', reserved: 'Reserved',

  // Добыча
  extractionTitle: 'Deposits and haulage',
  deposit: 'Deposit', distance: 'Distance', estimate: 'Estimated', confidence: 'Surveyed',
  accessible: 'Accessible', workable: 'Workable', reason: 'Reason',
  haulJobs: 'Haul jobs', vehicle: 'Machine', phase: 'Phase', cargo: 'Cargo',
  km: 'km', yes: 'yes', no: 'no',
  phaseToPickup: 'to pickup', phaseLoading: 'loading', phaseToDrop: 'to base',
  phaseUnloading: 'unloading', phaseDone: 'done',

  // Жизнеобеспечение
  lifeTitle: 'Sections and atmosphere',
  section: 'Section', volume: 'Volume', pressure: 'Pressure', o2: 'O₂', co2: 'CO₂',
  temp: 'Temperature', humidity: 'Humidity', tightness: 'Seal',
  m3: 'm³', kpa: 'kPa', celsius: '°C',
  powerTitle: 'Power for the current sol',
  generation: 'Produced', consumption: 'Consumed', charge: 'In batteries',
  deficit: 'Unserved', shed: 'Shed', backupRuntime: 'Backup runtime',
  kwh: 'kWh',

  // Теплица
  greenhouseTitle: 'Batches and growth factors',
  bed: 'Bed', stage: 'Stage', development: 'Development', limiting: 'Limiting',
  expected: 'Expected', yieldLoss: 'Lost yield', factors: 'Factors',
  none: 'none',

  // Лаборатория
  labTitle: 'Analyses and experiments',
  analyses: 'Analyses', experiments: 'Experiments', recipes: 'Saved regimes',
  sample: 'Sample', result: 'Result', precision: 'Precision',
  noAnalyses: 'No analyses yet. A hidden condition stays hidden until it is measured.',

  // Ремонт
  repairTitle: 'Condition, faults and repair',
  device: 'Equipment', condition: 'Condition', fault: 'Fault', connected: 'Connected',
  attention: 'Needs attention', severity: 'Severity',
  noFaults: 'No faults. Repair needs a specialist, hours, spares and access.',
  safeMode: 'Safe mode', safeModeOn: 'Enter safe mode', safeModeOff: 'Return to service',
  isolate: 'Seal off', reconnect: 'Reconnect', isolated: 'Sealed',
  safeModeNote: 'Safe mode stops the unit: it draws no power and produces nothing.',
  standby: 'Standby', standbyOn: 'standby', standbyOff: 'duty',
  standbyNote: 'Standby: an idle spare of the same kind in this section. It does not run, '
    + 'wear or draw power until the primary drops out — then it takes the load in the same sol.',
  risky: 'Risky repair', riskyOn: 'risky',
  riskyNote: 'Risky repair: no diagnosis and no spare part, twice as fast — but the unit comes '
    + 'back under-repaired and may fail again at once.',
  ship: 'Ship', shipKg: 'Ship', nothingToShip: 'nothing to ship', ware: 'Ware lot',
  ice: 'Ice', hardness: 'Hardness', survey: 'Surveys', stockpile: 'On site', reserveLife: 'Life',
  nutrientClosure: 'Nutrient loop', nutrientApplied: 'kg applied',
  nutrientReturned: 'kg returned', closureRatio: 'closed',
  closureOpen: 'the loop is open — the rest has to be bought',
  energy: 'Energy', kwhPerKg: 'kWh/kg', operator: 'Operator',
  importTitle: 'Procurement', importNote: 'Supplies are bought with the colony credits, not '
    + 'conjured: every delivered unit is paid for. Zero imports over a run is the autonomy '
    + 'figure, and it only means something because buying is possible.',
  buy: 'Buy', price: 'Price', credits: 'Credits', noCredits: 'no room or no money',
  cancelTask: 'Cancel', cancelNote: 'Cancelling returns only the unused materials — what the work '
    + 'already consumed stays spent. It does not fix the cause: while the unit is broken, the '
    + 'planner will raise the work again.',
  isolateNote: 'A sealed section is cut off from life support: no make-up oxygen, no scrubbing.',

  // Контракты
  contractsTitle: 'Bounded local contracts',
  required: 'Required', delivered: 'Delivered', due: 'Due sol',
  reward: 'Pre-funded reward', rate: 'Rate', fulfilled: 'Fulfilled',
  contractsNote: 'The reward pool is fixed in advance. A contract cannot be filled twice.',
  open: 'open',

  // Журнал
  labSampling: 'Sampling and assays', labRequest: 'Request assay', labReagents: 'Reagents',
  labNoReagents: 'Not enough reagents', labNoSample: 'Take a sample of that target first',
  labExperimentTitle: 'A/B experiment', labArmA: 'Regime A', labArmB: 'Regime B',
  labSolsRun: 'Sols', labStart: 'Start', labRunning: 'running', labDone: 'done',
  labWinner: 'Winner', labTie: 'tie', labRisk: 'Risk', labSaveRecipe: 'Save regime',
  labSaved: 'saved as a recipe', labApply: 'Apply', labApplyTo: 'Apply to a greenhouse',
  labYield: 'Yield', labQuality: 'Quality', labWater: 'Water', labEnergy: 'Energy',
  labLabour: 'Labour', labNoExperiments: 'No experiments yet. Two plots, two regimes, real resources.',
  labNoRecipes: 'No saved regimes. Finish an experiment and save the winner.',
  labFromExperiment: 'from experiment', labEvidence: 'Evidence',
  regimeBase: 'Baseline', regimeWarm: 'Warmer +3 °C', regimeBright: 'More light',
  regimeFrugal: 'Water-frugal', regimeRich: 'Richer feed',
  labNote: 'An experiment spends real water, reagents, energy and specialist hours. The result is measured, not declared.',
  journalTitle: 'Cause and effect',
  journalNote: 'Every entry is produced by the simulation, not written for decoration.',
  sol: 'Sol', event: 'Event',
  severityInfo: 'info', severityWarning: 'warning', severityCritical: 'critical',
}

const ru: typeof en = {
  systems: 'Системы',
  crew: 'Экипаж', tasks: 'Очередь', stores: 'Склады', extraction: 'Добыча',
  life: 'Среда', greenhouse: 'Теплица', lab: 'Лаборатория',
  repair: 'Ремонт', contracts: 'Контракты', journal: 'Журнал',

  empty: 'Глубокий слой поднимается после первого дня.',
  noWorld: 'Состояния глубокого слоя пока нет. Сделайте один шаг.',

  crewTitle: 'Экипаж и назначения',
  specialty: 'Специальность', fatigue: 'Усталость', health: 'Состояние',
  task: 'Задача', idle: 'свободен', hours: 'ч доступно',
  foodDebt: 'пищевой долг', sols: 'солов',

  queueTitle: 'Очередь работ',
  queueNote: 'Меньший приоритет выполняется раньше. Ручной приоритет перекрывает автоматический.',
  target: 'Объект', progress: 'Прогресс', status: 'Статус', priority: 'Приоритет',
  blockedBy: 'Блокировано', auto: 'авто', manual: 'вручную',
  pause: 'Пауза', resume: 'Продолжить', raise: 'Выше', lower: 'Ниже', resetPrio: 'Авто',
  statusQueued: 'в очереди', statusActive: 'выполняется', statusBlocked: 'блокировано', statusPaused: 'на паузе',

  storesTitle: 'Запасы и резервы',
  storesNote: 'У каждого склада есть ёмкость. Что не влезает — не производится.',
  resource: 'Ресурс', amount: 'Количество', cap: 'Ёмкость', reserved: 'Зарезервировано',

  extractionTitle: 'Месторождения и перевозки',
  deposit: 'Месторождение', distance: 'Расстояние', estimate: 'Оценка', confidence: 'Изучено',
  accessible: 'Доступно', workable: 'Можно работать', reason: 'Причина',
  haulJobs: 'Рейсы', vehicle: 'Машина', phase: 'Фаза', cargo: 'Груз',
  km: 'км', yes: 'да', no: 'нет',
  phaseToPickup: 'к погрузке', phaseLoading: 'погрузка', phaseToDrop: 'на базу',
  phaseUnloading: 'разгрузка', phaseDone: 'завершён',

  lifeTitle: 'Секции и атмосфера',
  section: 'Секция', volume: 'Объём', pressure: 'Давление', o2: 'O₂', co2: 'CO₂',
  temp: 'Температура', humidity: 'Влажность', tightness: 'Герметичность',
  m3: 'м³', kpa: 'кПа', celsius: '°C',
  powerTitle: 'Энергия за текущий сол',
  generation: 'Выработка', consumption: 'Потребление', charge: 'В аккумуляторах',
  deficit: 'Непокрыто', shed: 'Сброшено', backupRuntime: 'Запас хода',
  kwh: 'кВт·ч',

  greenhouseTitle: 'Партии и факторы роста',
  bed: 'Грядка', stage: 'Стадия', development: 'Развитие', limiting: 'Ограничивает',
  expected: 'Ожидается', yieldLoss: 'Потеряно', factors: 'Факторы',
  none: 'нет',

  labTitle: 'Анализы и эксперименты',
  analyses: 'Анализы', experiments: 'Эксперименты', recipes: 'Сохранённые режимы',
  sample: 'Проба', result: 'Результат', precision: 'Точность',
  noAnalyses: 'Анализов пока нет. Скрытое состояние остаётся скрытым, пока его не измерили.',

  repairTitle: 'Состояние, отказы и ремонт',
  device: 'Оборудование', condition: 'Состояние', fault: 'Отказ', connected: 'Подключено',
  attention: 'Требует внимания', severity: 'Важность',
  noFaults: 'Отказов нет. Ремонт требует специалиста, часов, запчастей и доступа.',
  safeMode: 'Безопасный режим', safeModeOn: 'В безопасный режим', safeModeOff: 'Вернуть в работу',
  isolate: 'Изолировать', reconnect: 'Подключить обратно', isolated: 'Изолирована',
  safeModeNote: 'Безопасный режим останавливает агрегат: он не берёт мощность и не даёт выхода.',
  standby: 'Резерв', standbyOn: 'в резерве', standbyOff: 'в работе',
  standbyNote: 'Резерв: праздный агрегат того же вида в этой секции. Он не работает, не '
    + 'изнашивается и не берёт мощность, пока основной исправен, — и берёт нагрузку в тот же сол, '
    + 'когда основной выбыл.',
  risky: 'Рискованный ремонт', riskyOn: 'рискованно',
  riskyNote: 'Рискованный ремонт: без диагноза и без запчасти, вдвое быстрее — но агрегат '
    + 'выходит недочиненным и может встать снова сразу.',
  ship: 'Отгрузка', shipKg: 'Отгрузить', nothingToShip: 'нечего везти', ware: 'Товарная партия',
  ice: 'Лёд', hardness: 'Сложность', survey: 'Разведка', stockpile: 'На площадке',
  reserveLife: 'Запас на', energy: 'Энергия', kwhPerKg: 'кВт·ч/кг', operator: 'Оператор',
  nutrientClosure: 'Круговорот удобрений', nutrientApplied: 'кг внесено',
  nutrientReturned: 'кг возвращено', closureRatio: 'замкнуто',
  closureOpen: 'цикл разомкнут — остальное приходится покупать',
  importTitle: 'Закупка', importNote: 'Снабжение покупается за кредиты колонии, а не берётся '
    + 'из воздуха: каждая завезённая единица оплачена. Ноль импорта за прогон — это показатель '
    + 'автономии, и он что-то значит именно потому, что купить можно.',
  buy: 'Купить', price: 'Цена', credits: 'Кредиты', noCredits: 'нет места или денег',
  cancelTask: 'Снять', cancelNote: 'При отмене возвращаются только неиспользованные материалы — '
    + 'то, что работа уже израсходовала, остаётся списанным. Отмена не лечит причину: пока агрегат '
    + 'сломан, планировщик поднимет работу снова.',
  isolateNote: 'Изолированная секция отрезана от жизнеобеспечения: нет подпитки кислородом и очистки.',

  contractsTitle: 'Ограниченные локальные контракты',
  required: 'Требуется', delivered: 'Сдано', due: 'Срок, сол',
  reward: 'Предоплаченный фонд', rate: 'Ставка', fulfilled: 'Исполнен',
  contractsNote: 'Фонд вознаграждения задан заранее. Контракт нельзя исполнить дважды.',
  open: 'открыт',

  labSampling: 'Пробы и анализы', labRequest: 'Поставить анализ', labReagents: 'Реагенты',
  labNoReagents: 'Не хватает реагентов', labNoSample: 'Сначала возьмите пробу этого объекта',
  labExperimentTitle: 'A/B-эксперимент', labArmA: 'Режим A', labArmB: 'Режим B',
  labSolsRun: 'Солов', labStart: 'Начать', labRunning: 'идёт', labDone: 'завершён',
  labWinner: 'Победитель', labTie: 'равны', labRisk: 'Риск', labSaveRecipe: 'Сохранить режим',
  labSaved: 'сохранён как рецепт', labApply: 'Применить', labApplyTo: 'Применить к теплице',
  labYield: 'Выход', labQuality: 'Качество', labWater: 'Вода', labEnergy: 'Энергия',
  labLabour: 'Труд', labNoExperiments: 'Опытов пока нет. Две делянки, два режима, настоящие ресурсы.',
  labNoRecipes: 'Сохранённых режимов нет. Завершите опыт и сохраните победителя.',
  labFromExperiment: 'из опыта', labEvidence: 'Подтверждено',
  regimeBase: 'Базовый', regimeWarm: 'Теплее +3 °C', regimeBright: 'Больше света',
  regimeFrugal: 'Экономия воды', regimeRich: 'Усиленное питание',
  labNote: 'Опыт тратит настоящие воду, реагенты, энергию и часы специалиста. Результат измеряется, а не объявляется.',
  journalTitle: 'Причины и следствия',
  journalNote: 'Каждая запись порождена симуляцией, а не написана для вида.',
  sol: 'Сол', event: 'Событие',
  severityInfo: 'инфо', severityWarning: 'важно', severityCritical: 'критично',
}

export const deepCopy = (language: string): typeof en => (language === 'ru' ? ru : en)
export type DeepCopy = typeof en
