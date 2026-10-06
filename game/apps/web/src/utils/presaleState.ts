/**
 * PresaleState (lib.rs:3265) — чтение sold/cap тиража из аккаунта цепи.
 *
 * Layout: 8 (Anchor discriminator) + 32 (authority) + 4 (sold, u32 LE)
 *         + 4 (cap, u32 LE) + 8 (price_lamports, u64 LE) + 1 (bump) = 57 байт
 * (таблица аккаунтов в game/docs/API.md).
 *
 * Зачем отдельный модуль: `cap` задаёт оператор при `init_presale(cap, …)`
 * (init-onchain.ts открывает волну с cap=500), и аккаунт — единственный
 * источник правды. Хардкод в UI однажды покажет покупателю не тот лимит, и
 * заметят это только по факту. Landing читает те же смещения в
 * `landing/hooks/useLiveChain.ts`; совпадение всех трёх копий раскладки
 * (Rust → landing → web) закреплено тестом tests/offchain/presaleState.test.ts.
 */
export const PRESALE_STATE_SOLD_OFFSET = 8 + 32; // 40
export const PRESALE_STATE_CAP_OFFSET = 8 + 32 + 4; // 44
/** Меньше этого — читать sold/cap не из чего: аккаунт не наш или не создан. */
export const PRESALE_STATE_MIN_LENGTH = PRESALE_STATE_CAP_OFFSET + 4; // 48

export interface PresaleStateView {
  /** Сколько полей продано (u32). */
  sold: number;
  /** Лимит тиража (u32). 0 — аккаунт ещё не инициализирован. */
  cap: number;
}

/** null — данных меньше, чем нужно для sold/cap (см. PRESALE_STATE_MIN_LENGTH). */
export function decodePresaleState(data: Uint8Array): PresaleStateView | null {
  if (data.length < PRESALE_STATE_MIN_LENGTH) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    sold: view.getUint32(PRESALE_STATE_SOLD_OFFSET, true),
    cap: view.getUint32(PRESALE_STATE_CAP_OFFSET, true),
  };
}
