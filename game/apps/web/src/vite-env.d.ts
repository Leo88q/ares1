/// <reference types="vite/client" />

interface ImportMetaEnv {
 readonly VITE_RPC_URL?: string
 readonly VITE_SOLANA_CLUSTER?: 'localnet' | 'devnet' | 'testnet' | 'mainnet-beta'
 readonly VITE_PROGRAM_ID: string
 readonly VITE_BACKEND_URL?: string
 /** Must remain false until the V2 program is deployed to the configured cluster and tier limits are approved. */
 readonly VITE_MARKET_V2_ENABLED?: 'true' | 'false'
 readonly VITE_COLONY_MANUAL_HARVEST?: 'true' | 'false'
 /** S7 слоты грядок: по умолчанию выключено. Включение требует сервер, казну и цену (slots/config.ts). */
 readonly VITE_SLOTS_ENABLED?: 'true' | 'false'
 readonly VITE_SLOT_TREASURY_OWNER?: string
 /** Цена слота 7..12 в базовых единицах SKR (6 знаков), как SLOT_PRICE_UNITS на сервере. */
 readonly VITE_SLOT_PRICE_UNITS?: string
}

interface ImportMeta {
 readonly env: ImportMetaEnv
}
