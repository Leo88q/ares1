/**
 * Postgres-реализация RollLock: сессионная advisory-блокировка `game_ops`.
 *
 * Почему advisory-лок, а не таблица-лиз: блокировка снимается автоматически,
 * когда соединение закрывается (падение процесса, evict контейнера, рестарт
 * пода) — не остаётся «вечного замка», который нужно чистить руками. Ключ
 * фиксирован и общий для всех версий: если заменить его при апгрейде, старый и
 * новый инстанс будут держать РАЗНЫЕ замки и дублировать работу.
 *
 * Соединение берётся из основного пула game_ops и удерживается на время ролла
 * (несколько секунд раз в `EPOCH_ROLL_CRON`); пул умеет `connectionTimeoutMillis`
 * (5 с) — недоступная БД превращается в быстрый отказ, который rollLock.ts
 * обрабатывает fail-open.
 */

import type { Client, Pool } from "./pool.js";

/** ASCII "ares1" — стабильный ключ. НЕ менять: см. предупреждение выше. */
export const EPOCH_ROLLER_LOCK_KEY = 0x6172657331n;

export function createPgRollLock(pool: Pool) {
  // Сессионная блокировка живёт на конкретном соединении — держим его, пока
  // блокировка нам нужна, и освобождаем только вместе с `pg_advisory_unlock`.
  let held: Client | null = null;

  const key = EPOCH_ROLLER_LOCK_KEY.toString();

  return {
    async acquire(): Promise<boolean> {
      if (held) return true; // повторный вход в одном процессе — блокировка уже наша
      const client = await pool.connect();
      try {
        const res = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock($1::bigint) AS locked",
          [key],
        );
        if (!res.rows[0]?.locked) {
          client.release();
          return false;
        }
        held = client;
        return true;
      } catch (err) {
        client.release(true); // соединение в неизвестном состоянии — уничтожаем
        throw err;
      }
    },

    async release(): Promise<void> {
      const client = held;
      held = null;
      if (!client) return;
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
        client.release();
      } catch {
        // Unlock не прошёл (например, соединение уже мертво) — сервер снимет
        // блокировку вместе с сессией; важно лишь не вернуть битое соединение в пул.
        client.release(true);
      }
    },
  };
}
