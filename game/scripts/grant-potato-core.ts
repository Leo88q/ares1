import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { anchorDiscriminator, i64LE, u64LE } from '../apps/backend/src/anchorRaw.js'
import { U64_MAX, formatAssetAmount, parseAssetAmount } from './treasury-admin-core.js'

/**
 * Чистое ядро операторского CLI стартовой выдачи POTATO (devnet).
 *
 * Зачем существует: новый игрок не мог начать игру — первое поле покупается
 * за POTATO (create_field), публичной выдачи до первого поля нет, а квесты
 * требуют уже иметь поле/баланс. Этот модуль + grant-potato.ts дают
 * оператору беты ручной, проверяемый путь: одна replay-proof выдача
 * (grant_reward_once) ровно на цену первого поля.
 *
 * Здесь нет ни сети, ни ключей — только константы-зеркала программы,
 * арифметика квоты, сборка инструкции и разбор аргументов. Всё это
 * закреплено тестом tests/offchain/grant-potato-core.test.ts, который
 * сверяет константы с текстом lib.rs, а инструкцию — с закоммиченным IDL.
 *
 * Дублирование buildGrantRewardOnceIx из backend/src/solana.ts намеренно:
 * тот модуль на импорте инстанцирует payer-ключ и RPC из env бэкенда, а
 * холодный операторский CLI не должен тащить серверное окружение.
 */

// ── Зеркала ончейн-констант (источник правды: programs/solana_potato/src/lib.rs) ──

/** lib.rs: `pub const MICRO` — 1 POTATO в микроединицах (6 decimals). */
export const POTATO_MICRO = 1_000_000n
const BPS = 10_000n
/** lib.rs: `pub const MAX_REWARD_MICRO: u64 = 1_000_000_000` — потолок одной выдачи (1 000 POTATO). */
export const MAX_REWARD_MICRO = 1_000n * POTATO_MICRO
/** lib.rs: `pub const GRANT_QUOTA_SHARE_BPS: u64 = 1_000` — ручным грантам доступно 10 % капа эпохи. */
export const GRANT_QUOTA_SHARE_BPS = 1_000n
/** lib.rs: `pub const MAX_REWARD_EXPIRY_SECONDS: i64 = 900` — подпись гранта живёт не дольше 15 минут. */
export const MAX_REWARD_EXPIRY_SECONDS = 900n
/** Срок, который CLI ставит свежему гранту: внутри лимита программы и с запасом на подтверждение. */
export const GRANT_EXPIRY_TTL_SECONDS = 600n
/** lib.rs: `pub const BASE_FIELD_PRICE_MICRO: u64 = 250_000_000` — цена эталонного поля типа 1. */
export const BASE_FIELD_PRICE_MICRO = 250n * POTATO_MICRO
/** lib.rs: type_cost_bps(0) = 4_000 (0.4×) — самое дешёвое первое поле («Грядка»). */
export const FIRST_FIELD_COST_BPS = 4_000n
/** Размер аккаунта Field (Rust `8 + Field::INIT_SPACE` = 70) для фильтра getProgramAccounts. */
export const FIELD_ACCOUNT_SIZE = 70

/** Цена первого (самого дешёвого) поля: scaled_cost(BASE, 0) = 100 POTATO. */
export function firstFieldPriceMicro(): bigint {
  return (BASE_FIELD_PRICE_MICRO * FIRST_FIELD_COST_BPS) / BPS
}

/** Стартовый грант = ровно одно первое поле. Ни больше (не размываем экономику беты), ни меньше. */
export function starterAmountMicro(): bigint {
  return firstFieldPriceMicro()
}

export type StarterIneligibility = 'has-field' | 'has-balance'

/**
 * Кому положен starter: только кошельку, который ещё не может начать игру
 * сам — нет ни одного поля и баланса не хватает даже на самое дешёвое.
 * Балансовый критерий закрывает двойную выдачу «второго стартера» тому,
 * кто первый получил, но поле пока не купил.
 */
export function starterEligibility(input: {
  readonly fieldCount: number
  readonly balanceMicro: bigint
}): { eligible: true } | { eligible: false; reason: StarterIneligibility } {
  if (input.fieldCount > 0) return { eligible: false, reason: 'has-field' }
  if (input.balanceMicro >= starterAmountMicro()) return { eligible: false, reason: 'has-balance' }
  return { eligible: true }
}

export function parsePotatoAmount(value: string): bigint {
  const micro = parseAssetAmount('potato', value)
  if (micro > MAX_REWARD_MICRO) {
    throw new RangeError(`amount exceeds the one-grant cap of ${formatAssetAmount('potato', MAX_REWARD_MICRO)} POTATO`)
  }
  return micro
}

export function formatPotato(micro: bigint): string {
  return formatAssetAmount('potato', micro)
}

export function parseNonce(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new RangeError('nonce must be a plain non-negative integer')
  const nonce = BigInt(value)
  if (nonce > U64_MAX) throw new RangeError('nonce exceeds u64')
  return nonce
}

// ── Квота эпохи (зеркало Rust charge_epoch_grant) ──────────────────────────

export interface EpochGrantState {
  /** Epoch.mint_cap_micro текущей эпохи. */
  readonly mintCapMicro: bigint
  /** Epoch.minted_micro: всего наминчено за эпоху (харвесты + гранты). */
  readonly mintedMicro: bigint
  /** Epoch.granted_micro: из них ручными грантами. */
  readonly grantedMicro: bigint
}

/** Дневная квота ручных грантов = GRANT_QUOTA_SHARE_BPS от капа эпохи. */
export function epochGrantQuotaMicro(mintCapMicro: bigint): bigint {
  return (mintCapMicro * GRANT_QUOTA_SHARE_BPS) / BPS
}

/**
 * Сколько ещё можно выдать грантами в этой эпохе. charge_epoch_grant в
 * программе проверяет оба потолка — квоту грантов И общий кап эпохи, —
 * поэтому остаток — минимум из двух, не ниже нуля.
 */
export function remainingGrantQuotaMicro(epoch: EpochGrantState): bigint {
  const byQuota = epochGrantQuotaMicro(epoch.mintCapMicro) - epoch.grantedMicro
  const byCap = epoch.mintCapMicro - epoch.mintedMicro
  const left = byQuota < byCap ? byQuota : byCap
  return left > 0n ? left : 0n
}

/** Предварительная проверка перед подписью: те же отказы, что даст программа, но человекочитаемо и до траты комиссии. */
export function assertGrantWithinLimits(amountMicro: bigint, epoch: EpochGrantState): void {
  if (amountMicro <= 0n) throw new RangeError('grant amount must be positive')
  if (amountMicro > MAX_REWARD_MICRO) {
    throw new RangeError(`grant amount exceeds the one-grant cap of ${formatPotato(MAX_REWARD_MICRO)} POTATO`)
  }
  const remaining = remainingGrantQuotaMicro(epoch)
  if (amountMicro > remaining) {
    throw new RangeError(
      `grant of ${formatPotato(amountMicro)} POTATO exceeds the remaining epoch grant quota `
      + `(${formatPotato(remaining)} POTATO of ${formatPotato(epochGrantQuotaMicro(epoch.mintCapMicro))} left; `
      + 'roll the epoch or wait for the next one)',
    )
  }
}

// ── PDA, nonce и срок ──────────────────────────────────────────────────────

/** Replay-маркер программы: seeds [b"reward", user_potato, nonce LE] (lib.rs GrantRewardOnce). */
export function rewardClaimPda(programId: PublicKey, userPotato: PublicKey, nonce: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reward'), userPotato.toBuffer(), u64LE(nonce)],
    programId,
  )[0]
}

/**
 * Стартовая точка авто-nonce: секунды цепного времени. PDA включает ATA
 * получателя, поэтому коллизия возможна только при двух выдачах одному
 * кошельку в одну секунду — её разрешает поиск свободного nonce ниже, а
 * на уровне программы повторный (ATA, nonce) всё равно невозможен (init).
 */
export function defaultNonceStart(chainNowSeconds: bigint): bigint {
  if (chainNowSeconds <= 0n) throw new RangeError('chain time must be positive to derive a nonce')
  return chainNowSeconds
}

/** Чистый перебор: первый nonce >= start, которого нет в занятом множестве. */
export function chooseFreeNonce(start: bigint, taken: ReadonlySet<bigint>): bigint {
  let nonce = start
  while (taken.has(nonce)) {
    nonce += 1n
    if (nonce > U64_MAX) throw new RangeError('nonce space exhausted')
  }
  return nonce
}

/** Асинхронный поиск по пробнику существования аккаунта (для CLI: getAccountInfo по PDA). */
export async function findFreeNonce(
  start: bigint,
  exists: (nonce: bigint) => Promise<boolean>,
  maxAttempts = 1_000,
): Promise<bigint> {
  let nonce = start
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (nonce > U64_MAX) break
    if (!(await exists(nonce))) return nonce
    nonce += 1n
  }
  throw new RangeError(`no free reward nonce found within ${maxAttempts} attempts from ${start}`)
}

/** Дедлайн гранта: цепное время + TTL; TTL обязан укладываться в лимит программы (900 c). */
export function computeExpiresAt(chainNowSeconds: bigint, ttlSeconds: bigint = GRANT_EXPIRY_TTL_SECONDS): bigint {
  if (ttlSeconds <= 0n || ttlSeconds > MAX_REWARD_EXPIRY_SECONDS) {
    throw new RangeError(`grant TTL must be within 1..${MAX_REWARD_EXPIRY_SECONDS} seconds (program limit)`)
  }
  return chainNowSeconds + ttlSeconds
}

// ── Инструкция grant_reward_once ─────────────────────────────────────────

export function buildGrantPotatoInstruction(input: {
  readonly programId: PublicKey
  readonly config: PublicKey
  readonly epoch: PublicKey
  /** reward_signer или authority (программа принимает обоих); также платит rent маркера. */
  readonly authority: PublicKey
  readonly potatoMint: PublicKey
  readonly userPotato: PublicKey
  readonly nonce: bigint
  readonly amountMicro: bigint
  readonly expiresAt: bigint
}): TransactionInstruction {
  if (input.amountMicro <= 0n || input.amountMicro > MAX_REWARD_MICRO) {
    throw new RangeError('grant amount is outside the program one-grant cap')
  }
  if (input.nonce < 0n || input.nonce > U64_MAX) throw new RangeError('grant nonce is outside u64')
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.config, isSigner: false, isWritable: true },
      { pubkey: input.epoch, isSigner: false, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: true },
      { pubkey: input.potatoMint, isSigner: false, isWritable: true },
      { pubkey: input.userPotato, isSigner: false, isWritable: true },
      { pubkey: rewardClaimPda(input.programId, input.userPotato, input.nonce), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global', 'grant_reward_once'),
      u64LE(input.nonce),
      u64LE(input.amountMicro),
      i64LE(input.expiresAt),
    ]),
  })
}

// ── Разбор аргументов CLI ────────────────────────────────────────────────

export type GrantPotatoCommand =
  | { readonly command: 'status'; readonly wallet: PublicKey }
  | { readonly command: 'starter'; readonly wallet: PublicKey }
  | { readonly command: 'grant'; readonly wallet: PublicKey; readonly amountMicro: bigint; readonly nonce?: bigint }

function parseWallet(value: string | undefined): PublicKey {
  if (!value) throw new RangeError('a recipient wallet public key is required')
  try {
    return new PublicKey(value)
  } catch {
    throw new RangeError(`recipient wallet is not a base58 public key: ${value}`)
  }
}

export function parseCommand(argv: readonly string[]): GrantPotatoCommand {
  const [command, ...rest] = argv
  if (command === 'status' || command === 'starter') {
    if (rest.length !== 1) throw new RangeError(`${command} requires exactly one wallet argument`)
    return { command, wallet: parseWallet(rest[0]) }
  }
  if (command === 'grant') {
    const wallet = parseWallet(rest[0])
    const amountText = rest[1]
    if (!amountText) throw new RangeError('grant requires an amount in POTATO (e.g. 100 or 12.5)')
    const amountMicro = parsePotatoAmount(amountText)
    let nonce: bigint | undefined
    const tail = rest.slice(2)
    if (tail.length === 2 && tail[0] === '--nonce' && tail[1]) {
      nonce = parseNonce(tail[1])
    } else if (tail.length !== 0) {
      throw new RangeError('grant accepts only an optional trailing --nonce <u64>')
    }
    return nonce === undefined
      ? { command, wallet, amountMicro }
      : { command, wallet, amountMicro, nonce }
  }
  throw new RangeError(`unknown command: ${command ?? '(none)'}`)
}
