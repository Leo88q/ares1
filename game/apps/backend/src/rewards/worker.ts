/**
 * Авто-доставка интентов: воркер забирает `reward_intents` в состоянии
 * actionsable и отправляет каждый одной транзакцией `grant_reward_once`.
 *
 * Почему это отдельный модуль, а не часть HTTP-обработчика:
 *   - платежи и награды живут в БД, а подпись — на отдельном ключе; смешивать
 *     их в запросе значит держать ключ в процессе, который обслуживает
 *     пользователей;
 *   - один интент = одна транзакция = один nonce. Повтор после падения процесса
 *     между отправкой и записью подписи не создаёт второй грант: PDA
 *     `[b"reward", ata, nonce]` уже существует, и `lookupExistingGrant`
 *     восстанавливает подпись из истории аккаунта вместо повторной отправки.
 *
 * Модуль ничего не знает про RPC и БД напрямую — все эффекты инжектируются.
 * Так тест проверяет порядок переходов и обработку гонок без стенда.
 */

export interface WorkerIntent {
  id: string;
  recipientAta: string;
  amountMicro: bigint;
  nonce: bigint;
  state: string;
  /** Подпись уже отправленной транзакции; нужна фазе подтверждения. */
  signature?: string | null;
}

export interface GrantLookup {
  signature: string;
  slot?: bigint;
}

export interface DeliveryWorkerDeps {
  /** Сколько интентов максимум забрать за такт. */
  limit?: number;
  /** actor для аудита переходов. */
  actor: string;
  listActionable: (limit: number) => Promise<WorkerIntent[]>;
  /**
   * `submitted`-интенты без слота: транзакция ушла, подтверждение не записалось.
   * Отсутствие зависимости = фаза подтверждения выключена (тесты и стенды без БД);
   * в боевой сборке её обязан передать `index.ts`, иначе такие интенты не
   * добираются никем.
   */
  listAwaitingConfirmation?: (limit: number) => Promise<WorkerIntent[]>;
  /** Отправка гранта. Возвращает подпись и, если известен, слот. */
  executeGrant: (intent: WorkerIntent) => Promise<GrantLookup>;
  /** Проверка «грант уже на цепи» (по PDA). null — гранта нет. */
  lookupExistingGrant: (intent: WorkerIntent) => Promise<GrantLookup | null>;
  markSubmitted: (input: { id: string; signature: string; actor: string }) => Promise<unknown>;
  markConfirmed: (input: { id: string; slot: bigint; signature: string; actor: string }) => Promise<unknown>;
  markFailed: (input: { id: string; failureCode: string; actor: string }) => Promise<unknown>;
}

export interface DeliveryWorkerResult {
  picked: number;
  submitted: number;
  confirmed: number;
  /** Интенты закрыты терминальным `failed`. */
  failed: number;
  /** Интенты остались открытыми: следующий такт попробует снова. */
  retryable: number;
  /** Грант уже был на цепи, отправку не повторяли. */
  recovered: number;
  /** `submitted`-интенты, подтверждённые по истории PDA гранта. */
  reconciled: number;
  errors: Array<{ id: string; code: string }>;
}

const MAX_LIMIT = 25;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_GRANT_MICRO = 1_000_000_000n;

/** Код отказа по правилам схемы: A-Z, 0-9, подчёркивание, 3..40 символов. */
export function failureCodeFrom(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/already in use|already been processed|custom program error: 0x0\b/i.test(message)) return "ALREADY_ON_CHAIN";
  if (/simulation failed/i.test(message)) return "SIMULATION_FAILED";
  if (/insufficient|no record of a prior credit/i.test(message)) return "SIGNER_UNFUNDED";
  if (/blockhash/i.test(message)) return "BLOCKHASH_EXPIRED";
  if (/timed out|timeout/i.test(message)) return "CONFIRM_TIMEOUT";
  return "GRANT_FAILED";
}

/**
 * Коды, которые НЕ закрывают интент.
 *
 * Разделение обязательное. `CONFIRM_TIMEOUT` означает «подпись уже улетела, а
 * подтверждение не пришло»: транзакция может подтвердиться через минуту.
 * Если такой интент пометить терминальным `failed`, заказ навсегда останется
 * `paid` без выдачи (`markDelivered` требует `confirmed`), а ручная повторная
 * выдача того же заказа — это вторая выплата.
 *
 * Повтор безопасен по построению: nonce детерминирован (заказ/кошелёк/сутки),
 * поэтому повторная отправка того же интента либо попадает в уже существующий
 * PDA `[reward, ata, nonce]` (`ALREADY_ON_CHAIN` → подпись восстанавливается),
 * либо падает на `init`, но второй грант не минтует никогда.
 *
 * `LOOKUP_FAILED` — RPC недоступен, отправлять вслепую нельзя: ждём следующий
 * такт. `GRANT_FAILED` — неклассифицированный отказ; закрывать его без
 * разбора дороже, чем повторить.
 */
export const RETRYABLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "CONFIRM_TIMEOUT",
  "BLOCKHASH_EXPIRED",
  "LOOKUP_FAILED",
  "GRANT_FAILED",
]);

/** Терминальный отказ означает «повторять нечего» (детерминированный отказ). */
export function isTerminalFailure(code: string): boolean {
  return !RETRYABLE_FAILURE_CODES.has(code);
}

const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/**
 * Фаза подтверждения: добирает `submitted`-интенты без слота.
 *
 * Почему это отдельная фаза, а не ветка основного цикла. Основной цикл берёт
 * только `pending` (view `reward_intents_actionable`), а `markConfirmed` может не
 * пройти уже ПОСЛЕ того, как транзакция ушла: таймаут подтверждения, рестарт
 * между `markSubmitted` и `markConfirmed`, `slot === undefined` в ответе RPC.
 * Такой интент не возвращается в `pending` (переход `submitted → pending`
 * запрещён машиной состояний), поэтому единственный способ его закрыть —
 * перечитать историю PDA `[b"reward", ata, nonce]`: если грант на цепи есть,
 * подтверждаем по его подписи и слоту.
 *
 * Ошибки не терминальны: интент остаётся `submitted`, следующий такт повторит.
 * Закрывать его `failed` нельзя — деньги уже могли уйти получателю.
 */
async function reconcileSubmitted(
  deps: DeliveryWorkerDeps,
  result: DeliveryWorkerResult,
  limit: number,
): Promise<void> {
  if (!deps.listAwaitingConfirmation) return;
  let rows: WorkerIntent[];
  try {
    rows = await deps.listAwaitingConfirmation(limit);
  } catch (error) {
    result.errors.push({ id: "-", code: "RECONCILE_LIST_FAILED" });
    console.error("[reward-delivery] cannot list submitted intents:", error instanceof Error ? error.message : error);
    return;
  }

  for (const intent of rows) {
    result.picked += 1;
    if (!BASE58.test(intent.recipientAta) || intent.nonce < 0n) {
      result.errors.push({ id: intent.id, code: "BAD_INTENT_ROW" });
      console.error(`[reward-delivery] intent ${intent.id}: submitted row violates grant bounds`);
      continue;
    }
    // Без записанной подписи сверять нечего: `markConfirmed` требует её точного
    // совпадения, а придумать её вместо цепи нельзя.
    if (!intent.signature || !BASE58_SIGNATURE.test(intent.signature)) {
      result.errors.push({ id: intent.id, code: "MISSING_SIGNATURE" });
      console.error(`[reward-delivery] intent ${intent.id}: submitted without a usable signature`);
      continue;
    }
    let grant: GrantLookup | null;
    try {
      grant = await deps.lookupExistingGrant(intent);
    } catch (error) {
      result.retryable += 1;
      result.errors.push({ id: intent.id, code: "LOOKUP_FAILED" });
      console.error(`[reward-delivery] intent ${intent.id} confirmation lookup failed:`, error instanceof Error ? error.message : error);
      continue;
    }
    if (!grant || grant.slot === undefined) {
      // Транзакция подтверждена не finality-уровнем: ждём следующий такт.
      result.retryable += 1;
      continue;
    }
    if (grant.signature !== intent.signature) {
      result.errors.push({ id: intent.id, code: "SIGNATURE_MISMATCH" });
      console.error(`[reward-delivery] intent ${intent.id}: PDA created by ${grant.signature}, intent records ${intent.signature}`);
      continue;
    }
    try {
      await deps.markConfirmed({ id: intent.id, slot: grant.slot, signature: grant.signature, actor: deps.actor });
      result.reconciled += 1;
      result.confirmed += 1;
    } catch (error) {
      result.errors.push({ id: intent.id, code: "MARK_CONFIRMED_REJECTED" });
      console.error(`[reward-delivery] intent ${intent.id} markConfirmed rejected:`, error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Один такт. Порядок важен: сначала фиксируем «отправлено» (подпись уже есть),
 * потом «подтверждено». Обратный порядок оставил бы интент в pending с
 * существующим грантом — ровно тот случай, который приходится разбирать руками.
 */
export async function runDeliveryOnce(deps: DeliveryWorkerDeps): Promise<DeliveryWorkerResult> {
  const limit = Math.max(1, Math.min(deps.limit ?? 10, MAX_LIMIT));
  const rows = await deps.listActionable(limit);
  const result: DeliveryWorkerResult = {
    picked: rows.length,
    submitted: 0,
    confirmed: 0,
    failed: 0,
    retryable: 0,
    recovered: 0,
    reconciled: 0,
    errors: [],
  };

  // Сначала закрываем уже отправленное: иначе интент, у которого не записалось
  // подтверждение, не вернётся в очередь никогда.
  await reconcileSubmitted(deps, result, limit);

  const recordFailure = async (intent: WorkerIntent, code: string, error: unknown) => {
    result.errors.push({ id: intent.id, code });
    const detail = error instanceof Error ? error.message : error;
    if (!isTerminalFailure(code)) {
      result.retryable += 1;
      console.error(`[reward-delivery] intent ${intent.id} deferred (${code}): ${detail}`);
      return;
    }
    result.failed += 1;
    console.error(`[reward-delivery] intent ${intent.id} failed: ${code}`, detail);
    try {
      await deps.markFailed({ id: intent.id, failureCode: code, actor: deps.actor });
    } catch (transitionError) {
      // Терминальное состояние или гонка с другим воркером — не повод падать.
      result.errors.push({ id: intent.id, code: "MARK_FAILED_REJECTED" });
      console.error(`[reward-delivery] intent ${intent.id} markFailed rejected:`, transitionError instanceof Error ? transitionError.message : transitionError);
    }
  };

  const finish = async (intent: WorkerIntent, grant: GrantLookup, recovered: boolean) => {
    if (intent.state === "pending") {
      await deps.markSubmitted({ id: intent.id, signature: grant.signature, actor: deps.actor });
      result.submitted += 1;
    }
    if (recovered) result.recovered += 1;
    if (grant.slot === undefined) return;
    await deps.markConfirmed({ id: intent.id, slot: grant.slot, signature: grant.signature, actor: deps.actor });
    result.confirmed += 1;
  };

  for (const intent of rows) {
    if (!BASE58.test(intent.recipientAta) || intent.amountMicro <= 0n || intent.amountMicro > MAX_GRANT_MICRO || intent.nonce < 0n) {
      await recordFailure(intent, "BAD_INTENT_ROW", new Error("intent row violates grant bounds"));
      continue;
    }

    let existing: GrantLookup | null = null;
    try {
      existing = await deps.lookupExistingGrant(intent);
    } catch (error) {
      // RPC недоступен: не отправляем вслепую — иначе рискуем второй попыткой.
      await recordFailure(intent, "LOOKUP_FAILED", error);
      continue;
    }
    if (existing) {
      try {
        await finish(intent, existing, true);
      } catch (error) {
        await recordFailure(intent, "MARK_RECOVERED_FAILED", error);
      }
      continue;
    }

    let grant: GrantLookup;
    try {
      grant = await deps.executeGrant(intent);
    } catch (error) {
      const code = failureCodeFrom(error);
      if (code === "ALREADY_ON_CHAIN") {
        // Гонка двух воркеров: цепь уже приняла грант, подпись восстанавливаем.
        try {
          const raced = await deps.lookupExistingGrant(intent);
          if (raced) {
            await finish(intent, raced, true);
            continue;
          }
        } catch (lookupError) {
          await recordFailure(intent, "LOOKUP_FAILED", lookupError);
          continue;
        }
      }
      await recordFailure(intent, code, error);
      continue;
    }

    try {
      await finish(intent, grant, false);
    } catch (error) {
      // Транзакция ушла, но БД не подтвердила переход: следующий такт
      // восстановит по lookupExistingGrant, поэтому не помечаем failed.
      result.errors.push({ id: intent.id, code: "MARK_SUBMITTED_FAILED" });
      console.error(`[reward-delivery] intent ${intent.id} sent ${grant.signature} but DB transition failed:`, error instanceof Error ? error.message : error);
    }
  }

  return result;
}

export interface DeliveryWorkerHandle {
  stop: () => void;
  runNow: () => Promise<DeliveryWorkerResult>;
}

/**
 * Периодический запуск. `intervalSeconds <= 0` — воркер выключен (нормальное
 * состояние до включения рельсы): никакого таймера, никаких логов-обманок.
 */
export function startDeliveryWorker(
  deps: DeliveryWorkerDeps,
  intervalSeconds: number,
  log: (message: string) => void = (message) => console.log(`[reward-delivery] ${message}`),
): DeliveryWorkerHandle | null {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return null;
  let running = false;
  const runNow = async (): Promise<DeliveryWorkerResult> => {
    if (running) return { picked: 0, submitted: 0, confirmed: 0, failed: 0, retryable: 0, recovered: 0, reconciled: 0, errors: [] };
    running = true;
    try {
      const result = await runDeliveryOnce(deps);
      if (result.picked > 0) {
        log(`picked=${result.picked} submitted=${result.submitted} confirmed=${result.confirmed} reconciled=${result.reconciled} failed=${result.failed} retryable=${result.retryable} recovered=${result.recovered}`);
      }
      return result;
    } finally {
      running = false;
    }
  };
  log(`every ${intervalSeconds}s actor=${deps.actor}`);
  const timer = setInterval(() => { void runNow().catch((error) => console.error("[reward-delivery] tick failed:", error)); }, intervalSeconds * 1000);
  timer.unref?.();
  return { stop: () => clearInterval(timer), runNow };
}
