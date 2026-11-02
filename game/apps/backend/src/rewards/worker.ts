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
    errors: [],
  };

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
    if (running) return { picked: 0, submitted: 0, confirmed: 0, failed: 0, retryable: 0, recovered: 0, errors: [] };
    running = true;
    try {
      const result = await runDeliveryOnce(deps);
      if (result.picked > 0) {
        log(`picked=${result.picked} submitted=${result.submitted} confirmed=${result.confirmed} failed=${result.failed} retryable=${result.retryable} recovered=${result.recovered}`);
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
