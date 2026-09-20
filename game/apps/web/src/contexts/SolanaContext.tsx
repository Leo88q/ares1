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
   if (!wallet.publicKey || !wallet.signTransaction || !wallet.sendTransaction) throw new Error(t('Кошелёк не подключён.'))
   const MISSING_SIG = t('Кошелёк не вернул подпись транзакции. Отключите кошелёк в настройках игры и подключите заново.')
   const activeAdapter =
    (wallet as { wallet?: { adapter?: { name?: string; connect: () => Promise<void>; disconnect: () => Promise<void> } } | null })
     .wallet?.adapter ?? null
   const walletName = activeAdapter?.name ?? '?'
   // Диагностика «зombie»-сессии: какой адаптер подключён и какие in-app
   // провайдеры видит браузер (на телефонах это ключ к пониманию сбоя).
   const dumpDiag = (detail: string[]) => {
    const w = window as unknown as { phantom?: { isPhantom?: () => boolean }; solana?: { isSolflare?: boolean } }
    console.error('[potato] wallet returned unsigned tx', {
     wallet: walletName,
     publicKey: wallet.publicKey?.toBase58(),
     detail,
     windowPhantom: !!w.phantom,
     phantomInApp: typeof w.phantom?.isPhantom === 'function' ? w.phantom.isPhantom() : null,
     windowSolana: !!w.solana,
     solflareInApp: !!w.solana?.isSolflare,
    })
   }
   // Проверка ПО КЛЮЧАМ, а не по числу: ловит и «подписей нет», и
   // «подписал другой аккаунт, чем feePayer».
   const missingSigners = (signed: Transaction): string[] => {
    const msg = signed.compileMessage()
    const missing: string[] = []
    for (let i = 0; i < msg.header.numRequiredSignatures; i++) {
     const key = msg.staticAccountKeys[i]
     const pair = signed.signatures[i]
     if (!pair || pair.signature === null || !pair.publicKey.equals(key)) missing.push(key.toBase58())
    }
    return missing
   }
   try {
    // Добавляем приоритетную комиссию и compute budget для стабильности при нагрузке
    const { ComputeBudgetProgram } = await import('@solana/web3.js')
    const priorityIxs: typeof ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      ...ixs,
    ]
    const tx = new Transaction().add(...priorityIxs)
    const { blockhash, lastValidBlockHeight } = await withRetry(() => connection.getLatestBlockhash('confirmed'))
    tx.recentBlockhash = blockhash
    tx.feePayer = wallet.publicKey
    // Явная подпись кошельком + локальная проверка, что ВСЕ required-сигнатуры
    // на месте: мобильные кошельки (Phantom, shim встроенных в-апп кошельков)
    // при «восстановленной» сессии иногда возвращают транзакцию с null-подписью,
    // и без проверки ошибка улетала бы в сеть («Missing signature for public key»).
    let signed = (await wallet.signTransaction(tx)) as Transaction
    let missing = missingSigners(signed)
    if (missing.length > 0) {
     // Первая попытка вернула неподписанную tx — сессия «зombie»: кошелёк
     // «знает» аккаунт, но подпись не отдаёт. Переподключаем кошелёк (свежая
     // авторизация — на Seeker это повторный отпечаток пальца) и пробуем ещё раз.
     if (activeAdapter) {
      await activeAdapter.disconnect()
      await activeAdapter.connect()
     }
     signed = (await wallet.signTransaction(tx)) as Transaction
     missing = missingSigners(signed)
    }
    if (missing.length > 0) {
     dumpDiag(missing)
     throw new Error(`${MISSING_SIG} (${walletName})`)
    }
    let raw: Buffer
    try {
     raw = signed.serialize() // requireAllSignatures: true — финальная страховка
    } catch {
     throw new Error(MISSING_SIG)
    }
    // Preflight simulation для раннего отлова ошибок программы
    const sim = await connection.simulateTransaction(signed)
    if (sim.value.err) {
      const logs = (sim.value.logs ?? []).join('\n')
      // Если симуляция показывает кастомную ошибку — пробрасываем её сразу
      if (/custom program error|AlreadyClaimed|BadProof|Paused|HarvestTooSoon|EpochCapExceeded/i.test(logs)) {
        throw new Error(logs.slice(0, 400))
      }
    }
    const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 })
    const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    if (res.value.err) throw new Error(t('Транзакция отклонена сетью: {err}', { err: JSON.stringify(res.value.err) }))
    return sig
   } catch (err) {
    const msg = describeError(err)
    // RPC-вариант того же сбоя: подпись не доехала до сети.
    if (/Signature verification failed|Missing signature/i.test(msg)) {
     dumpDiag([msg])
     throw new Error(`${MISSING_SIG} (${walletName})`)
    }
    throw new Error(msg)
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
