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
export type ParamSource = 'measured' | 'derived' | 'assumption' | 'balance';
export interface ParamSpec<T = number> {
    key: string;
    value: T;
    unit: string;
    min: number;
    max: number;
    source: ParamSource;
    group: string;
    note: string;
    ref?: string;
}
/** Числовые параметры по ключу. Типобезопасный доступ: `DEEP_P.crewWorkHoursPerSol`. */
export declare const DEEP_P: Readonly<Record<(typeof PARAM_KEYS)[number], number>>;
/** Полная таблица для документации, UI и тестов границ. */
export declare const DEEP_PARAM_TABLE: readonly ParamSpec[];
/** Ключи параметров (выводится из списка, чтобы не расходиться с реестром). */
declare const PARAM_KEY_LIST: string[];
export type ParamKey = (typeof PARAM_KEY_LIST)[number];
declare const PARAM_KEYS: readonly ParamKey[];
/** Проверка реестра: значения внутри диапазона, ключи уникальны. */
export declare function validateParams(): string[];
export {};
