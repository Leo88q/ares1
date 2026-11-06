/**
 * Единый склад колонии: одна таблица запасов, одни единицы, один владелец записи.
 *
 * Правила:
 *  - запас never < 0 и never > cap; излишек при переполнении НЕ исчезает молча —
 *    он возвращается вызывающему как `overflow`, и вызывающий решает (остановка, потеря, отказ);
 *  - `reserved` — уже обещанные работам материалы. Повторно зарезервировать их нельзя;
 *  - взятие (`stockTake`) ограничено НЕЗАРЕЗЕРВИРОВАННЫМ остатком;
 *  - функции мутируют переданный склад: мир клонируется один раз за шаг,
 *    внутри шага допускается изменяемое состояние (это же делает код читаемым).
 */
export type ResourceId = 'water_raw' | 'water_clean' | 'water_grey' | 'brine' | 'solution' | 'o2' | 'co2' | 'ice_ore' | 'tailings' | 'sludge' | 'biomass' | 'food_waste' | 'compost' | 'nutrient_n' | 'nutrient_p' | 'nutrient_k' | 'filters' | 'parts' | 'packaging' | 'reagents' | 'seed_potato' | 'ware_potato' | 'cull_potato';
export type StorageKind = 'tank' | 'gas' | 'bin' | 'shelf' | 'rack';
export interface ResourceSpec {
    id: ResourceId;
    unit: 'L' | 'kg' | 'pcs';
    group: 'water' | 'gas' | 'crop' | 'soil' | 'waste' | 'consumable';
    storage: StorageKind;
    /** Целые единицы (детали, фильтры, упаковка): округление только вниз. */
    discrete?: boolean;
    /** Требует холодного/вентилируемого хранилища, иначе быстрее портится. */
    cold?: boolean;
    ru: string;
    en: string;
    /** Краткое описание для документации и подсказок. */
    note: string;
}
export declare const RESOURCES: Record<ResourceId, ResourceSpec>;
export declare const RESOURCE_IDS: ResourceId[];
export interface Stock {
    amount: Record<ResourceId, number>;
    cap: Record<ResourceId, number>;
    reserved: Record<ResourceId, number>;
}
export interface FlowResult {
    /** Сколько реально поступило. */
    added: number;
    /** Сколько реально взято. */
    taken: number;
    /** Не поместилось в хранилище — вызывающий решает, потеря это или остановка. */
    overflow: number;
    /** Запрошено больше, чем доступно. */
    shortage: number;
}
export declare function emptyStock(cap?: Partial<Record<ResourceId, number>>): Stock;
/** Доступно для новых работ: запас минус уже зарезервированное. */
export declare const availableOf: (s: Stock, id: ResourceId) => number;
/** Положить на склад. Возвращает, сколько вошло и сколько не поместилось. */
export declare function stockAdd(s: Stock, id: ResourceId, amount: number): FlowResult;
/** Взять со склада. Не трогает зарезервированное. */
export declare function stockTake(s: Stock, id: ResourceId, amount: number): FlowResult;
/** Зарезервировать под работу. Повторное бронирование того же запаса невозможно. */
export declare function stockReserve(s: Stock, id: ResourceId, amount: number): number;
/** Списать зарезервированное (материал реально израсходован работой). */
export declare function stockCommit(s: Stock, id: ResourceId, amount: number): number;
/** Вернуть неиспользованный резерв (отмена/пауза работы). */
export declare function stockRelease(s: Stock, id: ResourceId, amount: number): number;
/** Суммарный запас питательных элементов N+P+K, kg (вид для существующего интерфейса). */
export declare const nutrientTotal: (s: Stock) => number;
/**
 * Установить новую ёмкость.
 *
 * Запас, уже принятый на склад, НЕ обрезается: если ёмкость упала (склад снесён
 * или повреждён), лишнее физически лежит на площадке — оно перестаёт
 * пополняться (`roomOf` даёт ноль), но не исчезает. Молча удалять массу ради
 * соблюдения предела — это подмена учёта: реестр уже оприходовал этот груз.
 */
export declare function setCapacity(s: Stock, id: ResourceId, cap: number): void;
