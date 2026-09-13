/// <reference types="vite/client" />

interface ImportMetaEnv {
 readonly VITE_RPC_URL?: string
 readonly VITE_SOLANA_CLUSTER?: 'localnet' | 'devnet' | 'testnet' | 'mainnet-beta'
 readonly VITE_PROGRAM_ID: string
 readonly VITE_BACKEND_URL?: string
}

interface ImportMeta {
 readonly env: ImportMetaEnv
}
