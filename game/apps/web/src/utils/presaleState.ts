/**
 * PresaleState (`PresaleState` в lib.rs) — чтение sold/cap/price из аккаунта цепи.
 *
 * Layout: 8 (Anchor discriminator) + 32 (authority) + 4 (sold, u32 LE)
 *         + 4 (cap, u32 LE) + 8 (price_lamports, u64 LE) + 1 (bump) = 57 байт
 * (таблица аккаунтов в game/docs/API.md).
 *
 * Зачем отдельный модуль: `cap` задаёт оператор при `init_presale(cap, …)`
 * (init-onchain.ts открывает волну с cap=500), а `price_lamports` — цена
 * SOL-пресейла, которую `buy_field_sol` берёт как базу и умножает на
 * `type_cost_bps`. Аккаунт — единственный источник правды: хардкод в UI однажды
 * покажет покупателю не тот лимит и не ту цену, и заметят это только по факту.
 *
 * `priceLamports === 0` — не «цена ноль», а аварийный стоп (`PresaleNotActive`):
 * программа закрывает так ОБЕ ветки покупки. Поэтому UI обязан показывать это
 * как «продажа закрыта», а не как бесплатное поле.
 *
 * Landing читает те же смещения в `landing/hooks/useLiveChain.ts`; совпадение
 * всех трёх копий раскладки (Rust → landing → web) закреплено тестом
 * tests/offchain/presaleState.test.ts.
 */
export const PRESALE_STATE_SOLD_OFFSET = 8 + 32; // 40
export const PRESALE_STATE_CAP_OFFSET = 8 + 32 + 4; // 44
export const PRESALE_STATE_PRICE_LAMPORTS_OFFSET = 8 + 32 + 4 + 4; // 48
/** Меньше этого — читать sold/cap не из чего: аккаунт не наш или не создан. */
export const PRESALE_STATE_MIN_LENGTH = PRESALE_STATE_CAP_OFFSET + 4; // 48

export interface PresaleStateView {
  /** Сколько полей продано (u32). */
  sold: number;
  /** Лимит тиража (u32). 0 — аккаунт ещё не инициализирован. */
  cap: number;
  /** Цена SOL-пресейла в лампортах (u64). 0 — аварийный стоп пресейла. */
  priceLamports: bigint;
}

/** null — данных меньше, чем нужно для sold/cap (см. PRESALE_STATE_MIN_LENGTH). */
export function decodePresaleState(data: Uint8Array): PresaleStateView | null {
  if (data.length < PRESALE_STATE_MIN_LENGTH) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    sold: view.getUint32(PRESALE_STATE_SOLD_OFFSET, true),
    cap: view.getUint32(PRESALE_STATE_CAP_OFFSET, true),
    // Старый аккаунт (57 байт в текущем layout) всегда несёт цену; если данных
    // меньше — считаем цену нулевой, то есть «продажа закрыта», а не «бесплатно».
    priceLamports: data.length >= PRESALE_STATE_PRICE_LAMPORTS_OFFSET + 8
      ? view.getBigUint64(PRESALE_STATE_PRICE_LAMPORTS_OFFSET, true)
      : 0n,
  };
}

/**
 * Продажа открыта: тираж не выбран, цена не сброшена в ноль.
 *
 * Одна функция на все проверки (кнопка, подпись «осталось», гейт покупки),
 * чтобы UI не расходился сам с собой: «sold < cap» без проверки цены открыло бы
 * кнопку при включённом kill switch.
 */
export function presaleOpen(view: PresaleStateView | null): boolean {
  return Boolean(view && view.cap > 0 && view.sold < view.cap && view.priceLamports > 0n)
}

/** Сколько полей осталось по тиражу (0 — распродано или не открыт). */
export function presaleRemaining(view: PresaleStateView | null): number {
  if (!view || view.cap <= 0) return 0;
  return Math.max(0, view.cap - view.sold);
}

/** `type_cost_bps` из lib.rs: type 0 → 0.4×, 1 → 1×, 2 → 2× (целочисленно). */
export function presalePriceLamportsFor(
  view: PresaleStateView | null,
  fieldType: number,
  typeCostBps: readonly number[] = [4_000, 10_000, 20_000],
): bigint {
  if (!view || view.priceLamports <= 0n) return 0n;
  const bps = typeCostBps[fieldType];
  if (bps === undefined) return 0n;
  return (view.priceLamports * BigInt(bps)) / 10_000n;
}
