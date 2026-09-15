import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react'
import { t } from '../i18n'

import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { decodeConfig, decodeEpoch, DecodedConfig, DecodedEpoch, pdas } from '../utils/anchorClient'
import { describeError } from '../utils/errors'
import { withRetry } from '../utils/rpc'
import { usePolling } from '../hooks/usePolling'

// Fail-fast: без VITE_PROGRAM_ID сборка не должна молча указывать на старый адрес.
const rawProgramId = import.meta.env.VITE_PROGRAM_ID
if (!rawProgramId) {
 throw new Error('VITE_PROGRAM_ID не задан (см. apps/web/.env.example) — отказ от запуска вместо старого захардкоженного program id')
}
export const PROGRAM_ID = new PublicKey(rawProgramId)
export const CLUSTER = import.meta.env.VITE_SOLANA_CLUSTER || 'devnet'
export const IS_MAINNET = CLUSTER === 'mainnet-beta'
export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

const CONFIG_POLL_MS = 30_000

interface SolanaContextType {
 connection: Connection
 programId: PublicKey
 publicKey: PublicKey | null
 connected: boolean
 /** True once the on-chain GameConfig has been read. */
 ready: boolean
 config: DecodedConfig | null
 epoch: DecodedEpoch | null
 /** Last RPC error while loading config, for graceful degradation UI. */
 rpcError: string | null
 sendIx: (ixs: TransactionInstruction[]) => Promise<string>
 refreshConfig: () => Promise<void>
}

const SolanaContext = createContext<SolanaContextType | undefined>(undefined)

export function SolanaProvider({ children }: { children: ReactNode }) {
 const { connection } = useConnection()
 const wallet = useWallet()
 const [config, setConfig] = useState<DecodedConfig | null>(null)
 const [epoch, setEpoch] = useState<DecodedEpoch | null>(null)
 const [rpcError, setRpcError] = useState<string | null>(null)

 const refreshConfig = useCallback(async () => {
  const { config: configPda, epoch: epochPda } = pdas(PROGRAM_ID)
  try {
   const info = await withRetry(() => connection.getAccountInfo(configPda()))
   if (!info) {
    setConfig(null)
    setEpoch(null)
    setRpcError(t('GameConfig не найден: программа не инициализирована на этом кластере.'))
    return
   }
   const cfg = decodeConfig(info.data)
   setConfig(cfg)
   const epochInfo = await withRetry(() => connection.getAccountInfo(epochPda(cfg.epochId)))
   setEpoch(epochInfo ? decodeEpoch(epochInfo.data) : null)
   setRpcError(null)
  } catch (err) {
   setRpcError(describeError(err))
   throw err
  }
 }, [connection])

 usePolling(refreshConfig, CONFIG_POLL_MS)

 const sendIx = useCallback(
  async (ixs: TransactionInstruction[]): Promise<string> => {
   if (!wallet.publicKey || !wallet.sendTransaction) throw new Error(t('Кошелёк не подключён.'))
   try {
    const tx = new Transaction().add(...ixs)
    const { blockhash, lastValidBlockHeight } = await withRetry(() => connection.getLatestBlockhash('confirmed'))
    tx.recentBlockhash = blockhash
    tx.feePayer = wallet.publicKey
    const sig = await wallet.sendTransaction(tx, connection)
    const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    if (res.value.err) throw new Error(t('Транзакция отклонена сетью: {err}', { err: JSON.stringify(res.value.err) }))
    return sig
   } catch (err) {
    throw new Error(describeError(err))
   }
  },
  [wallet, connection],
 )

 const value = useMemo<SolanaContextType>(
  () => ({
   connection,
   programId: PROGRAM_ID,
   publicKey: wallet.publicKey,
   connected: wallet.connected,
   ready: config !== null,
   config,
   epoch,
   rpcError,
   sendIx,
   refreshConfig,
  }),
  [connection, wallet.publicKey, wallet.connected, config, epoch, rpcError, sendIx, refreshConfig],
 )

 return <SolanaContext.Provider value={value}>{children}</SolanaContext.Provider>
}

export function useSolana(): SolanaContextType {
 const ctx = useContext(SolanaContext)
 if (!ctx) throw new Error('useSolana must be used within SolanaProvider')
 return ctx
}
