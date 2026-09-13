import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, createAssociatedTokenAccountInstruction, createTransferInstruction, unpackAccount, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { useSolana, BACKEND_URL, IS_MAINNET } from './SolanaContext'
import { useToast } from '../components/Toast'
import {
 decodeField, pdas,
 ixCreateField, ixHarvest, ixRepairField, ixUpgradeField, ixPayTax, ixApplyFertilizer,
 ixBuyFieldSkr, TEST_SKR_MINT, treasurySkrAta, buybackSkrAta, presaleStatePda, buyerPresalePda, treasurySolPda,
} from '../utils/anchorClient'
import {
 accumulatedMicro, fieldPriceMicro, fertilizerCostMicro, repairCostMicro, taxCostMicro, upgradeCostMicro, fmtPotato, MICRO,
} from '../utils/constants'
import { describeError } from '../utils/errors'
import { randomU64, withRetry } from '../utils/rpc'
import { getTelegramInitData } from '../utils/telegram'
import { usePolling } from '../hooks/usePolling'

const FIELD_ACCOUNT_SIZE = 8 + 32 + 1 + 1 + 8 + 8 + 8 + 1 + 1 + 1
const FIELDS_POLL_MS = 20_000

export interface Field {
 publicKey: PublicKey
 owner: PublicKey
 level: number
 durability: number
 lastHarvest: number
 taxPaidUntil: number
 fertilizerUntil: number
 isActive: boolean
 fieldType: number
 mutationType: number
 /** Accrued yield in micro POTATO, recomputed locally every second. */
 accumulated: number
}

export interface GameStats {
 totalFields: number
 /** Sum of accrued yield across fields, micro POTATO. */
 pendingHarvest: number
 playerLevel: number
 experience: number
 /** Wallet balance in micro POTATO. */
 potatoBalance: number
}

export interface GameContextType {
 fields: Field[]
 stats: GameStats
 solBalance: number
 loading: boolean
 purchasing: boolean
 /** Quest ids already claimed by this Telegram user (from the backend). */
 claimed: Record<string, boolean>
 harvest: (field: PublicKey) => Promise<boolean>
 purchaseField: (fieldType: number) => Promise<boolean>
 buyFieldPresale: (fieldType: number) => Promise<boolean>
 upgradeField: (field: PublicKey) => Promise<boolean>
 repairField: (field: PublicKey) => Promise<boolean>
 payTax: (field: PublicKey) => Promise<boolean>
 applyFertilizer: (field: PublicKey) => Promise<boolean>
 claimReward: (questId: string, rewardMicro?: number) => Promise<boolean>
 airdropSol: () => Promise<boolean>
 sendPotato: (to: string, amount: number) => Promise<boolean>
 sendSol: (to: string, amount: number) => Promise<boolean>
 reload: () => Promise<void>
}

const GameContext = createContext<GameContextType | undefined>(undefined)

type RawField = Omit<Field, 'accumulated'>

export function GameProvider({ children }: { children: ReactNode }) {
 const { connection, programId, publicKey, connected, ready, config, refreshConfig, sendIx } = useSolana()
 const { show } = useToast()

 const [rawFields, setRawFields] = useState<RawField[]>([])
 const [potatoBalance, setPotatoBalance] = useState(0)
 const devBalanceOffset = useRef(0)
 const [ataExists, setAtaExists] = useState(false)
 const [solBalance, setSolBalance] = useState(0)
 const [loading, setLoading] = useState(true)
 const [purchasing, setPurchasing] = useState(false)
 const [claimed, setClaimed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('dev_claimed') || '{}') } catch { return {} } })
 const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

 // Local 1s ticker so "accumulated" grows smoothly between RPC polls.
 useEffect(() => {
  const t = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000)
  return () => window.clearInterval(t)
 }, [])

 const notify = useCallback(
  (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => show({ type, title, message }),
  [show],
 )

 const loadFields = useCallback(async () => {
  if (!ready || !connected || !publicKey || !config) {
   setLoading(false)
   return
  }
  try {
   const ata = getAssociatedTokenAddressSync(config.potatoMint, publicKey, false)
   const [accounts, infos] = await Promise.all([
    withRetry(() =>
     connection.getProgramAccounts(programId, {
      filters: [{ dataSize: FIELD_ACCOUNT_SIZE }, { memcmp: { offset: 8, bytes: publicKey.toBase58() } }],
     }),
    ),
    withRetry(() => connection.getMultipleAccountsInfo([publicKey, ata])),
   ])
   const [walletInfo, ataInfo] = infos
   setSolBalance((walletInfo?.lamports ?? 0) / 1e9)
   if (ataInfo) {
    setAtaExists(true)
    setPotatoBalance(Number(unpackAccount(ata, ataInfo).amount) + devBalanceOffset.current)
   } else {
    setAtaExists(false)
    setPotatoBalance(0 + devBalanceOffset.current)
   }
   setRawFields(
    accounts
     .map(({ pubkey, account }) => {
      const d = decodeField(account.data)
      return {
       publicKey: pubkey,
       owner: d.owner,
       level: d.level,
       durability: d.durability,
       lastHarvest: Number(d.lastHarvest),
       taxPaidUntil: Number(d.taxPaidUntil),
       fertilizerUntil: Number(d.fertilizerUntil),
       isActive: d.isActive,
       fieldType: d.fieldType,
       mutationType: d.mutationType ?? 0,
      }
     })
     .sort((a, b) => a.lastHarvest - b.lastHarvest),
   )
  } finally {
   setLoading(false)
  }
 }, [ready, connected, publicKey, config, connection, programId])

 usePolling(loadFields, FIELDS_POLL_MS, ready && connected && !!publicKey)

 const fields = useMemo<Field[]>(() => {
  if (!config) return []
  const cfg = { baseYieldMicroPerDay: Number(config.baseYieldMicroPerDay), globalMultiplierBps: config.globalMultiplierBps }
  const currentEpoch = Math.floor(nowSec / (24 * 3600)) // примерный epoch_id
  return rawFields.map((f) => ({
   ...f,
   accumulated: accumulatedMicro({ ...f, epochId: currentEpoch }, cfg, nowSec),
  }))
 }, [rawFields, config, nowSec])

 const stats = useMemo<GameStats>(
  () => ({
   totalFields: fields.length,
   pendingHarvest: fields.reduce((s, f) => s + f.accumulated, 0),
   playerLevel: Math.floor(fields.length / 3) + 1,
   experience: fields.length * 100 + potatoBalance / MICRO,
   potatoBalance,
  }),
  [fields, potatoBalance],
 )

 const refreshAll = useCallback(async () => {
  await Promise.all([loadFields(), refreshConfig()])
 }, [loadFields, refreshConfig])

 /** ATA of the connected wallet plus a create-instruction when it does not exist yet. */
 const ownAta = useCallback((): { address: PublicKey; ixs: TransactionInstruction[] } => {
  if (!publicKey || !config) throw new Error('Кошелёк не подключён.')
  const address = getAssociatedTokenAddressSync(config.potatoMint, publicKey, false)
  const ixs = ataExists ? [] : [createAssociatedTokenAccountInstruction(publicKey, address, publicKey, config.potatoMint)]
  return { address, ixs }
 }, [publicKey, config, ataExists])

 const requireBalance = useCallback(
  (costMicro: number): boolean => {
   if (potatoBalance >= costMicro) return true
   notify('warning', 'Недостаточно $POTATO', `Нужно ${fmtPotato(costMicro, 0)} POTATO, а у тебя ${fmtPotato(potatoBalance)} POTATO.`)
   return false
  },
  [potatoBalance, notify],
 )

 const runTx = useCallback(
  async (label: string, build: () => Promise<TransactionInstruction[]>): Promise<boolean> => {
   try {
    const ixs = await build()
    await sendIx(ixs)
    await refreshAll()
    return true
   } catch (err) {
    notify('error', label, describeError(err))
    return false
   }
  },
  [sendIx, refreshAll, notify],
 )

 const purchaseField = useCallback(
  async (fieldType: number) => {
   if (!config || !publicKey || !ready) {
    notify('warning', 'Игра ещё загружается', 'Подожди пару секунд.')
    return false
   }
   if (!requireBalance(fieldPriceMicro(fieldType))) return false
   setPurchasing(true)
   try {
    return await runTx('Не удалось купить поле', async () => {
     const { address: userPotato, ixs } = ownAta()
     const fieldId = randomU64()
     const { config: configPda, field } = pdas(programId)
     const ix = await ixCreateField(programId, {
      config: configPda(), field: field(fieldId), owner: publicKey,
      potatoMint: config.potatoMint, userPotato, fieldId, fieldType,
     })
     return [...ixs, ix]
    })
   } finally {
    setPurchasing(false)
   }
  },
  [config, publicKey, ready, requireBalance, runTx, ownAta, programId, notify],
 )


 const buyFieldPresale = useCallback(
  async (fieldType: number) => {
   if (!config || !publicKey || !ready) {
    notify('warning', 'Игра ещё загружается', 'Подожди пару секунд.')
    return false
   }
   // 1053 SKR за растение + ~0.01 SKR rent на Field + BuyerPresaleCounter (guard только по SOL-gas)
   const requiredSol = 0.02
   if (solBalance < requiredSol) {
    notify('warning', 'Недостаточно SKR', `Нужно минимум ${requiredSol} SKR (цена 0.25 + rent)`)
    return false
   }
   setPurchasing(true)
   try {
    return await runTx('Не удалось купить растение за SKR', async () => {
     const fieldId = randomU64()
     const { config: configPda, field } = pdas(programId)
     const buyerSkrAta = getAssociatedTokenAddressSync(TEST_SKR_MINT, publicKey)
     const ataIx = createAssociatedTokenAccountIdempotentInstruction(publicKey, buyerSkrAta, publicKey, TEST_SKR_MINT)
     const ix = await ixBuyFieldSkr(programId, {
      config: configPda(),
      presaleState: presaleStatePda(programId),
      authority: config.authority,
      buyerPresale: buyerPresalePda(programId, publicKey),
      field: field(fieldId),
      buyer: publicKey,
      treasurySol: treasurySolPda(programId),
      skrMint: TEST_SKR_MINT,
      buyerSkrAta,
      treasurySkrAta: treasurySkrAta(programId, TEST_SKR_MINT),
      buybackSkrAta: buybackSkrAta(config.authority, TEST_SKR_MINT),
      fieldId,
      fieldType,
     })
     return [ataIx, ix]
    })
   } finally {
    setPurchasing(false)
   }
  },
  [config, publicKey, ready, solBalance, runTx, programId, notify],
 )

 const harvest = useCallback(
  async (fieldPk: PublicKey) => {
   if (!config || !publicKey) return false
   return runTx('Не удалось собрать урожай', async () => {
    const { address: userPotato, ixs } = ownAta()
    const { config: configPda, epoch } = pdas(programId)
    const ix = await ixHarvest(programId, {
     config: configPda(), epoch: epoch(config.epochId), field: fieldPk,
     potatoMint: config.potatoMint, userPotato, owner: publicKey,
    })
    return [...ixs, ix]
   })
  },
  [config, publicKey, runTx, ownAta, programId],
 )

 const fieldSpend = useCallback(
  (build: typeof ixRepairField, cost: (f: Field) => number, label: string) =>
   async (fieldPk: PublicKey): Promise<boolean> => {
    if (!config || !publicKey) return false
    const f = fields.find((x) => x.publicKey.equals(fieldPk))
    if (!f) return false
    if (!requireBalance(cost(f))) return false
    return runTx(label, async () => {
     const { address: userPotato, ixs } = ownAta()
     const { config: configPda } = pdas(programId)
     const ix = await build(programId, {
      field: fieldPk, potatoMint: config.potatoMint, userPotato, config: configPda(), owner: publicKey,
     })
     return [...ixs, ix]
    })
   },
  [config, publicKey, fields, requireBalance, runTx, ownAta, programId],
 )

 const upgradeField = useMemo(
  () => fieldSpend(ixUpgradeField, (f) => upgradeCostMicro(f.level, f.fieldType), 'Не удалось улучшить поле'),
  [fieldSpend],
 )
 const repairField = useMemo(
  () => fieldSpend(ixRepairField, (f) => repairCostMicro(f.fieldType), 'Не удалось отремонтировать поле'),
  [fieldSpend],
 )
 const payTax = useMemo(
  () => fieldSpend(ixPayTax, (f) => taxCostMicro(f.fieldType), 'Не удалось оплатить налог'),
  [fieldSpend],
 )
 const applyFertilizer = useMemo(
  () => fieldSpend(ixApplyFertilizer, (f) => fertilizerCostMicro(f.fieldType), 'Не удалось удобрить поле'),
  [fieldSpend],
 )

 // ── Backend quests ──
 const backendHeaders = useCallback((): HeadersInit | null => {
  const initData = getTelegramInitData()
  if (!initData || !BACKEND_URL) return null
  return { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData }
 }, [])

 const loadClaimed = useCallback(async () => {
  const headers = backendHeaders()
  if (!headers) return
  try {
   const res = await fetch(`${BACKEND_URL}/api/reward/status`, { headers })
   if (res.ok) {
    const json = (await res.json()) as { claimed: string[] }
    setClaimed(Object.fromEntries(json.claimed.map((id) => [id, true])))
   }
  } catch {
   /* backend offline — quests simply stay unclaimed in the UI */
  }
 }, [backendHeaders])

 useEffect(() => {
  void loadClaimed()
 }, [loadClaimed, publicKey])

 const claimReward = useCallback(
  async (questId: string, rewardMicro?: number): Promise<boolean> => {
   if (!publicKey) return false
   const headers = backendHeaders()
   if (!headers) {
    if (import.meta.env.DEV) {
     const key = 'dev_claimed'
     const store: Record<string, boolean> = JSON.parse(localStorage.getItem(key) || '{}')
     if (store[questId]) {
      notify('warning', 'Уже собрано', 'Эта награда уже получена в dev-режиме.')
      return false
     }
     store[questId] = true
     localStorage.setItem(key, JSON.stringify(store))
     setClaimed((c) => ({ ...c, [questId]: true }))
     const amount = rewardMicro ?? 0
     if (amount > 0) {
      devBalanceOffset.current += amount
      setPotatoBalance((prev) => prev + amount)
     }
     notify('success', 'Награда получена (dev)', amount > 0 ? `+${fmtPotato(amount, 0)} POTATO начислено` : 'Состояние UI обновлено.')
     return true
    }
    notify('error', 'Задачи смены доступны только в Telegram', 'Открой мини-приложение через бота, чтобы получать награды.')
    return false
   }
   try {
    const res = await fetch(`${BACKEND_URL}/api/reward/claim`, {
     method: 'POST', headers,
     body: JSON.stringify({ questId, walletAddress: publicKey.toBase58() }),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string; amountMicro?: string }
    if (!res.ok) {
     notify('error', 'Награда не выдана', json.error ?? res.statusText)
     return false
    }
    setClaimed((c) => ({ ...c, [questId]: true }))
    notify('success', 'Награда получена', `+${fmtPotato(Number(json.amountMicro ?? 0), 0)} POTATO`)
    await loadFields()
    return true
   } catch (err) {
    notify('error', 'Награда не выдана', describeError(err))
    return false
   }
  },
  [publicKey, backendHeaders, notify, loadFields],
 )

 // ── Wallet helpers ──
 const airdropSol = useCallback(async (): Promise<boolean> => {
  if (!publicKey || IS_MAINNET) return false
  try {
   const sig = await connection.requestAirdrop(publicKey, 1e9)
   const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
   await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight })
   await loadFields()
   return true
  } catch (err) {
   notify('error', 'Airdrop недоступен', describeError(err))
   return false
  }
 }, [publicKey, connection, loadFields, notify])

 const sendPotato = useCallback(
  async (to: string, amount: number): Promise<boolean> => {
   if (!publicKey || !config) return false
   const amountMicro = Math.floor(amount * MICRO)
   if (amountMicro <= 0) return false
   if (!requireBalance(amountMicro)) return false
   let toPub: PublicKey
   try {
    toPub = new PublicKey(to)
   } catch {
    notify('error', 'Неверный адрес получателя')
    return false
   }
   return runTx('Не удалось отправить $POTATO', async () => {
    const { address: fromAta, ixs } = ownAta()
    const toAta = getAssociatedTokenAddressSync(config.potatoMint, toPub, true)
    const toInfo = await withRetry(() => connection.getAccountInfo(toAta))
    const createTo = toInfo ? [] : [createAssociatedTokenAccountInstruction(publicKey, toAta, toPub, config.potatoMint)]
    return [...ixs, ...createTo, createTransferInstruction(fromAta, toAta, publicKey, amountMicro)]
   })
  },
  [publicKey, config, requireBalance, runTx, ownAta, connection, notify],
 )

 const sendSol = useCallback(
  async (to: string, amount: number): Promise<boolean> => {
   if (!publicKey) return false
   let toPub: PublicKey
   try {
    toPub = new PublicKey(to)
   } catch {
    notify('error', 'Неверный адрес получателя')
    return false
   }
   const lamports = Math.floor(amount * 1e9)
   if (lamports <= 0) return false
   return runTx('Не удалось отправить SKR', async () => [
    SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: toPub, lamports }),
   ])
  },
  [publicKey, runTx, notify],
 )

 const value = useMemo<GameContextType>(
  () => ({
   fields, stats, solBalance, loading, purchasing, claimed,
   harvest, purchaseField, buyFieldPresale, upgradeField, repairField, payTax, applyFertilizer,
   claimReward, airdropSol, sendPotato, sendSol, reload: loadFields,
  }),
  [fields, stats, solBalance, loading, purchasing, claimed, harvest, purchaseField, upgradeField, repairField,
   payTax, applyFertilizer, claimReward, airdropSol, sendPotato, sendSol, loadFields],
 )

 return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame(): GameContextType {
 const ctx = useContext(GameContext)
 if (!ctx) throw new Error('useGame must be used within GameProvider')
 return ctx
}
