// Проверка колонийной траты POTATO (вариант B из docs/COLONY_POTATO_ECONOMY_PROPOSAL.md).
//
// Бэкенд не доверяет клиенту: он принимает только подпись транзакции и сам
// проверяет её в сети. Засчитывается трата, только если в финализированной
// транзакции есть ровно одна инструкция `colony_spend` этой программы, она
// подписана кошельком, сжигает именно заявленную сумму POTATO с ATA кошелька
// и не провалилась. Функции здесь чистые: сеть сюда не ходит, поэтому всё
// тестируется фикстурами.

import { createHash } from "node:crypto";

/** Дискриминатор инструкции Anchor: первые 8 байт sha256("global:colony_spend"). */
export const COLONY_SPEND_DISCRIMINATOR = createHash("sha256").update("global:colony_spend").digest().subarray(0, 8);
/** Аргументы: u64 amount_micro + u8 purpose; плюс 8 байт дискриминатора. */
export const COLONY_SPEND_DATA_BYTES = 8 + 8 + 1;
/** Порядок аккаунтов совпадает с ColonySpend в lib.rs и с IDL. */
export const COLONY_SPEND_ACCOUNT_COUNT = 5;
export const COLONY_SPEND_ACCOUNT = { potatoMint: 0, userPotato: 1, config: 2, owner: 3, tokenProgram: 4 } as const;
/** Должно совпадать с COLONY_SPEND_MAX_MICRO в lib.rs (10 000 POTATO за вызов). */
export const COLONY_SPEND_MAX_MICRO = 10_000_000_000n;
/** Должно совпадать с COLONY_PURPOSE_* в lib.rs. */
export const COLONY_PURPOSES: readonly number[] = [1, 2, 3];

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type ColonySpendFailureCode =
  | "INVALID_SIGNATURE"
  | "INVALID_WALLET"
  | "NOT_FINALIZED"
  | "TX_FAILED"
  | "NOT_COLONY_SPEND"
  | "AMBIGUOUS_INSTRUCTION"
  | "MALFORMED_ACCOUNTS"
  | "MINT_MISMATCH"
  | "OWNER_MISMATCH"
  | "OWNER_NOT_SIGNER"
  | "BURN_MISMATCH"
  | "INVALID_ARGUMENTS"
  | "SIGNATURE_OWNED";

export class ColonySpendError extends Error {
  constructor(readonly code: ColonySpendFailureCode, message: string) {
    super(message);
    this.name = "ColonySpendError";
  }
}

/** Минимальная форма финализированной транзакции, которую нужна проверке. */
export interface ParsedAccountKey {
  pubkey: string;
  signer: boolean;
}
export interface RawInstruction {
  programId: string;
  accounts: string[];
  data: string;
}
export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}
export interface ParsedTransactionLike {
  slot: number;
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
  } | null;
  transaction: {
    message: {
      accountKeys: ParsedAccountKey[];
      instructions: Array<RawInstruction | { programId: string; parsed?: unknown; program?: string }>;
    };
  };
}

export interface ColonySpendReceipt {
  signature: string;
  owner: string;
  amountMicro: bigint;
  purpose: number;
  slot: number;
}

export function base58Decode(input: string): Uint8Array {
  let value = 0n;
  for (const ch of input) {
    const digit = BASE58_ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error("invalid base58 character");
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value & 0xffn));
    value >>= 8n;
  }
  bytes.reverse();
  let leadingZeros = 0;
  for (const ch of input) {
    if (ch !== "1") break;
    leadingZeros += 1;
  }
  return Uint8Array.from([...new Array<number>(leadingZeros).fill(0), ...bytes]);
}

/** Аргументы колонийной траты из данных инструкции; null — это не colony_spend. */
export function decodeColonySpendData(data: Uint8Array): { amountMicro: bigint; purpose: number } | null {
  if (data.length !== COLONY_SPEND_DATA_BYTES) return null;
  for (let i = 0; i < COLONY_SPEND_DISCRIMINATOR.length; i += 1) {
    if (data[i] !== COLONY_SPEND_DISCRIMINATOR[i]) return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { amountMicro: view.getBigUint64(8, true), purpose: data[16] };
}

function isValidSignatureShape(signature: string): boolean {
  if (signature.length < 80 || signature.length > 90) return false;
  try {
    return base58Decode(signature).length === 64;
  } catch {
    return false;
  }
}

function isValidWalletShape(wallet: string): boolean {
  if (wallet.length < 32 || wallet.length > 44) return false;
  try {
    return base58Decode(wallet).length === 32;
  } catch {
    return false;
  }
}

export function assertSignatureShape(signature: string): void {
  if (!isValidSignatureShape(signature)) throw new ColonySpendError("INVALID_SIGNATURE", "Некорректная подпись транзакции");
}

export function assertWalletShape(wallet: string): void {
  if (!isValidWalletShape(wallet)) throw new ColonySpendError("INVALID_WALLET", "Некорректный адрес кошелька");
}

/** Баланс аккаунта токена по индексу в accountKeys: сумма `amount` в сырых единицах. */
function balanceFor(balances: TokenBalance[] | null | undefined, index: number, mint: string, owner: string): bigint {
  const entry = (balances ?? []).find(b => b.accountIndex === index && b.mint === mint && b.owner === owner);
  return entry ? BigInt(entry.uiTokenAmount.amount) : 0n;
}

/**
 * Проверяет, что транзакция — это ровно одна честная колонийная трата.
 * Выбрасывает ColonySpendError с понятным кодом; возвращает квитанцию при успехе.
 */
export function verifyColonySpendTransaction(
  tx: ParsedTransactionLike | null,
  signature: string,
  expect: { programId: string; potatoMint: string; wallet: string },
): ColonySpendReceipt {
  if (!tx || !tx.meta) throw new ColonySpendError("NOT_FINALIZED", "Транзакция ещё не финализирована или не найдена");
  if (tx.meta.err !== null && tx.meta.err !== undefined) {
    throw new ColonySpendError("TX_FAILED", "Транзакция завершилась ошибкой и ничего не сожгла");
  }

  const candidates: RawInstruction[] = [];
  for (const ix of tx.transaction.message.instructions) {
    if (ix.programId !== expect.programId || !("data" in ix)) continue;
    const decoded = decodeColonySpendData(base58Decode(ix.data));
    if (decoded) candidates.push(ix);
  }
  if (candidates.length === 0) throw new ColonySpendError("NOT_COLONY_SPEND", "В транзакции нет инструкции colony_spend этой программы");
  if (candidates.length > 1) throw new ColonySpendError("AMBIGUOUS_INSTRUCTION", "В транзакции несколько трат колонии; засчитывается только одна");

  const ix = candidates[0];
  if (ix.accounts.length !== COLONY_SPEND_ACCOUNT_COUNT) {
    throw new ColonySpendError("MALFORMED_ACCOUNTS", "Неверное число аккаунтов инструкции colony_spend");
  }
  const args = decodeColonySpendData(base58Decode(ix.data));
  if (!args) throw new ColonySpendError("NOT_COLONY_SPEND", "Данные инструкции не соответствуют colony_spend");
  if (args.amountMicro <= 0n || args.amountMicro > COLONY_SPEND_MAX_MICRO || !COLONY_PURPOSES.includes(args.purpose)) {
    throw new ColonySpendError("INVALID_ARGUMENTS", "Сумма или категория траты вне допустимых пределов");
  }

  const keys = tx.transaction.message.accountKeys;
  const mintAccount = ix.accounts[COLONY_SPEND_ACCOUNT.potatoMint];
  const ownerAccount = ix.accounts[COLONY_SPEND_ACCOUNT.owner];
  const userAccount = ix.accounts[COLONY_SPEND_ACCOUNT.userPotato];

  if (mintAccount !== expect.potatoMint) throw new ColonySpendError("MINT_MISMATCH", "Трата указывает не на токен POTATO этой игры");
  if (ownerAccount !== expect.wallet) throw new ColonySpendError("OWNER_MISMATCH", "Трата подписана не этим кошельком");
  const ownerKey = keys.find(k => k.pubkey === ownerAccount);
  if (!ownerKey || !ownerKey.signer) throw new ColonySpendError("OWNER_NOT_SIGNER", "Владелец не подписал транзакцию");

  // Сжигание проверяем по балансам токена: ATA владельца должна потерять ровно заявленную сумму.
  const userIndex = keys.findIndex(k => k.pubkey === userAccount);
  if (userIndex < 0) throw new ColonySpendError("MALFORMED_ACCOUNTS", "Токен-аккаунт траты не найден среди аккаунтов транзакции");
  const before = balanceFor(tx.meta.preTokenBalances, userIndex, expect.potatoMint, expect.wallet);
  const after = balanceFor(tx.meta.postTokenBalances, userIndex, expect.potatoMint, expect.wallet);
  if (before - after !== args.amountMicro) {
    throw new ColonySpendError("BURN_MISMATCH", "Сожжённая сумма не совпадает с заявленной");
  }

  return { signature, owner: expect.wallet, amountMicro: args.amountMicro, purpose: args.purpose, slot: tx.slot };
}
