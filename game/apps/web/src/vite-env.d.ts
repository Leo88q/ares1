/// <reference types="vite/client" />

interface ImportMetaEnv {
 readonly VITE_RPC_URL?: string
 readonly VITE_SOLANA_CLUSTER?: 'localnet' | 'devnet' | 'testnet' | 'mainnet-beta'
 readonly VITE_PROGRAM_ID: string
 readonly VITE_BACKEND_URL?: string
 /** Must remain false until the V2 program is deployed to the configured cluster and tier limits are approved. */
 readonly VITE_MARKET_V2_ENABLED?: 'true' | 'false'
}

interface ImportMeta {
 readonly env: ImportMetaEnv
}
