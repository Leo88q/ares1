/**
 * Стартовые гейты бэкенда.
 *
 * Было: `COLONY_V1_RELEASE_READY = false` — константа. Значит production-бэкенд
 * на mainnet падал на старте ВСЕГДА, даже когда колонии выключены, а включить
 * рельсу наград или пресейл-платежи без правки кода было нельзя вовсе. Это не
 * «безопасный дефолт», это блокировка запуска кодом.
 *
 * Стало: каждое решение — пара переменных окружения, и включение требует ДВУХ
 * независимых подтверждений:
 *
 *   1. сам флаг (`<NAME>=true`) — «функция готова к запуску»;
 *   2. отдельное одобрение (`<NAME>_APPROVED=YES`) — «владелец подписал
 *      включение именно в этом окружении». Значение по умолчанию — закрыто.
 *
 * Одно слово `true` в переменной окружения больше не открывает денежный путь:
 * его слишком легко скопировать из примера или выставить «на минутку» в
 * панели хостинга. `YES` рядом с флагом — это отдельное, видимое в
 * конфигурации решение, и оно попадает в лог старта.
 *
 * Гейты по-прежнему не зависят от сети: сетевые условия (genesis, CORS,
 * одобрение mainnet-пресейла) проверяются в `index.ts`, а сами маршруты —
 * каждый своим гейтом. Подделанный `/api/features` не открывает ничего.
 */

/** Слово-подтверждение. Не `true`/`1`: его нельзя выставить случайно. */
export const APPROVAL_TOKEN = "YES";

export interface LaunchGateDefinition {
  /** Базовое имя переменной окружения. */
  readonly name: string;
  /** Переменная с подписью владельца. */
  readonly approval: string;
  /** Что именно откроется — для лога старта и для отказов. */
  readonly opens: string;
  /** Почему значение по умолчанию закрыто. */
  readonly closedBecause: string;
}

export const LAUNCH_GATE_DEFINITIONS = {
  rewardsRail: {
    name: "REWARDS_RAIL_ENABLED",
    approval: "REWARDS_RAIL_APPROVED",
    opens: "выдачу стартового набора и дейлика из бэкенда (POTATO уходит с reward_signer)",
    closedBecause: "рельса включается после зелёного devnet-smoke «приглашение → грант → сверка» и подписи владельца",
  },
  userPresalePayments: {
    name: "USER_PRESALE_PAYMENTS_ENABLED",
    approval: "USER_PRESALE_PAYMENTS_APPROVED",
    opens: "платежи пресейла (паки POTATO) и витрину продаж",
    closedBecause: "до отдельного одобренного релиза платежей пользователей",
  },
  userSkrSlotPurchases: {
    name: "USER_SKR_SLOT_PURCHASES_ENABLED",
    approval: "USER_SKR_SLOT_PURCHASES_APPROVED",
    opens: "платную покупку слотов за SKR",
    closedBecause: "SKR-экономика не одобрена к запуску",
  },
  colonyV1Release: {
    name: "COLONY_V1_RELEASE_READY",
    approval: "COLONY_V1_RELEASE_APPROVED",
    opens: "колонии: постоянное состояние, действия и free starter на mainnet",
    closedBecause: "нужен полный acceptance-набор Colony V1 и ревью релиза",
  },
} as const satisfies Record<string, LaunchGateDefinition>;

export type LaunchGateId = keyof typeof LAUNCH_GATE_DEFINITIONS;

export interface LaunchGateState {
  readonly id: LaunchGateId;
  readonly enabled: boolean;
  /** Готовая строка для лога/`/api/health`: всегда объясняет «почему нет». */
  readonly reason: string;
}

export type LaunchGateEnv = Readonly<Record<string, string | undefined>>;

/** Флаг выключен, если не выставлен явно. `1`/`TRUE` не считаются `true`. */
function readFlag(env: LaunchGateEnv, name: string): boolean {
  return env[name] === "true";
}

function readApproval(env: LaunchGateEnv, approval: string): boolean {
  return env[approval] === APPROVAL_TOKEN;
}

/** Чистая функция: ровно то, что проверяют тесты, без скрытого чтения env. */
export function resolveLaunchGate(id: LaunchGateId, env: LaunchGateEnv): LaunchGateState {
  const definition = LAUNCH_GATE_DEFINITIONS[id];
  const flag = readFlag(env, definition.name);
  const approved = readApproval(env, definition.approval);
  if (flag && approved) {
    return { id, enabled: true, reason: `open: ${definition.name}=true and ${definition.approval}=${APPROVAL_TOKEN}` };
  }
  // Отказ всегда называет, чего не хватает: «выключено» без причины читается
  // как сломанная конфигурация и провоцирует «включить всё подряд».
  const missing = !flag && !approved
    ? `${definition.name}=true and ${definition.approval}=${APPROVAL_TOKEN}`
    : !flag
      ? `${definition.name}=true`
      : `${definition.approval}=${APPROVAL_TOKEN}`;
  return { id, enabled: false, reason: `closed: ${definition.closedBecause} (missing ${missing})` };
}

export function resolveLaunchGates(env: LaunchGateEnv): Record<LaunchGateId, LaunchGateState> {
  const ids = Object.keys(LAUNCH_GATE_DEFINITIONS) as LaunchGateId[];
  return Object.fromEntries(ids.map(id => [id, resolveLaunchGate(id, env)])) as Record<LaunchGateId, LaunchGateState>;
}

const resolved = resolveLaunchGates(process.env);

/**
 * Значения по умолчанию — `false` без переменных окружения. Имена оставлены
 * прежними, чтобы существующие гейты маршрутов не переписывались: изменился
 * только источник значения (env + подпись вместо константы).
 */
export const REWARDS_RAIL_ENABLED = resolved.rewardsRail.enabled;
/** User-facing token payment gates stay closed until a separately approved launch release. */
export const USER_PRESALE_PAYMENTS_ENABLED = resolved.userPresalePayments.enabled;
export const USER_SKR_SLOT_PURCHASES_ENABLED = resolved.userSkrSlotPurchases.enabled;
/** Открывается только полным acceptance-набором Colony V1 и ревью релиза. */
export const COLONY_V1_RELEASE_READY = resolved.colonyV1Release.enabled;

export const LAUNCH_GATES = resolved;

/**
 * Строки для лога старта. Безопасны: флаги и причины, никаких секретов.
 * Печатаются один раз при старте — так включение любого денежного пути видно
 * в журнале деплоя, а не только в панели хостинга.
 */
export function launchGateLogLines(gates: Record<LaunchGateId, LaunchGateState> = LAUNCH_GATES): string[] {
  return (Object.keys(LAUNCH_GATE_DEFINITIONS) as LaunchGateId[]).map(
    id => `[launch-gate] ${id}: ${gates[id].enabled ? "OPEN" : "closed"} — ${gates[id].reason}`,
  );
}

/** Человеческий список «что открыть», чтобы отказ в старте был действенным. */
export function launchGateBlockerHelp(ids: readonly LaunchGateId[]): string {
  return ids
    .map(id => {
      const d = LAUNCH_GATE_DEFINITIONS[id];
      return `${d.name}=true и ${d.approval}=${APPROVAL_TOKEN} (открывает: ${d.opens})`;
    })
    .join("; ");
}
