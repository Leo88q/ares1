import type { Server } from "node:http";

/**
 * Graceful shutdown бэкенда (SIGTERM/SIGINT).
 *
 * Порядок — суть фикса: раньше обработчик сигнала сразу закрывал пул
 * game_ops и вызывал process.exit, хотя HTTP-сервер продолжал принимать
 * запросы, а крон эпохи мог находиться посреди roll_epoch под advisory
 * lock из того же пула. Комментарий обещал «сначала перестаём принимать
 * запросы», но handle сервера даже не сохранялся.
 *
 * Теперь последовательность строгая и тестируемая без сети:
 *   1. остановить крон эпохи и дождаться идущего такта;
 *   2. закрыть HTTP-сервер (не принимать новые, дождаться текущих);
 *      если клиенты держат keep-alive дольше `forceAfterMs` — разрушить
 *      оставшиеся соединения, а не висеть до SIGKILL оркестратора;
 *   3. закрыть пул game_ops;
 *   4. выйти с кодом 0.
 * Сбой любого шага логируется и НЕ отменяет остальные: процесс обязан
 * завершиться, а не зависнуть в полумёртвом состоянии. Повторный сигнал
 * во время остановки возвращает тот же промис (идемпотентность).
 */

export interface ShutdownServer {
  close(callback?: (err?: Error) => void): unknown;
  closeAllConnections?: () => void;
}

export interface ShutdownDeps {
  /** Остановка крона эпохи (см. EpochRollerHandle.stop). */
  stopRoller?: () => Promise<void> | void;
  /** HTTP-сервер из app.listen(...); null — сервера ещё нет. */
  server?: ShutdownServer | Server | null;
  /** Закрытие пула game_ops; отсутствует, когда слой данных выключен. */
  closePool?: () => Promise<void>;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  logError?: (message: string) => void;
  /** Сколько ждать дренажа HTTP перед разрушением соединений. */
  forceAfterMs?: number;
}

const DEFAULT_FORCE_AFTER_MS = 10_000;

export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const log = deps.log ?? ((message: string) => console.log(message));
  const logError = deps.logError ?? ((message: string) => console.error(message));
  const forceAfterMs = deps.forceAfterMs ?? DEFAULT_FORCE_AFTER_MS;
  let inProgress: Promise<void> | null = null;

  const closeServer = async (): Promise<void> => {
    const server = deps.server;
    if (!server) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(() => {
        log(`[shutdown] HTTP не дренировался за ${forceAfterMs}ms — разрушаю оставшиеся соединения`);
        try {
          server.closeAllConnections?.();
        } catch (err) {
          logError(`[shutdown] closeAllConnections не удался: ${String(err)}`);
        }
        settle();
      }, forceAfterMs);
      // Таймер намеренно НЕ unref'ится: он — гарантия, что дренаж не зависнет
      // навсегда, а после завершения shutdown процесс и так выходит явно.
      try {
        // Ошибка в колбэке (например, сервер не слушал) не должна блокировать
        // остановку: цель шага — «новых запросов нет», а не отчёт об успехе.
        server.close(() => {
          clearTimeout(timer);
          settle();
        });
      } catch (err) {
        clearTimeout(timer);
        logError(`[shutdown] server.close бросил исключение: ${String(err)}`);
        settle();
      }
    });
  };

  const run = async (signal: string): Promise<void> => {
    log(`[shutdown] ${signal}: останавливаю крон эпохи, дренирую HTTP, закрываю пул game_ops`);
    try {
      await deps.stopRoller?.();
    } catch (err) {
      logError(`[shutdown] остановка крона эпохи не удалась: ${String(err)}`);
    }
    await closeServer();
    try {
      await deps.closePool?.();
    } catch (err) {
      logError(`[shutdown] закрытие пула game_ops не удалось: ${String(err)}`);
    }
    exit(0);
  };

  return (signal: string): Promise<void> => {
    if (inProgress) {
      log(`[shutdown] ${signal}: остановка уже идёт`);
      return inProgress;
    }
    inProgress = run(signal);
    return inProgress;
  };
}
