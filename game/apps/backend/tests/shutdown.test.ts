import assert from "node:assert/strict";
import { test } from "node:test";
import { createShutdown, type ShutdownServer } from "../src/shutdown.js";

/** Фейковый HTTP-сервер: close() не завершается, пока тест не вызовет колбэк. */
function fakeServer(events: string[]) {
  let closeCallback: ((err?: Error) => void) | undefined;
  const server: ShutdownServer = {
    close(cb) {
      events.push("server.close");
      closeCallback = cb;
    },
    closeAllConnections() {
      events.push("server.closeAllConnections");
    },
  };
  return {
    server,
    completeClose() {
      closeCallback?.();
    },
  };
}

test("shutdown: порядок — крон, HTTP-дренаж, пул, выход; пул ждёт закрытия сервера", async () => {
  const events: string[] = [];
  const { server, completeClose } = fakeServer(events);
  let exitCode: number | null = null;
  const shutdown = createShutdown({
    stopRoller: async () => { events.push("roller.stop"); },
    server,
    closePool: async () => { events.push("pool.close"); },
    exit: (code) => { exitCode = code; events.push(`exit:${code}`); },
    log: () => undefined,
    logError: () => undefined,
  });

  const pending = shutdown("SIGTERM");
  // Дать шагам до server.close выполниться, но не завершать дренаж.
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(events, ["roller.stop", "server.close"], "пул не должен закрываться до дренажа HTTP");

  completeClose();
  await pending;
  assert.deepEqual(events, ["roller.stop", "server.close", "pool.close", "exit:0"]);
  assert.equal(exitCode, 0);
});

test("shutdown: зависший keep-alive разрушается по forceAfterMs, процесс всё равно выходит", async () => {
  const events: string[] = [];
  const { server } = fakeServer(events); // completeClose сознательно не вызываем
  const shutdown = createShutdown({
    server,
    closePool: async () => { events.push("pool.close"); },
    exit: (code) => { events.push(`exit:${code}`); },
    log: () => undefined,
    logError: () => undefined,
    forceAfterMs: 25,
  });

  await shutdown("SIGTERM");
  assert.deepEqual(events, ["server.close", "server.closeAllConnections", "pool.close", "exit:0"]);
});

test("shutdown: повторный сигнал не запускает вторую остановку", async () => {
  const events: string[] = [];
  const { server, completeClose } = fakeServer(events);
  let closes = 0;
  const shutdown = createShutdown({
    stopRoller: async () => { closes += 1; },
    server,
    closePool: async () => { closes += 1; },
    exit: () => { closes += 1; },
    log: () => undefined,
    logError: () => undefined,
  });

  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT");
  assert.equal(first, second, "второй вызов возвращает тот же промис");
  await new Promise(r => setTimeout(r, 10));
  completeClose();
  await Promise.all([first, second]);
  assert.equal(closes, 3, "каждый шаг выполнен ровно один раз");
});

test("shutdown: сбой крона не отменяет закрытие пула и выход", async () => {
  const events: string[] = [];
  const errors: string[] = [];
  const { server, completeClose } = fakeServer(events);
  const shutdown = createShutdown({
    stopRoller: async () => { throw new Error("roller boom"); },
    server,
    closePool: async () => { events.push("pool.close"); },
    exit: (code) => { events.push(`exit:${code}`); },
    log: () => undefined,
    logError: (m) => { errors.push(m); },
  });

  const pending = shutdown("SIGTERM");
  await new Promise(r => setTimeout(r, 10));
  completeClose();
  await pending;
  assert.deepEqual(events.slice(-2), ["pool.close", "exit:0"]);
  assert.ok(errors.some(m => m.includes("roller boom")), "сбой крона залогирован");
});

test("shutdown: без сервера и пула просто выходит", async () => {
  let exitCode: number | null = null;
  const shutdown = createShutdown({
    exit: (code) => { exitCode = code; },
    log: () => undefined,
    logError: () => undefined,
  });
  await shutdown("SIGINT");
  assert.equal(exitCode, 0);
});
