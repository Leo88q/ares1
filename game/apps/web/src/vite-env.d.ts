/// <reference types="vite/client" />

interface ImportMetaEnv {
 readonly VITE_RPC_URL?: string
 readonly VITE_SOLANA_CLUSTER?: 'localnet' | 'devnet' | 'testnet' | 'mainnet-beta'
 readonly VITE_PROGRAM_ID: string
 readonly VITE_BACKEND_URL?: string
 /** Defaults ON: V1 listings are closed in the program (P2-2); `false` is an emergency UI rollback only. */
 readonly VITE_MARKET_V2_ENABLED?: 'true' | 'false'
}

interface ImportMeta {
 readonly env: ImportMetaEnv
}
