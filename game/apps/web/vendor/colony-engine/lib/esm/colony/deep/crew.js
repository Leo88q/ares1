/**
 * Экипаж колонии: специализации, квалификация, усталость, жизнедеятельность.
 *
 * Человек — реальный ограничитель производства: один человек не работает
 * над двумя задачами одновременно, устаёт без отдыха и теряет
 * работоспособность без еды, воды и кислорода. Последствия НЕ мгновенные:
 * дефицит накапливается (`hoursWithoutFood`, `fatigue`, `health`), а падение
 * эффективности происходит постепенно.
 */
import { DEEP_P } from './params.js';
import { clamp01, fraction } from './units.js';
export const SPECIALTY_LABEL = {
    agronomist: { ru: 'Агроном', en: 'Agronomist' },
    engineer: { ru: 'Инженер', en: 'Engineer' },
    operator: { ru: 'Оператор техники', en: 'Operator' },
    generalist: { ru: 'Универсал', en: 'Generalist' },
};
/**
 * Матрица квалификации: множитель эффективности по типу работы.
 * Игровое допущение (balance): в этой итерации нет десятков психологических
 * характеристик — только специализация, усталость и состояние.
 */
const SKILL_MATRIX = {
    agronomist: { plant: 1.3, tend: 1.3, harvest: 1.25, sample: 1.2, analysis: 1.15, process: 1.0, clean_panels: 0.7, inspect: 0.8, repair: 0.55, extract: 0.6, haul: 0.7, survey: 0.85, maintain: 0.7 },
    engineer: { plant: 0.6, tend: 0.7, harvest: 0.6, sample: 0.8, analysis: 0.9, process: 0.8, clean_panels: 1.1, inspect: 1.3, repair: 1.35, extract: 0.9, haul: 0.8, survey: 0.8, maintain: 1.3 },
    operator: { plant: 0.7, tend: 0.75, harvest: 0.75, sample: 0.7, analysis: 0.6, process: 0.9, clean_panels: 0.9, inspect: 0.9, repair: 0.85, extract: 1.35, haul: 1.35, survey: 1.3, maintain: 0.95 },
    generalist: { plant: 0.85, tend: 0.85, harvest: 0.85, sample: 0.85, analysis: 0.8, process: 0.85, clean_panels: 0.85, inspect: 0.9, repair: 0.75, extract: 0.85, haul: 0.85, survey: 0.85, maintain: 0.85 },
};
const FALLBACK_SKILL = 0.6;
/** Квалификация человека на тип работы (множитель к скорости). */
export function crewSkill(member, kind) {
    const table = SKILL_MATRIX[member.specialty];
    return table[kind] ?? FALLBACK_SKILL;
}
/** Множитель эффективности: квалификация × усталость × состояние × питание. */
function crewEfficiency(member, kind) {
    const fatiguePenalty = 1 - 0.6 * clamp01(member.fatigue);
    const healthFactor = 0.35 + 0.65 * clamp01(member.health);
    const nutritionFactor = nutritionFactorOf(member);
    return clamp01(crewSkill(member, kind) * fatiguePenalty * healthFactor * nutritionFactor);
}
/**
 * Питание: последствия нехватки еды нарастают по времени, а не мгновенным штрафом.
 * Первые `starvationOnsetSols` солей дефицит переносится, затем эффективность падает линейно.
 */
function nutritionFactorOf(member) {
    const grace = Math.max(0, DEEP_P.starvationOnsetSols);
    const debt = Math.max(0, member.foodDebtSols);
    if (debt <= grace)
        return 1;
    return clamp01(1 - 0.18 * (debt - grace));
}
/** Сколько часов человек реально может отработать в этот сол. */
function plannedHours(member) {
    const base = DEEP_P.crewWorkHoursPerSol;
    return Math.max(0, base * (1 - 0.45 * clamp01(member.fatigue)) * (0.4 + 0.6 * clamp01(member.health)) * nutritionFactorOf(member));
}
export const isIdle = (member) => member.taskId === null;
export const remainingHours = (member) => Math.max(0, member.hoursAvailable - member.hoursToday);
export function createCrew(id, name, specialty) {
    return {
        id, name, specialty, fatigue: 0.05, health: 1, foodDebtSols: 0,
        taskId: null, hoursToday: 0, hoursAvailable: DEEP_P.crewWorkHoursPerSol,
        location: 'habitat-1', suited: false, evaPrepHours: 0,
    };
}
/** Начало сола: пересчитать доступные часы, сбросить счётчик, снять скафандр. */
export function beginSolForCrew(member) {
    member.hoursToday = 0;
    member.hoursAvailable = plannedHours(member);
    member.suited = false;
    member.evaPrepHours = 0;
}
/**
 * Работа в течение `hours` часов. Возвращает полезные «человеко-часы»
 * (эффективные), которые задача зачитывает в свой прогресс.
 */
export function workHours(member, kind, hours) {
    const available = Math.min(hours, remainingHours(member));
    if (available <= 0)
        return 0;
    member.hoursToday += available;
    member.fatigue = clamp01(member.fatigue + DEEP_P.crewFatiguePerWorkHour * available);
    return available * crewEfficiency(member, kind);
}
/** Отдых: сон и восстановление в конце сола. */
export function restCrew(member, restHours) {
    if (restHours <= 0)
        return;
    member.fatigue = clamp01(member.fatigue - DEEP_P.crewRecoveryPerRestHour * restHours);
    // Состояние восстанавливается только при еде; без неё дефицит копится.
    if (member.foodDebtSols <= 0)
        member.health = clamp01(member.health + 0.03 * restHours / 8);
}
export function metabolise(crew, shareOfSol, foodAvailableKg, waterAvailableL, o2AvailableKg) {
    const people = Math.max(0, crew);
    const foodWant = people * DEEP_P.crewFoodKgPerSol * shareOfSol;
    const waterWant = people * DEEP_P.crewWaterLitresPerSol * shareOfSol;
    const o2Want = people * DEEP_P.crewO2KgPerSol * shareOfSol;
    const fed = fraction(foodAvailableKg, foodWant);
    const watered = fraction(waterAvailableL, waterWant);
    const breathe = fraction(o2AvailableKg, o2Want);
    // Кислород — самый жёсткий ограничитель: без него человек не работает.
    const alive = Math.min(fed, watered, breathe);
    return {
        foodKg: foodWant * Math.min(1, fed),
        waterL: waterWant * Math.min(1, watered),
        o2Kg: o2Want * Math.min(1, breathe),
        co2Kg: people * DEEP_P.crewCo2KgPerSol * shareOfSol * alive,
        moistureL: people * DEEP_P.crewMoistureLPerSol * shareOfSol * alive,
        wasteKg: people * DEEP_P.crewWasteKgPerSol * shareOfSol,
        fedFraction: Math.min(1, fed),
    };
}
/** Накопление последствий: еда, гипоксия, плохая атмосфера. */
export function applyLifeSupportConsequences(member, shareOfSol, fedFraction, o2PartialKpa, co2PartialKpa) {
    // Пищевой долг: растёт при недоедании, гасится при нормальном рационе.
    if (fedFraction >= 0.98)
        member.foodDebtSols = Math.max(0, member.foodDebtSols - shareOfSol * 1.5);
    else
        member.foodDebtSols += shareOfSol * (1 - fedFraction);
    member.health = clamp01(member.health - DEEP_P.starvationHealthPerSol * shareOfSol * (1 - fedFraction));
    // Кислород ниже минимума и CO2 выше предела ухудшают состояние.
    if (o2PartialKpa < DEEP_P.minO2PartialKpa) {
        const deficit = fraction(DEEP_P.minO2PartialKpa - o2PartialKpa, DEEP_P.minO2PartialKpa);
        member.health = clamp01(member.health - 0.25 * shareOfSol * deficit);
        member.fatigue = clamp01(member.fatigue + 0.12 * shareOfSol * deficit);
    }
    if (co2PartialKpa > DEEP_P.maxCo2PartialKpa) {
        const excess = fraction(co2PartialKpa - DEEP_P.maxCo2PartialKpa, DEEP_P.maxCo2PartialKpa);
        member.health = clamp01(member.health - 0.18 * shareOfSol * excess);
        member.fatigue = clamp01(member.fatigue + 0.1 * shareOfSol * excess);
    }
}
export function crewSummary(crew) {
    const total = crew.length;
    const idle = crew.filter(isIdle).length;
    const planned = crew.reduce((sum, m) => sum + m.hoursAvailable, 0);
    const worked = crew.reduce((sum, m) => sum + m.hoursToday, 0);
    const readiness = total > 0
        ? crew.reduce((sum, m) => sum + (1 - m.fatigue) * m.health * nutritionFactorOf(m), 0) / total
        : 0;
    return { total, idle, assigned: total - idle, readiness, hoursPlanned: planned, hoursWorked: worked };
}
