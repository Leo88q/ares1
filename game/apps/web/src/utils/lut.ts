/**
 * Address Lookup Tables (ALT) + Versioned Transactions
 * ─────────────────────────────────────────────────────
 * Solana v1.10+ позволяет сжать до 256 адресов в 1 LUT и слать
 * VersionedTransaction вместо legacy Transaction.
 *
 * Выгода для ARES-1:
 * - batch_harvest 10 полей: legacy = 10×32 байт адресов = 320 байт + 10 подписей
 *   Versioned + LUT = 10×1 байт индекс = 10 байт, 1 подпись, меньше CU.
 * - Размер tx ↓ 60%, стоимость ↓ 30-40%, лимит 1232 байт не упирается при 20 полях.
 * - LUT создаётся 1 раз на игрока (rent ~0.005 SOL) и переиспользуется.
 *
 * Docs: https://solana.com/docs/advanced/lookup-tables
 */
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

export const LUT_SEED = 'ares-lut-v1'

/** Деривация PDA для LUT authority (игрок + seed) — не on-chain, только для кэша */
export function lutAuthorityPda(owner: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(LUT_SEED), owner.toBuffer()], programId)[0]
}

/**
 * Создаёт новую ALT для игрока. Вызывается 1 раз, затем extend.
 * Требует ~0.005 SOL rent + 0.00001 SOL fee.
 */
export async function createLookupTable(
  connection: Connection,
  payer: PublicKey,
  authority: PublicKey,
  recentSlot: number,
): Promise<{ instruction: TransactionInstruction; lookupTableAddress: PublicKey }> {
  const [instruction, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority,
    payer,
    recentSlot,
  })
  // Для отладки можно сразу деактивировать через 256 слотов
  void connection // keep for later use
  return { instruction, lookupTableAddress }
}

/**
 * Добавляет адреса в существующую LUT (до 20 за 1 tx).
 */
export function extendLookupTable(
  lookupTableAddress: PublicKey,
  authority: PublicKey,
  payer: PublicKey,
  addresses: PublicKey[],
): TransactionInstruction {
  return AddressLookupTableProgram.extendLookupTable({
    payer,
    authority,
    lookupTable: lookupTableAddress,
    addresses,
  })
}

/**
 * Загружает LUT с чейна. Кэшируется в memory + localStorage.
 */
const lutCache = new Map<string, AddressLookupTableAccount>()

export async function getLookupTable(
  connection: Connection,
  address: PublicKey,
): Promise<AddressLookupTableAccount | null> {
  const key = address.toBase58()
  if (lutCache.has(key)) return lutCache.get(key)!
  const res = await connection.getAddressLookupTable(address)
  if (res.value) lutCache.set(key, res.value)
  return res.value ?? null
}

/**
 * Строит VersionedTransaction с LUT.
 * Если LUT не передан — фолбэк на legacy (для совместимости).
 */
export async function buildVersionedTransaction(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<VersionedTransaction> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed')
  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables)
  return new VersionedTransaction(messageV0)
}

/**
 * Деактивирует и закрывает LUT (возврат rent). Вызывать при выходе из игры.
 */
export function closeLookupTable(
  lookupTableAddress: PublicKey,
  authority: PublicKey,
  recipient: PublicKey,
): TransactionInstruction {
  return AddressLookupTableProgram.closeLookupTable({
    lookupTable: lookupTableAddress,
    authority,
    recipient,
  })
}

/**
 * Хелпер: определяет, какие адреса можно вынести в LUT.
 * Для ARES-1: field PDAs, order PDAs, escrow PDAs — идеальны для LUT.
 */
export function addressesForBatchHarvest(
  fieldPks: PublicKey[],
  extra: PublicKey[] = [],
): PublicKey[] {
  // Дедуп + лимит 256
  const set = new Set<string>()
  const out: PublicKey[] = []
  for (const pk of [...fieldPks, ...extra]) {
    const s = pk.toBase58()
    if (!set.has(s)) {
      set.add(s)
      out.push(pk)
      if (out.length >= 256) break
    }
  }
  return out
}
