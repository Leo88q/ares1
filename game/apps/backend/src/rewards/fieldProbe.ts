/**
 * Ончейн-проверка «у кошелька есть активное поле».
 *
 * Зачем она в рельсе наград. Дейлик (7 POTATO в UTC-сутки) — единственная
 * выдача, которая повторяется вечно. Пока условием был только валидный адрес,
 * 2 857 кошельков в сутки вычерпывали суточный бюджет рельсы и ончейн-квоту
 * грантов, не сделав в игре ни одного действия. Теперь дейлик получает только
 * тот, у кого уже есть **активное** поле: стартовые 250 POTATO на него и
 * выдаются, а поле — единственное, что вообще производит POTATO.
 *
 * Как проверяется. `Field` — PDA программы, владелец записан в первых 32 байтах
 * после 8-байтного дискриминатора Anchor. Поэтому достаточно
 * `getProgramAccounts` с фильтрами `dataSize = 78` и
 * `memcmp(offset = 8, bytes = wallet)`, а затем прочитать байт `is_active`.
 * Никаких доверенных индексов и БД: ответ даёт цепь.
 *
 * Смещения ниже — зеркало `pub struct Field` в lib.rs. Их сверяет тест
 * `tests/reward-field-probe.test.ts`: он разбирает объявление структуры в Rust
 * и пересчитывает раскладку, поэтому молчаливый сдвиг поля в контракте
 * (layout v4) уронит CI, а не выдачу наград.
 */

/** Полный размер аккаунта Field: 8 байт дискриминатора + 70 байт полей. */
export const FIELD_ACCOUNT_BYTES = 78;
/** `owner: Pubkey` — сразу после дискриминатора. */
export const FIELD_OWNER_OFFSET = 8;
/**
 * `is_active: bool` — owner(32) + level(1) + durability(1) + last_harvest(8) +
 * tax_paid_until(8) + fertilizer_until(8).
 */
export const FIELD_IS_ACTIVE_OFFSET = 8 + 32 + 1 + 1 + 8 + 8 + 8;

/** Минимальный вид аккаунта, который отдаёт `getProgramAccounts`. */
export interface RawAccount {
  account: { data: Uint8Array | Buffer; }
}

/**
 * Есть ли среди аккаунтов хотя бы одно активное поле.
 *
 * Проверка размера обязательна: RPC-фильтр `dataSize` отсекает чужие аккаунты,
 * но ответ может прийти из кеша/прокси, и читать байт 66 у 70-байтного
 * legacy-аккаунта (layout v2) означало бы читать `is_active` со сдвигом.
 */
export function hasActiveField(accounts: ReadonlyArray<RawAccount>): boolean {
  return accounts.some(({ account }) => {
    const data = account.data;
    return data.length === FIELD_ACCOUNT_BYTES && data[FIELD_IS_ACTIVE_OFFSET] === 1;
  });
}

export interface FieldProbe {
  (wallet: string): Promise<boolean>;
}

/**
 * Кеш вокруг RPC-проверки.
 *
 * `getProgramAccounts` — дорогой вызов, а дейлик жмут повторно (кулдаун 15 с,
 * ретраи после ошибок). Кеш на `ttlSeconds` держит его дешёвым, но при этом
 * не превращается в источник правды: истёкшая запись перечитывается с цепи.
 * Размер карты ограничен, чтобы поток случайных адресов не съел память; при
 * переполнении выбрасываются только истёкшие записи, живые не трогаются.
 */
export function createFieldProbe(input: {
  lookup: (wallet: string) => Promise<boolean>;
  now: () => number;
  ttlSeconds?: number;
  maxEntries?: number;
}): FieldProbe {
  const ttl = input.ttlSeconds ?? 300;
  const maxEntries = input.maxEntries ?? 5_000;
  const cache = new Map<string, { value: boolean; expiresAt: number }>();

  return async (wallet: string): Promise<boolean> => {
    const now = input.now();
    const cached = cache.get(wallet);
    if (cached && cached.expiresAt > now) return cached.value;

    if (cache.size >= maxEntries) {
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key);
      }
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string);
    }

    const value = await input.lookup(wallet);
    cache.set(wallet, { value, expiresAt: now + ttl });
    return value;
  };
}
