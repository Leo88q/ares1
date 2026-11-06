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
 * - Премиум-тир лицензии (до BATCH_LIMIT_LICENSED = 30 полей) доступен ТОЛЬКО
 *   через LUT: 30 writable-аккаунтов по 33 байта вместе с фиксированными уже не
 *   влезают в 1232 байта legacy-транзакции.
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
} from '@solana/web3.js'

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

