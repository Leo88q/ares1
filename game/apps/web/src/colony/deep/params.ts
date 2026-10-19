/**
 * Централизованные параметры глубокой симуляции (docs/COLONY_DEEP_SIM.md §4).
 *
 * Каждый параметр описан: единицы, смысл, допустимый диапазон и **статус**:
 *  - `measured` — опорное значение из внешнего авторитетного источника (ссылка в `ref`);
 *  - `derived` — посчитано из опорных величин (стехиометрия, газовые законы) с явным допущением;
 *  - `assumption` — игровое допущение/баланс, НЕ проверенные данные;
 *  - `balance` — число подобрано для играбельности.
 *
 * Ни одно значение в этом файле не выдаётся за измерённую марсианскую
 * агротехнику или сертифицированную инженерную систему жизнеобеспечения.
 */
import { SOL_HOURS } from './units'

export type ParamSource = 'measured' | 'derived' | 'assumption' | 'balance'
export interface ParamSpec<T = number> {
  key: string
  value: T
  unit: string
  min: number
  max: number
  source: ParamSource
  group: string
  note: string
  ref?: string
}

const spec = (
  key: string, value: number, unit: string, min: number, max: number,
  source: ParamSource, group: string, note: string, ref?: string,
): ParamSpec => ({ key, value, unit, min, max, source, group, note, ...(ref ? { ref } : {}) })

/** Плоский реестр: `DEEP_P.<key>` для чтения, `DEEP_PARAM_TABLE` для документации и тестов. */
const LIST: ParamSpec[] = [
  // --- Экипаж -------------------------------------------------------------
  spec('crewWorkHoursPerSol', 8, 'h/чел/сол', 0, 16, 'assumption', 'crew',
    'Номинальная трудовая смена. Остаток суток — сон, еда, гигиена.'),
  spec('crewSleepHoursPerSol', 8, 'h/чел/сол', 0, 16, 'assumption', 'crew', 'Сон восстанавливает силы.'),
  spec('crewExhaustedFatigue', 0.9, '1', 0.5, 1, 'balance', 'crew',
    'Порог, после которого человек снимается с работы: иначе он висит на задаче, '
    + 'не восстанавливается, и остальная очередь не двигается.'),
  spec('crewFatiguePerWorkHour', 0.055, '1/h', 0, 0.5, 'balance', 'crew', 'Рост усталости за час работы.'),
  spec('crewRecoveryPerRestHour', 0.075, '1/h', 0, 1, 'balance', 'crew', 'Снижение усталости за час отдыха.'),
  spec('crewO2KgPerSol', 0.84, 'kg/чел/сол', 0.3, 1.5, 'balance', 'crew',
    'Потребление O2 уровнем основной колонии (согласовано с PARAMETERS).'),
  spec('electrolysisKwhKgO2', 15, 'kWh/kg O2', 1, 60, 'balance', 'crew',
    'Практический расход энергии на кг O2 (агрегатная модель основной колонии; теория ≈5).'),
  spec('electrolysisWaterKgPerKgO2', 1.125, 'kg воды / кг O2', 0.9, 2, 'derived', 'crew',
    'Стехиометрия 2 H2O → 2 H2 + O2: 36 г воды на 32 г кислорода (согласовано с PARAMETERS).'),
  spec('crewCo2KgPerSol', 1.005, 'kg/чел/сол', 0.4, 2, 'derived', 'crew',
    'Из O2 × дыхательный коэффициент 0.87: 0.84 кг O2 → 26.25 моль → 22.84 моль CO2 → 1.005 кг.',
    'https://www.nasa.gov/wp-content/uploads/2023/04/nasa-sp-3001-vol-1-rev-b.pdf'),
  spec('crewWaterLitresPerSol', 3.8, 'L/чел/сол', 1, 10, 'balance', 'crew',
    'Питьё + гигиена + приготовление; согласовано с PARAMETERS.'),
  spec('crewFoodKgPerSol', 0.5, 'kg/чел/сол', 0.1, 2, 'balance', 'crew',
    'Добавка свежей еды, НЕ полный рацион; согласовано с PARAMETERS.'),
  spec('crewMoistureLPerSol', 2.3, 'L/чел/сол', 0.5, 5, 'assumption', 'crew',
    'Влага, выделяемая человеком (конденсат): источник стоков.'),
  spec('crewWasteKgPerSol', 0.2, 'kg/чел/сол', 0, 2, 'assumption', 'crew', 'Твёрдые бытовые отходы.'),
  spec('starvationOnsetSols', 3, 'сол', 1, 14, 'balance', 'crew',
    'Через сколько солов без еды падает работоспособность (не мгновенный штраф).'),
  spec('starvationHealthPerSol', 0.09, '1/сол', 0, 1, 'balance', 'crew', 'Потеря состояния за сол без еды.'),
  spec('hypoxiaOnsetHours', 1, 'h', 0, 12, 'balance', 'crew', 'Задержка перед влиянием нехватки O2.'),

  // --- Помещения и атмосфера ---------------------------------------------
  spec('habitatVolumeM3', 120, 'm³', 20, 1000, 'assumption', 'sections', 'Гермообъём одного жилого модуля.'),
  spec('greenhouseVolumeM3', 90, 'm³', 20, 1000, 'assumption', 'sections', 'Гермообъём теплицы (20 m² гряд, высота ~4.5 m).'),
  spec('nominalPressureKpa', 70, 'kPa', 30, 101.3, 'assumption', 'sections',
    'Рабочее давление базы (ISS ≈ 101.3; лёгкие станции ~70).'),
  spec('minO2PartialKpa', 16, 'kPa', 10, 21, 'measured', 'sections',
    'Минимальное парциальное давление O2 в обитаемом объёме (NASA spacecraft standard).',
    'https://www.nasa.gov/wp-content/uploads/2023/04/nasa-sp-3001-vol-1-rev-b.pdf'),
  spec('maxCo2PartialKpa', 0.53, 'kPa', 0.2, 2, 'measured', 'sections',
    'Предел CO2 для длительного пребывания (NASA SMAC, ~4 mmHg, 1000 h).',
    'https://www.nasa.gov/wp-content/uploads/static/history/SP-4412.pdf'),
  spec('targetCo2PartialKpa', 0.27, 'kPa', 0.05, 1, 'assumption', 'sections', 'Целевой уровень CO2.'),
  spec('leakFractionPerSol', 0.0025, '1/сол', 0, 0.05, 'assumption', 'sections',
    'Утечка атмосферы в сутки при полном состоянии (ISS ~0.05–0.1 %/day).',
    'https://www.nasa.gov/mission/international-space-station/'),
  spec('leakConditionExponent', 2, '1', 0.5, 5, 'assumption', 'sections', 'Утечка растёт при износе оболочки.'),
  spec('airlockLossFraction', 0.03, '1/цикл', 0, 0.5, 'assumption', 'sections',
    'Какая доля воздуха ШЛЮЗА теряется за один цикл. Шлюз — это малый объём, '
    + 'поэтому доля берётся от воздуха шлюза, а не всей секции: иначе один выход '
    + 'отбирал бы проценты атмосферы базы и она теряла бы её за считанные соли.'),
  spec('airlockVolumeM3', 3, 'm³', 0.5, 30, 'assumption', 'sections',
    'Гермообъём шлюза. Через него проходят и выходы наружу, и гермопереходы.'),
  spec('evaPrepHours', 1.5, 'h', 0.25, 6, 'assumption', 'sections', 'Подготовка к выходу (костюм, шлюз, проверки).'),
  spec('evaWaterLitres', 4.5, 'L/выход', 0, 20, 'assumption', 'sections',
    'Вода на сублиматор/охлаждение костюма; становится стоками.'),
  spec('thermalCapacityKwhPerC', 0.9, 'kWh/°C', 0.05, 20, 'balance', 'sections',
    'Эффективная теплоёмкость помещения (значение LAB/2).'),
  spec('envelopeKwPerC', 0.006, 'kW/°C', 0.0005, 0.1, 'balance', 'sections', 'Теплообмен через оболочку (LAB/2).'),
  spec('outsideMinC', -52, '°C', -140, 20, 'assumption', 'sections', 'Ночная наружная температура (LAB/2).'),
  spec('outsideDayAmplitudeC', 28, '°C', 0, 60, 'assumption', 'sections', 'Дневная амплитуда наружной температуры (LAB/2).'),
  spec('heaterKw', 0.9, 'kW', 0.05, 20, 'balance', 'sections', 'Максимальная мощность обогрева.'),
  spec('coolerKw', 3.2, 'kW', 0.05, 60, 'balance', 'sections',
    'Максимальная мощность отвода тепла. Теплица с лампами без охлаждения уходит за +70 °C за сутки.'),
  spec('targetHabitatC', 21, '°C', 10, 30, 'assumption', 'sections', 'Целевая температура жилого модуля.'),
  spec('targetGreenhouseC', 20, '°C', 5, 32, 'assumption', 'sections', 'Целевая температура теплицы.'),

  // --- Энергия ------------------------------------------------------------
  spec('solarPeakKw', 12.192, 'kW', 0, 100, 'derived', 'power',
    'Пиковая отдача одной солнечной батареи: 1.361 kW/m² × 40 m² × 0.28 × 0.80 (те же коэффициенты, что в основной колонии).',
    'https://science.nasa.gov/earth/explore/missions/total-solar-irradiance/'),
  spec('dustAccumulationPerSol', 0.003, '1/сол', 0, 0.05, 'assumption', 'power',
    'Потеря генерации от пыли за сол без чистки.'),
  spec('dustMaxLoss', 0.6, '1', 0, 0.95, 'assumption', 'power', 'Предел потерь от пыли.'),
  spec('dustCleanRestore', 0.85, '1', 0, 1, 'balance', 'power', 'Какую долю потерь снимает одна чистка.'),
  spec('batteryCapacityKwh', 100, 'kWh', 1, 2000, 'balance', 'power', 'Ёмкость одного аккумуляторного модуля.'),
  spec('batteryChargeEff', 0.9, '1', 0.5, 1, 'assumption', 'power', 'КПД заряда.'),
  spec('batteryDischargeEff', 0.9, '1', 0.5, 1, 'assumption', 'power', 'КПД разряда.'),
  spec('batteryC_rate', 0.25, '1/h', 0.02, 2, 'assumption', 'power',
    'Предел мощности заряда/разряда в долях ёмкости в час (C/4).'),
  spec('batteryWearPerKwh', 0.00004, '1/kWh', 0, 0.01, 'assumption', 'power', 'Деградация на kWh пропущенной энергии.'),
  spec('solarNightFraction', 0.42, '1', 0, 1, 'assumption', 'power', 'Доля сола без солнечной генерации.'),

  // --- Добыча и вода ------------------------------------------------------
  spec('depositMinReserveKg', 8_000, 'kg', 100, 1e7, 'assumption', 'extraction', 'Нижняя граница оценки запаса.'),
  spec('depositMaxReserveKg', 60_000, 'kg', 100, 1e7, 'assumption', 'extraction', 'Верхняя граница оценки запаса.'),
  spec('iceContentFraction', 0.6, 'kg воды / кг породы', 0.05, 0.95, 'assumption', 'extraction',
    'Содержание льда в добываемом реголите (широкий диапазон по данным орбитальной разведки).'),
  spec('surveyConfidenceGain', 0.35, '1', 0, 1, 'balance', 'extraction',
    'Насколько одна разведка уточняет оценку. Разведка НЕ создаёт ресурс.'),
  spec('extractionRateKgPerHour', 60, 'kg/h', 1, 2000, 'assumption', 'extraction', 'Производительность добывающей установки.'),
  spec('extractionKwhPerKg', 0.055, 'kWh/kg', 0.001, 1, 'assumption', 'extraction', 'Энергия на кг добытой породы.'),
  spec('extractionOperatorHoursPerHour', 1.1, 'h/h', 0, 4, 'assumption', 'extraction',
    'Труд оператора на час работы установки (1.1 → полная автономия недоступна).'),
  spec('sublimationYield', 0.54, 'L/kg', 0.05, 0.95, 'derived', 'extraction',
    'Выход воды из породы: iceContentFraction × meltRecovery 0.90.'),
  spec('sublimationKwhPerL', 0.35, 'kWh/L', 0.05, 3, 'assumption', 'extraction',
    'Энергия на извлечение/плавку литра воды (без теплотермодинамики льда: агрегированная модель).'),
  spec('purificationYield', 0.85, '1', 0.4, 0.99, 'assumption', 'extraction',
    'Доля неочищенной воды, ставшей очищенной; остаток — концентрат.'),
  spec('purifierLitresPerHour', 40, 'L/h', 1, 1000, 'balance', 'extraction', 'Производительность очистки.'),
  spec('purifierKwhPerLitre', 0.03, 'kWh/L', 0.001, 1, 'balance', 'extraction',
    'Энергия очистки литра (согласовано с recyclerKwhLitre основной колонии).'),
  spec('filterLifeLitres', 20_000, 'L/шт', 100, 1e6, 'assumption', 'extraction', 'Ресурс одного фильтра.'),
  spec('recyclerYield', 0.8, '1', 0.2, 0.98, 'assumption', 'extraction',
    'Возврат очищенной воды из стоков; остаток — шлам. Не 100 % и не бесплатно.'),
  spec('recyclerKwhPerLitre', 0.03, 'kWh/L', 0.001, 1, 'balance', 'extraction', 'Энергия регенерации.'),
  spec('pumpKwhPerCubicMetre', 0.9, 'kWh/m³', 0.01, 10, 'assumption', 'extraction',
    'Энергия перекачки; трубы ≠ кабели ≠ гермопереходы.'),
  spec('waterBoundLPerKg', 0.8, 'L/kg', 0.3, 0.95, 'balance', 'growth',
    'Вода, физически уходящая из хозяйства с урожаем (согласовано с PARAMETERS).'),

  // --- Машины и логистика -------------------------------------------------
  spec('scoutSpeedKmh', 12, 'km/h', 1, 60, 'assumption', 'machines', 'Скорость разведывательной машины.'),
  spec('excavatorSpeedKmh', 5, 'km/h', 0.5, 40, 'assumption', 'machines', 'Скорость добывающей техники.'),
  spec('haulerSpeedKmh', 9, 'km/h', 1, 60, 'assumption', 'machines', 'Скорость грузового ровера.'),
  spec('scoutCapacityKg', 40, 'kg', 1, 500, 'assumption', 'machines', 'Грузоподъёмность разведчика.'),
  spec('excavatorCapacityKg', 1_200, 'kg', 10, 50_000, 'assumption', 'machines', 'Грузоподъёмность добывающей техники.'),
  spec('haulerCapacityKg', 900, 'kg', 10, 50_000, 'assumption', 'machines', 'Грузоподъёмность грузового ровера.'),
  spec('scoutBatteryKwh', 14, 'kWh', 1, 500, 'assumption', 'machines', 'Запас энергии разведчика.'),
  spec('excavatorBatteryKwh', 60, 'kWh', 1, 2000, 'assumption', 'machines', 'Запас энергии добывающей техники.'),
  spec('haulerBatteryKwh', 45, 'kWh', 1, 2000, 'assumption', 'machines', 'Запас энергии грузового ровера.'),
  spec('vehicleKwhPerKm', 0.55, 'kWh/km', 0.02, 10, 'assumption', 'machines', 'Расход энергии на километр.'),
  spec('vehicleLoadUnloadHours', 0.6, 'h', 0.05, 6, 'assumption', 'machines', 'Время погрузки/разгрузки.'),
  spec('vehicleAutonomy', 0.5, '1', 0, 1, 'assumption', 'machines',
    'Доля работы без оператора. 0.5 → половина времени требует человека.'),

  // --- Выращивание --------------------------------------------------------
  spec('cropCycleSols', 90, 'сол', 20, 400, 'balance', 'growth',
    'Цикл от посадки до зрелости при идеальных условиях (согласовано с PARAMETERS).'),
  spec('cropKgPerM2PerSol', 0.12, 'kg/m²/сол', 0.005, 1, 'balance', 'growth',
    'Проектная урожайность (согласовано с PARAMETERS).'),
  spec('seedRateKgPerM2', 0.15, 'kg/m²', 0.02, 1, 'assumption', 'growth',
    'Норма посадки семенного картофеля (земная практика ~1.5 t/ha).'),
  spec('seedMultiplicationCap', 25, '1', 1, 100, 'assumption', 'growth',
    'Предел размножения семян за цикл: масса и время ограничены.'),
  // Резервный путь разделки. Если до задачи «переработка» не дошли руки,
  // сырьё всё равно должно превращаться в еду — иначе колония умирает от
  // голода из-за очереди, а не из-за физики. Но без людей разделка идёт
  // вчетверо медленнее, поэтому нанимать их по-прежнему имеет смысл.
  spec('processUnstaffedKgPerSol', 4.2, 'kg/сол', 0, 100, 'balance', 'growth',
    'Сколько сырого урожая разделывается без людей (резервный путь). 4.2 = четверть пропускной способности переработчика 16.8 кг/сол.'),
  spec('harvestHours', 1.4, 'ч/грядку', 0.1, 12, 'assumption', 'growth',
    'Труд на уборку одной грядки. Созревшая грядка ждёт этой работы, поэтому нехватка людей напрямую откладывает уборку.'),
  // Ждать людей бесконечно нельзя: перезревший картофель портится, да и тупик
  // из неразобранной очереди — отказ интерфейса, а не физика. После льготного
  // срока уборка открывается сама; люди её ускоряют, а не разрешают.
  spec('harvestGraceSols', 6, 'сол', 0, 60, 'balance', 'growth',
    'Сколько сол созревшая грядка ждёт людей, прежде чем убраться без них.'),
  spec('cropWaterLPerM2PerSol', 4.3, 'L/m²/сол', 0.5, 12, 'measured', 'growth',
    'Середина диапазона Wheeler для закрытого выращивания (3.4–5.2).',
    'https://link.springer.com/article/10.1007/s11540-006-9003-4'),
  // Крепость рецепта раствора. Выводится из двух соседних норм: 0.12 кг/м²/сол
  // биомассы × 0.01 (доля питания в норме) ÷ 4.3 л/м²/сол воды ≈ 0.00028 кг/л.
  // Одна и та же цифра теперь задаёт и расход, и предел доставки: крепче
  // раствора из того же объёма воды не получить.
  spec('nutrientSolutionKgPerL', 0.00028, 'kg/L', 0.00002, 0.005, 'derived', 'growth',
    'Крепость питательного раствора: сколько NPK несёт один литр полива при номинальном рецепте.'),
  spec('transpirationCaptureFraction', 0.98, '1', 0, 1, 'assumption', 'growth',
    'Доля транспирации, которую конденсатор теплицы возвращает в бак: это дистиллят, а не стоки, поэтому он идёт напрямую в чистую воду. Потери контура теплицы ≈ 2 %.'),
  spec('cropCo2KgPerKgFresh', 0.34, 'kg/kg', 0.05, 1, 'derived', 'growth',
    'CO2, связываемый фотосинтезом на кг сырой биомассы (оценка по сухому веществу 20 %).'),
  spec('cropO2KgPerKgFresh', 0.25, 'kg/kg', 0.05, 1, 'balance', 'growth',
    'O2 на кг сырой биомассы (согласовано с PARAMETERS).'),
  spec('stressAccumulationRate', 0.06, '1/сол', 0, 1, 'balance', 'growth',
    'Как быстро накапливается стресс при полностью неблагоприятном факторе.'),
  spec('stressRecoveryRate', 0.02, '1/сол', 0, 1, 'balance', 'growth',
    'Как медленно стресс уходит при исправлении условий.'),
  spec('yieldPenaltyPerStress', 0.55, '1', 0, 2, 'balance', 'growth',
    'Доля будущего урожая, теряемая на единицу накопленного стресса.'),
  // Субстрат деградирует не за один цикл, а за несколько: порог 0.25 при этих
  // темпах достигается примерно на 170-й сол, то есть симптомы появляются во
  // втором цикле, а лаборатория видит их раньше (analysisPrecision 0.06).
  spec('contaminationGrowthPerSol', 0.0015, '1/сол', 0, 0.1, 'assumption', 'growth',
    'Скрытое накопление загрязнения субстрата (видна только через анализ).'),
  spec('saltIndexGrowthPerSol', 0.0012, '1/сол', 0, 0.1, 'assumption', 'growth',
    'Скрытое накопление солей (видна только через анализ).'),
  spec('contaminationStressThreshold', 0.25, '1', 0, 1, 'balance', 'growth', 'Порог влияния загрязнения.'),
  spec('tendIntervalSols', 12, 'сол', 1, 60, 'balance', 'growth',
    'Как часто грядке нужен уход. Просрочка даёт стресс запущенности.'),
  spec('lampKwPerM2', 0.2, 'kW/m²', 0.01, 1, 'balance', 'growth',
    'Мощность досветки (согласовано с ledKwM2 основной колонии).'),
  spec('powerLinkCapacityKw', 8, 'kW', 0.5, 500, 'assumption', 'power',
    'Ёмкость одной силовой линии на нулевой длине (§7: пропускная способность сети).'),
  spec('powerLinkDerateCells', 40, 'клеток', 1, 500, 'assumption', 'power',
    'На каком расстоянии канал теряет половину ёмкости (падение напряжения).'),
  spec('rootZoneChillC', 2.5, '°C', 0, 12, 'assumption', 'growth',
    'Насколько холоднее воздуха держится корневая зона при обычном поливе: поливная вода приходит из очистки холодной.'),
  spec('rootZoneTauSols', 0.25, 'сол', 0.02, 4, 'assumption', 'growth',
    'Постоянная времени субстрата: как быстро корни принимают новую температуру.'),
  spec('circulationTauHours', 2, 'h', 0.1, 48, 'assumption', 'sections',
    'Постоянная перемешивания: за сколько часов воздух приходит к целевому состоянию после пуска или останова вентилятора.'),
  spec('circulationMinPowerFraction', 0.05, '1', 0.001, 1, 'assumption', 'sections',
    'Какая доля мощности агрегата нужна вентилятору, чтобы держать поток: ниже — воздух стоит.'),
  spec('circulationMinQuality', 0.35, '1', 0, 1, 'assumption', 'sections',
    'Потолок качества атмосферы при остановленной вентиляции: CO₂ стоит у источника, состав в сумме верен.'),
  spec('photoperiodHours', 16, 'h/сол', 0, 24, 'balance', 'growth', 'Фотопериод (согласовано с PARAMETERS).'),
  spec('greenhouseUtilitiesKwPerM2', 0.04, 'kW/m²', 0.005, 0.5, 'balance', 'growth',
    'Постоянные нужды теплицы (насосы, контроль климата); согласовано с PARAMETERS.cropUtilitiesKwM2.'),

  // --- Хранение и порча ---------------------------------------------------
  spec('rawShelfSols', 3, 'сол', 0.5, 60, 'balance', 'storage', 'Срок немытого картофеля (LAB: 72 h).'),
  spec('processedShelfSols', 14, 'сол', 1, 200, 'balance', 'storage', 'Срок переработанной партии (LAB: 336 h).'),
  spec('wareShelfSols', 45, 'сол', 1, 400, 'assumption', 'storage', 'Срок товарной партии при 4 °C и вентиляции.'),
  spec('seedShelfSols', 240, 'сол', 10, 900, 'assumption', 'storage', 'Срок семенного картофеля.'),
  spec('storageTempOptimumC', 4, '°C', 0, 20, 'assumption', 'storage', 'Оптимальная температура хранения.'),
  spec('depotSolidGain', 0.5, '1/склад', 0, 3, 'balance', 'storage',
    'Какую долю базовой ёмкости добавляет один склад, построенный сверх стартового набора. '
    + 'Без этого склад был бы чистым расходом: он ест мощность, изнашивается и может отказать, не давая ничего.'),

  // --- Отходы и переработка -----------------------------------------------
  spec('compostSols', 12, 'сол', 1, 90, 'assumption', 'waste', 'Длительность компостирования.'),
  spec('compostKgPerKg', 0.35, 'kg/kg', 0.05, 0.9, 'assumption', 'waste',
    'Выход компоста из растительных остатков (органика → CO2 + вода + компост).'),
  spec('compostNutrientKgPerKg', 0.012, 'kg NPK/kg', 0, 0.1, 'assumption', 'waste',
    'Питательные элементы в компосте. Ниже, чем в удобрении: часть уходит в CO2.'),
  spec('compostKwhPerKg', 0.08, 'kWh/kg', 0, 2, 'assumption', 'waste', 'Энергия на кг компостируемой массы.'),
  spec('compostLabourHoursPerKg', 0.02, 'h/kg', 0, 1, 'assumption', 'waste', 'Труд на кг.'),

  // --- Надёжность ---------------------------------------------------------
  spec('serviceIntervalHours', 400, 'h', 24, 5000, 'assumption', 'reliability', 'Межсервисный интервал.'),
  spec('wearPerOperatingHour', 0.00035, '1/h', 0, 0.05, 'assumption', 'reliability', 'Базовый износ за час работы.'),
  spec('wearLoadExponent', 1.4, '1', 0.5, 4, 'assumption', 'reliability', 'Износ растёт с нагрузкой.'),
  spec('wearDustMultiplier', 2.2, '1', 1, 8, 'assumption', 'reliability', 'Пыль ускоряет износ.'),
  spec('faultBaseHazardPerHour', 0.000015, '1/h', 0, 0.05, 'assumption', 'reliability',
    'Базовая интенсивность отказа на исправном оборудовании. Порядок подобран так, '
    + 'чтобы за 180 солов ухудшалось состояние, а не наступал каскадный отказ базы.'),
  spec('faultOverdueMultiplier', 9, '1', 1, 50, 'assumption', 'reliability', 'Просроченное обслуживание резко повышает риск.'),
  spec('faultWearMultiplier', 6, '1', 1, 100, 'assumption', 'reliability', 'Износ повышает риск отказа.'),
  spec('inspectHours', 1.2, 'h', 0.1, 12, 'assumption', 'reliability', 'Труд на диагностику.'),
  spec('repairHoursPerPart', 1.6, 'h/деталь', 0.2, 20, 'assumption', 'reliability', 'Труд на деталь.'),
  spec('repairPartsBase', 1, 'шт', 0, 20, 'assumption', 'reliability', 'Базовое число деталей для ремонта.'),
  spec('repairRestoresCondition', 0.75, '1', 0, 1, 'balance', 'reliability',
    'Ремонт возвращает часть состояния; полная замена недоступна в этой итерации.'),

  // --- Лаборатория --------------------------------------------------------
  spec('sampleHours', 0.5, 'h', 0.1, 6, 'assumption', 'lab', 'Труд на отбор пробы.'),
  // Плановый мониторинг, а не отбор «по показаниям»: загрязнение и соли
  // скрыты, поэтому запускать отбор по их значению значило бы подсмотреть
  // ответ. Реальная лаборатория берёт пробы по расписанию — так же и здесь.
  spec('sampleIntervalSols', 18, 'сол', 1, 120, 'assumption', 'lab',
    'Как часто планово берут пробы с теплицы. Меньше цикла картофеля, чтобы скрытое успевало накопиться.'),
  spec('sampleLitres', 0.25, 'L', 0.01, 5, 'assumption', 'lab', 'Вода/раствор, уходящая в пробу.'),
  spec('analysisReagents', 1, 'шт', 1, 20, 'assumption', 'lab', 'Реагенты на один анализ.'),
  spec('analysisHours', 2.5, 'h', 0.2, 24, 'assumption', 'lab', 'Работа специалиста на анализ.'),
  spec('analysisKwh', 1.2, 'kWh', 0.05, 30, 'assumption', 'lab', 'Энергия приборов на анализ.'),
  spec('analysisPrecision', 0.06, '1', 0.005, 0.5, 'assumption', 'lab',
    'Половина ширины доверительного интервала результата.'),
  spec('experimentAreaM2', 1.5, 'm²', 0.1, 20, 'assumption', 'lab', 'Площадь одной опытной делянки.'),
  spec('experimentMinSols', 20, 'сол', 5, 200, 'assumption', 'lab', 'Минимальная длительность эксперимента.'),
  spec('experimentLabourHoursPerSol', 1.2, 'h/сол', 0.05, 20, 'assumption', 'lab', 'Ежедневный труд на эксперимент.'),

  // --- Экономика (только SIM) ---------------------------------------------
  spec('packagingUnitsPerKg', 0.05, 'шт/kg', 0, 5, 'assumption', 'contracts', 'Упаковка на кг товарной партии.'),
  spec('importWaterLitresPerCredit', 1.25, 'L/CR', 0, 100, 'balance', 'contracts',
    'Закупка воды с Земли: дорого и доступна всегда (явная импортозависимость).'),
  spec('importNutrientKgPerCredit', 0.0125, 'kg/CR', 0, 10, 'balance', 'contracts', 'Закупка удобрений.'),
  spec('importPartsPerCredit', 0.0125, 'шт/CR', 0, 10, 'balance', 'contracts', 'Закупка запчастей.'),
  spec('importFilterPerCredit', 0.0125, 'шт/CR', 0, 10, 'balance', 'contracts', 'Закупка фильтров.'),
]

/** Числовые параметры по ключу. Типобезопасный доступ: `DEEP_P.crewWorkHoursPerSol`. */
export const DEEP_P = Object.freeze(
  Object.fromEntries(LIST.map(p => [p.key, p.value])),
) as Readonly<Record<(typeof PARAM_KEYS)[number], number>>

/** Полная таблица для документации, UI и тестов границ. */
export const DEEP_PARAM_TABLE: readonly ParamSpec[] = Object.freeze(LIST.map(p => ({ ...p })))

/** Группы параметров для секций документации. */
export const DEEP_PARAM_GROUPS: readonly string[] = Object.freeze(
  [...new Set(LIST.map(p => p.group))],
)

/** Есть ли внешний источник у параметра (для UI-метки «источник / допущение»). */
export const hasExternalSource = (key: string): boolean =>
  LIST.some(p => p.key === key && (p.source === 'measured' || (p.source === 'derived' && !!p.ref)))

// --- Вспомогательные производные ---

/** Часов работы оборудования за один сол при полной нагрузке. */
export const operatingHoursPerSol = (): number => SOL_HOURS

/** Предел мощности аккумулятора (kW) при заданной ёмкости (kWh). */
export const batteryPowerLimitKw = (capacityKwh: number): number =>
  capacityKwh * DEEP_P.batteryC_rate

/** Ключи параметров (выводится из списка, чтобы не расходиться с реестром). */
const PARAM_KEY_LIST = LIST.map(p => p.key)

export type ParamKey = (typeof PARAM_KEY_LIST)[number]
export const PARAM_KEYS = PARAM_KEY_LIST as readonly ParamKey[]

/** Проверка реестра: значения внутри диапазона, ключи уникальны. */
export function validateParams(): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const p of LIST) {
    if (seen.has(p.key)) problems.push(`duplicate parameter key: ${p.key}`)
    seen.add(p.key)
    if (!Number.isFinite(p.value)) problems.push(`${p.key}: value is not finite`)
    if (p.value < p.min || p.value > p.max) problems.push(`${p.key}: ${p.value} outside [${p.min}, ${p.max}]`)
    if (p.min > p.max) problems.push(`${p.key}: inverted range`)
  }
  return problems
}
