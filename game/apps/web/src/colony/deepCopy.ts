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

  // Контракты
  contractsTitle: 'Bounded local contracts',
  required: 'Required', delivered: 'Delivered', due: 'Due sol',
  reward: 'Pre-funded reward', rate: 'Rate', fulfilled: 'Fulfilled',
  contractsNote: 'The reward pool is fixed in advance. A contract cannot be filled twice.',
  open: 'open',

  // Журнал
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

  contractsTitle: 'Ограниченные локальные контракты',
  required: 'Требуется', delivered: 'Сдано', due: 'Срок, сол',
  reward: 'Предоплаченный фонд', rate: 'Ставка', fulfilled: 'Исполнен',
  contractsNote: 'Фонд вознаграждения задан заранее. Контракт нельзя исполнить дважды.',
  open: 'открыт',

  journalTitle: 'Причины и следствия',
  journalNote: 'Каждая запись порождена симуляцией, а не написана для вида.',
  sol: 'Сол', event: 'Событие',
  severityInfo: 'инфо', severityWarning: 'важно', severityCritical: 'критично',
}

export const deepCopy = (language: string): typeof en => (language === 'ru' ? ru : en)
export type DeepCopy = typeof en
