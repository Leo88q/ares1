// Легаси-рынок (V1) закрыт на запись в программе (P2-2): `create_sell_order`
// отвечает `LegacyMarketClosed`, поэтому экран V2 — основной, а не opt-in.
// Явный `VITE_MARKET_V2_ENABLED=false` остаётся только как аварийный откат UI:
// вернуться к V1-форме создания ордера он не даёт — программа откажет.
// Флаг публичный (попадает в бандл) и никогда не деплоит и не апгрейдит программу.
export const MARKET_V2_ENABLED = import.meta.env.VITE_MARKET_V2_ENABLED !== 'false'
