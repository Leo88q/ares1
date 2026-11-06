// Колонийная трата POTATO (вариант B, см. docs/COLONY_POTATO_ECONOMY_PROPOSAL.md).
// Клиент: подписывает colony_spend через кошелёк, затем просит бэкенд записать квитанцию.
// Всё за флагом VITE_COLONY_POTATO_SPEND, по умолчанию выключено. Mainnet закрыт до отдельного GO.

/** Флаг включается только явно: 'true' в VITE_COLONY_POTATO_SPEND. Любое другое значение — выключено. */
export const COLONY_POTATO_SPEND_ENABLED: boolean =
 (import.meta.env?.VITE_COLONY_POTATO_SPEND ?? '') === 'true'

/**
 * ВРЕМЕННАЯ цена: 1 CR = 1 POTATO (в микро-единицах, 6 знаков). Это экономическое решение владельца;
 * до его подтверждения значение не должно включаться ни на каком стенде, кроме devnet.
 */
export const COLONY_POTATO_PER_CR_MICRO = 1_000_000

/** Совпадает с COLONY_PURPOSE_* в программе (lib.rs). */
export const COLONY_PURPOSE = { build: 1, repair: 2, upgrade: 3 } as const

/** Совпадает с COLONY_SPEND_MAX_MICRO в программе: 10 000 POTATO за одну трату. */
export const COLONY_SPEND_MAX_MICRO = 10_000_000_000

/** Функция оплаты, которую получает ColonyScreen: purpose и сумма в микро-POTATO. Возвращает подпись квитанции. */
export type PotatoSpend = (purpose: number, amountMicro: number) => Promise<{ signature: string }>

/** Сколько раз и как часто ждать финализации транзакции на бэкенде (409 NOT_FINALIZED). */
export const RECEIPT_ATTEMPTS = 30
export const RECEIPT_DELAY_MS = 2_000

export type ColonySpendFailureCode =
 | 'NO_WALLET' | 'INSUFFICIENT' | 'INVALID_AMOUNT' | 'RECEIPT_TIMEOUT' | 'REJECTED' | 'NETWORK'

export class ColonySpendFailure extends Error {
 readonly code: ColonySpendFailureCode
 readonly reason?: string
 constructor(code: ColonySpendFailureCode, reason?: string) {
  super(reason ?? code)
  this.name = 'ColonySpendFailure'
  this.code = code
  this.reason = reason
 }
}

export interface ColonySpendReceipt {
 signature: string
 owner: string
 amountMicro: string
 purpose: number
 slot: number
}

/** Переводит цену колонийного действия из CR в микро-POTATO. */
export function colonySpendMicro(cr: number): number {
 return Math.round(cr) * COLONY_POTATO_PER_CR_MICRO
}

/** Проверяет сумму до отправки, чтобы не тратить комиссию на заведомо отклонённую транзакцию. */
export function assertSpendAmount(amountMicro: number): void {
 if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0 || amountMicro > COLONY_SPEND_MAX_MICRO) {
  throw new ColonySpendFailure('INVALID_AMOUNT')
 }
}

interface RecordDeps {
 backendBase: string
 fetchImpl: typeof fetch
 sleep: (ms: number) => Promise<void>
 attempts?: number
 delayMs?: number
}

/**
 * Просит бэкенд записать квитанцию по подписи. 409 NOT_FINALIZED ждём и повторяем:
 * бэкенд принимает только финализированные транзакции, а подтверждение приходит не сразу.
 * 200 (reused) и 201 — успех: повтор той же подписи безопасен и не списывает дважды.
 */
export async function recordColonySpend(
 input: { signature: string; wallet: string },
 deps: RecordDeps,
): Promise<ColonySpendReceipt> {
 const attempts = deps.attempts ?? RECEIPT_ATTEMPTS
 const delayMs = deps.delayMs ?? RECEIPT_DELAY_MS
 const url = `${deps.backendBase}/api/colony-spend`
 for (let i = 0; i < attempts; i++) {
  let res: Response
  try {
   res = await deps.fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
   })
  } catch {
   if (i + 1 >= attempts) throw new ColonySpendFailure('NETWORK')
   await deps.sleep(delayMs)
   continue
  }
  const body = (await res.json().catch(() => null)) as
   | { ok?: boolean; code?: string; message?: string; receipt?: ColonySpendReceipt }
   | null
  if ((res.status === 200 || res.status === 201) && body?.ok && body.receipt) return body.receipt
  if (res.status === 409 && body?.code === 'NOT_FINALIZED') {
   if (i + 1 >= attempts) throw new ColonySpendFailure('RECEIPT_TIMEOUT')
   await deps.sleep(delayMs)
   continue
  }
  if (res.status >= 500 && i + 1 < attempts) {
   await deps.sleep(delayMs)
   continue
  }
  throw new ColonySpendFailure('REJECTED', body?.code ?? `HTTP_${res.status}`)
 }
 throw new ColonySpendFailure('RECEIPT_TIMEOUT')
}

/** Текст ошибки для игрока. Коды — из ColonySpendError бэкенда и из ColonySpendFailure. */
export function colonySpendMessage(code: string | undefined, language: string): string {
 const ru: Record<string, string> = {
  NO_WALLET: 'Подключите кошелёк, чтобы оплатить POTATO.',
  INSUFFICIENT: 'Недостаточно POTATO для этого действия.',
  INVALID_AMOUNT: 'Сумма списания вне допустимого диапазона.',
  RECEIPT_TIMEOUT: 'Транзакция отправлена в сеть, но сервер не записал квитанцию. POTATO мог быть сожжён, а колония не изменена. Не платите повторно: обратитесь в поддержку с адресом кошелька.',
  NETWORK: 'Нет связи с сервером квитанций. Повторите попытку.',
  REJECTED: 'Сервер не принял квитанцию трат. Колония не изменена.',
  NOT_FINALIZED: 'Транзакция ещё не подтверждена сетью.',
  SIGNATURE_OWNED: 'Эта транзакция уже записана за другим кошельком.',
  INVALID_SIGNATURE: 'Некорректная подпись транзакции.',
  INVALID_WALLET: 'Некорректный адрес кошелька.',
  TX_FAILED: 'Транзакция завершилась с ошибкой. POTATO не списан.',
  NOT_COLONY_SPEND: 'Транзакция не является колонийной тратой.',
  MINT_MISMATCH: 'Транзакция использует другой токен.',
  OWNER_MISMATCH: 'Транзакция списана не с вашего кошелька.',
  OWNER_NOT_SIGNER: 'Транзакция не подписана вашим кошельком.',
  BURN_MISMATCH: 'Сумма в транзакции не совпадает с ценой.',
 }
 const en: Record<string, string> = {
  NO_WALLET: 'Connect a wallet to pay in POTATO.',
  INSUFFICIENT: 'Not enough POTATO for this action.',
  INVALID_AMOUNT: 'Spend amount is out of range.',
  RECEIPT_TIMEOUT: 'The transaction was sent, but the receipt was not recorded. POTATO may have been burned while the colony did not change. Do not pay again: contact support with your wallet address.',
  NETWORK: 'Cannot reach the receipt server. Try again.',
  REJECTED: 'The receipt server rejected the spend. The colony was not changed.',
  NOT_FINALIZED: 'The transaction is not confirmed by the network yet.',
  SIGNATURE_OWNED: 'This transaction is already recorded for another wallet.',
  INVALID_SIGNATURE: 'Invalid transaction signature.',
  INVALID_WALLET: 'Invalid wallet address.',
  TX_FAILED: 'The transaction failed on-chain. No POTATO was spent.',
  NOT_COLONY_SPEND: 'The transaction is not a colony spend.',
  MINT_MISMATCH: 'The transaction uses a different token.',
  OWNER_MISMATCH: 'The transaction was not paid from your wallet.',
  OWNER_NOT_SIGNER: 'The transaction is not signed by your wallet.',
  BURN_MISMATCH: 'The amount in the transaction does not match the price.',
 }
 const table = language === 'ru' ? ru : en
 return table[code ?? ''] ?? (language === 'ru' ? 'Не удалось оплатить POTATO.' : 'Could not pay in POTATO.')
}
