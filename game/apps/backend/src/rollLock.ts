/**
 * Взаимное исключение для крона эпохи.
 *
 * Зачем: `node-cron` живёт внутри процесса, а процессов может быть несколько
 * (хостинг с репликами, перекрытие старого и нового инстанса при выкатке).
 * Без общей блокировки каждый инстанс честно пытается сделать `roll_epoch`:
 * цепочка защищена (повторный roll падает на «эпоха ещё не истекла»), но чужие
 * падения дают ложные срабатывания алерт-лестницы 3/9/27 и жгут комиссии.
 * Блокировка — это **подавитель дублей**, а не предохранитель:
 *   - держит её другой инстанс → такт пропускается молча (штатная ситуация);
 *   - сама блокировка недоступна (нет БД/ошибка соединения) → такт выполняется
 *     БЕЗ блокировки с громким предупреждением. Эпоха важнее: если ledger-БД
 *     недоступна, игра всё равно должна катать эпохи, а от двойного roll_epoch
 *     защищает цепь, а не оффчейн.
 *
 * Интерфейс без зависимостей: транспорт (Postgres advisory lock) живёт в
 * gameops/epochLock.ts, тесты используют фейковую реализацию.
 */

import { safeError } from "./security.js";

export interface RollLock {
  /** true — блокировка взята; false — её держит другой инстанс. */
  acquire(): Promise<boolean>;
  /** Отпустить ранее взятую блокировку (идемпотентно). */
  release(): Promise<void>;
}

export interface LockedRun<T> {
  /** Выполнялась ли работа в этом такте. false — такт пропущен из-за блокировки. */
  ran: boolean;
  /** Результат, если работа выполнялась. */
  value: T | null;
}

export type LockLog = (message: string) => void;

/**
 * Выполняет `fn` под блокировкой, если она передана и свободна.
 * `fn` вызывается не более одного раза за такт; исключения из `fn` не глотаются
 * (для вызывающего это обычный сбой такта), но `release` выполняется всегда.
 */
export async function withEpochRollLock<T>(
  lock: RollLock | null,
  fn: () => Promise<T>,
  log: LockLog = () => {},
): Promise<LockedRun<T>> {
  if (!lock) return { ran: true, value: await fn() };

  let acquired: boolean;
  try {
    acquired = await lock.acquire();
  } catch (err) {
    log(`cross-instance lock unavailable (${safeError(err)}) — proceeding without it`);
    return { ran: true, value: await fn() };
  }

  if (!acquired) {
    log("another instance holds the roll lock — skipping this tick");
    return { ran: false, value: null };
  }

  try {
    return { ran: true, value: await fn() };
  } finally {
    await lock.release().catch((err) => {
      // Соединение могло умереть: сервер снимает advisory-блокировку вместе с
      // сессией, так что «не отпустили» здесь не оставляет вечный замок.
      log(`lock release failed (${safeError(err)}) — connection teardown releases it`);
    });
  }
}
