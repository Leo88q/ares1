import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react'
import { t } from '../i18n'

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { decodeConfig, decodeEpoch, DecodedConfig, DecodedEpoch, pdas } from '../utils/anchorClient'
import { describeError } from '../utils/errors'
import { withRetry } from '../utils/rpc'
import { usePolling } from '../hooks/usePolling'
import { getLookupTable } from '../utils/lut'
import {
  assertInstructionsAllowed,
  assertSignedInstructionsMatch,
  assertSignedLegacyInstructionsMatch,
  describeInstructions,
} from '../utils/txSafety'

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
  ready: boolean
  config: DecodedConfig | null
  epoch: DecodedEpoch | null
  rpcError: string | null
  sendIx: (ixs: TransactionInstruction[], opts?: { lookupTables?: AddressLookupTableAccount[] }) => Promise<string>
  lookupTable: AddressLookupTableAccount | null
  ensureLookupTable: () => Promise<AddressLookupTableAccount | null>
  refreshConfig: () => Promise<void>
}

const SolanaContext = createContext<SolanaContextType | undefined>(undefined)

export function SolanaProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [config, setConfig] = useState<DecodedConfig | null>(null)
  const [epoch, setEpoch] = useState<DecodedEpoch | null>(null)
  const [rpcError, setRpcError] = useState<string | null>(null)
  const [lookupTable, setLookupTable] = useState<AddressLookupTableAccount | null>(null)

  const ensureLookupTable = useCallback(async (): Promise<AddressLookupTableAccount | null> => {
    if (!wallet.publicKey) return null
    if (lookupTable) return lookupTable
    try {
      const key = localStorage.getItem(`ares-lut:${wallet.publicKey.toBase58()}`)
      if (key) {
        const lut = await getLookupTable(connection, new PublicKey(key))
        if (lut) { setLookupTable(lut); return lut }
      }
    } catch { /* ignore */ }
    return null
  }, [wallet.publicKey, connection, lookupTable])

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
    async (ixs: TransactionInstruction[], opts?: { lookupTables?: AddressLookupTableAccount[] }): Promise<string> => {
      if (!wallet.publicKey || !wallet.signTransaction || !wallet.sendTransaction) throw new Error(t('Кошелёк не подключён.'))
      const MISSING_SIG = t('Кошелёк не вернул подпись транзакции. Отключите кошелёк в настройках игры и подключите заново.')
      const activeAdapter =
        (wallet as { wallet?: { adapter?: { name?: string; connect: () => Promise<void>; disconnect: () => Promise<void> } } | null })
          .wallet?.adapter ?? null
      const walletName = activeAdapter?.name ?? '?'
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
      const priorityIxs: TransactionInstruction[] = [
        // 400k: headroom for claim_achievement with up to 12 field proofs and
        // for txs that now carry SlotHashes/AdminState accounts (audit M-5).
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ...ixs,
      ]
      // Чек-лист пп. 50/51: ни одна инструкция не уходит в кошелёк, если она
      // не нашей программе и не системной (drainer-payload отсекается до подписи).
      assertInstructionsAllowed(priorityIxs, PROGRAM_ID)
      // Человекочитаемое превью того, что уйдёт на подпись (без секретов/ключей).
      console.info('[potato] signing:', describeInstructions(priorityIxs).join(' → '))
      const luts = (opts?.lookupTables ?? (lookupTable ? [lookupTable] : [])).filter(Boolean) as AddressLookupTableAccount[]

      // ── Основной путь: VersionedTransaction V0 с LUT (60% меньше байт, дешевле) ──
      // Чек-лист пп. 55/56: флаг «V0 уже ушёл в сеть». Повторная отправка тех же
      // инструкций (legacy-фолбэк) после отправленной V0 = двойное списание
      // (два harvest, два ордера, двойной craft), поэтому после sendTransaction
      // фолбэка нет никогда — только честная ошибка.
      let v0Sent = false
      try {
        const { blockhash, lastValidBlockHeight } = await withRetry(() => connection.getLatestBlockhash('confirmed'))
        const messageV0 = new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: blockhash,
          instructions: priorityIxs,
        }).compileToV0Message(luts)
        const vtx = new VersionedTransaction(messageV0)
        // Preflight simulate — FAIL CLOSED (чек-лист п. 51): если симуляция
        // упала, транзакция на сети тоже упадёт. Раньше отправлялись только
        // «узнаваемые» ошибки, остальные доходили до кошелька и сжигали комиссию.
        const sim = await connection.simulateTransaction(vtx as unknown as VersionedTransaction, { sigVerify: false })
        if (sim.value.err) {
          const logs = (sim.value.logs ?? []).join('\n')
          throw new Error(
            `${t('Транзакция не пройдёт на сети:')} ${JSON.stringify(sim.value.err)}\n${logs.slice(0, 600)}`,
          )
        }
        let signed: VersionedTransaction = await (wallet.signTransaction as (tx: VersionedTransaction) => Promise<VersionedTransaction>)(vtx)
        const needSig = signed.message.header.numRequiredSignatures
        let missingV = 0
        for (let i = 0; i < needSig; i++) if (!signed.signatures[i]?.some((b) => b !== 0)) missingV++
        if (missingV > 0 && activeAdapter) {
          await activeAdapter.disconnect()
          await activeAdapter.connect()
          const retryVtx = new VersionedTransaction(messageV0)
          signed = await (wallet.signTransaction as (tx: VersionedTransaction) => Promise<VersionedTransaction>)(retryVtx)
        }
        // Если после ретрая всё ещё нет подписи — считаем zombie и кидаем понятную ошибку
        {
          let stillMissing = 0
          for (let i = 0; i < needSig; i++) if (!signed.signatures[i]?.some((b) => b !== 0)) stillMissing++
          if (stillMissing > 0) {
            dumpDiag([`missing ${stillMissing}/${needSig} signatures (Versioned)`])
            throw new Error(`${MISSING_SIG} (${walletName})`)
          }
        }
        // Чек-лист пп. 50/51: сверяем подписанное с тем, что просили подписать.
        // Кошелёк, подменяющий инструкции (drainer), не дождётся отправки.
        assertSignedInstructionsMatch(signed, priorityIxs, PROGRAM_ID)
        v0Sent = true
        const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 })
        const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
        if (res.value.err) throw new Error(t('Транзакция отклонена сетью: {err}', { err: JSON.stringify(res.value.err) }))
        return sig
      } catch (e) {
        // Пп. 55/56: после отправленной транзакции фолбэка быть не может —
        // повтор тех же инструкций = двойное действие (двойной harvest/ордер).
        if (v0Sent) {
          throw new Error(
            t('Транзакция отправлена, но подтверждение не получено. Проверь кошелёк перед повтором — действие может уже выполниться.'),
          )
        }
        const msg = describeError(e)
        // Кастомные ошибки программы и любая упавшая симуляция — пробрасываем
        // без фолбэка: состояние игры не изменится от смены формата транзакции,
        // а повторная отправка тех же инструкций = двойное действие (пп. 55/56).
        if (/InstructionError|custom program error|AlreadyClaimed|BadProof|Paused|HarvestTooSoon|EpochCapExceeded|InsufficientFunds|BlockhashNotFound|block height exceeded/i.test(msg)) {
          throw new Error(msg)
        }
        if (/Signature verification failed|Missing signature/i.test(msg)) {
          dumpDiag([msg])
          throw new Error(`${MISSING_SIG} (${walletName})`)
        }
        // Если ошибка связана с Versioned/LUT — пробрасываем (не fallback)
        if (/lookup|Versioned|v0/i.test(msg) && msg.length < 600) throw new Error(msg)
        // Иначе: если это не кастомная ошибка — пробуем legacy fallback ниже
        // Но если msg уже содержит нашу кастомную ошибку — не fallback
        const isAppError = /custom program error|AlreadyClaimed|BadProof|Paused|HarvestTooSoon|EpochCapExceeded/i.test(msg)
        if (isAppError) throw new Error(msg)
        // continue to legacy fallback
      }

      // ── Legacy fallback: старые кошельки без V0 ──
      const missingSignersLegacy = (signed: Transaction): string[] => {
        const msg2 = signed.compileMessage()
        const missing: string[] = []
        for (let i = 0; i < msg2.header.numRequiredSignatures; i++) {
          const key = msg2.staticAccountKeys[i]
          const pair = signed.signatures[i]
          if (!pair || pair.signature === null || !pair.publicKey.equals(key)) missing.push(key.toBase58())
        }
        return missing
      }
      try {
        const tx = new Transaction().add(...priorityIxs)
        const { blockhash, lastValidBlockHeight } = await withRetry(() => connection.getLatestBlockhash('confirmed'))
        tx.recentBlockhash = blockhash
        tx.feePayer = wallet.publicKey
        let signed = (await wallet.signTransaction(tx as unknown as VersionedTransaction)) as unknown as Transaction
        let missing = missingSignersLegacy(signed)
        if (missing.length > 0 && activeAdapter) {
          await activeAdapter.disconnect()
          await activeAdapter.connect()
          signed = (await wallet.signTransaction(tx as unknown as VersionedTransaction)) as unknown as Transaction
          missing = missingSignersLegacy(signed)
        }
        if (missing.length > 0) {
          dumpDiag(missing)
          throw new Error(`${MISSING_SIG} (${walletName})`)
        }
        // Чек-лист пп. 50/51: та же сверка подписанного, что и в V0-пути.
        assertSignedLegacyInstructionsMatch(signed, priorityIxs, PROGRAM_ID)
        let raw: Buffer
        try {
          raw = signed.serialize()
        } catch {
          throw new Error(MISSING_SIG)
        }
        // Тот же fail-closed preflight, что и в V0-пути (чек-лист п. 51).
        const sim2 = await connection.simulateTransaction(signed)
        if (sim2.value.err) {
          const logs = (sim2.value.logs ?? []).join('\n')
          throw new Error(
            `${t('Транзакция не пройдёт на сети:')} ${JSON.stringify(sim2.value.err)}\n${logs.slice(0, 600)}`,
          )
        }
        const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 })
        const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
        if (res.value.err) throw new Error(t('Транзакция отклонена сетью: {err}', { err: JSON.stringify(res.value.err) }))
        return sig
      } catch (err) {
        const msg = describeError(err)
        if (/Signature verification failed|Missing signature/i.test(msg)) {
          dumpDiag([msg])
          throw new Error(`${MISSING_SIG} (${walletName})`)
        }
        throw new Error(msg)
      }
    },
    [wallet, connection, lookupTable],
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
      lookupTable,
      ensureLookupTable,
      refreshConfig,
    }),
    [connection, wallet.publicKey, wallet.connected, config, epoch, rpcError, sendIx, lookupTable, ensureLookupTable, refreshConfig],
  )

  return <SolanaContext.Provider value={value}>{children}</SolanaContext.Provider>
}

export function useSolana(): SolanaContextType {
  const ctx = useContext(SolanaContext)
  if (!ctx) throw new Error('useSolana must be used within SolanaProvider')
  return ctx
}
