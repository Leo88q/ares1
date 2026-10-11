import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { anchorDiscriminator } from '../apps/backend/src/anchorRaw.js'

export type TreasuryAsset = 'potato' | 'sol' | 'skr'

export const U64_MAX = (1n << 64n) - 1n
export const WITHDRAW_WINDOW_SECONDS = 86_400n
export const WITHDRAW_TIMELOCK_SECONDS = 30n
export const WITHDRAW_CAPS = {
  potato: 250_000n * 1_000_000n,
  sol: 25n * 1_000_000_000n,
  skr: 100_000n * 1_000_000n,
} as const

export interface PendingWithdrawal {
  readonly amount: bigint
  readonly proposedAt: bigint
}

export interface DecodedAdminState {
  readonly windowStart: bigint
  readonly withdrawn: Readonly<Record<TreasuryAsset, bigint>>
  readonly pending: Readonly<Record<TreasuryAsset, PendingWithdrawal>>
}

export function parseAssetAmount(asset: TreasuryAsset, value: string): bigint {
  const decimals = asset === 'sol' ? 9 : 6
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new RangeError('amount must be a positive plain decimal without signs or exponent notation')
  }
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals) throw new RangeError(`amount supports at most ${decimals} decimal places`)
  const padded = fraction.padEnd(decimals, '0')
  const atoms = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(padded || '0')
  if (atoms <= 0n) throw new RangeError('amount must be positive')
  if (atoms > U64_MAX) throw new RangeError('amount exceeds u64')
  return atoms
}

export function formatAssetAmount(asset: TreasuryAsset, atoms: bigint): string {
  const decimals = asset === 'sol' ? 9 : 6
  const scale = 10n ** BigInt(decimals)
  const whole = atoms / scale
  const fractional = (atoms % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fractional ? `${whole}.${fractional}` : whole.toString()
}

export function decodeAdminState(data: Buffer): DecodedAdminState {
  if (data.length !== 145 || !data.subarray(0, 8).equals(anchorDiscriminator('account', 'AdminState'))) {
    throw new Error('AdminState has an unsupported size or discriminator; inspect/migrate it before any withdrawal')
  }
  const u64 = (offset: number) => data.readBigUInt64LE(offset)
  const i64 = (offset: number) => data.readBigInt64LE(offset)
  return {
    windowStart: i64(8),
    withdrawn: {
      potato: u64(16),
      sol: u64(24),
      skr: u64(32),
    },
    pending: {
      potato: { amount: u64(97), proposedAt: i64(105) },
      sol: { amount: u64(113), proposedAt: i64(121) },
      skr: { amount: u64(129), proposedAt: i64(137) },
    },
  }
}

export function remainingWindowBudget(state: DecodedAdminState, asset: TreasuryAsset, nowUnixSeconds: bigint): bigint {
  const alreadyWithdrawn = nowUnixSeconds - state.windowStart >= WITHDRAW_WINDOW_SECONDS
    ? 0n
    : state.withdrawn[asset]
  return WITHDRAW_CAPS[asset] > alreadyWithdrawn ? WITHDRAW_CAPS[asset] - alreadyWithdrawn : 0n
}

export function buildProposeWithdrawalInstruction(input: {
  readonly programId: PublicKey
  readonly config: PublicKey
  readonly adminState: PublicKey
  readonly authority: PublicKey
  readonly asset: TreasuryAsset
  readonly amount: bigint
}): TransactionInstruction {
  if (input.amount <= 0n || input.amount > U64_MAX) throw new RangeError('invalid withdrawal amount')
  const kind = input.asset === 'potato' ? 0 : input.asset === 'sol' ? 1 : 2
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.config, isSigner: false, isWritable: false },
      { pubkey: input.adminState, isSigner: false, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global', 'propose_withdrawal'),
      Buffer.from([kind]),
      u64LE(input.amount),
    ]),
  })
}

export function buildCancelWithdrawalInstruction(input: {
  readonly programId: PublicKey
  readonly config: PublicKey
  readonly adminState: PublicKey
  readonly authority: PublicKey
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.config, isSigner: false, isWritable: false },
      { pubkey: input.adminState, isSigner: false, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('global', 'cancel_withdrawal'),
  })
}

export function buildWithdrawalExecutionInstruction(input: {
  readonly programId: PublicKey
  readonly config: PublicKey
  readonly treasurySol: PublicKey
  readonly adminState: PublicKey
  readonly authority: PublicKey
  readonly asset: TreasuryAsset
  readonly amount: bigint
  readonly potatoMint: PublicKey
  readonly skrMint: PublicKey
}): TransactionInstruction {
  if (input.amount <= 0n || input.amount > U64_MAX) throw new RangeError('invalid withdrawal amount')
  const u64Amount = u64LE(input.amount)
  if (input.asset === 'sol') {
    return new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.config, isSigner: false, isWritable: false },
        { pubkey: input.treasurySol, isSigner: false, isWritable: true },
        { pubkey: input.adminState, isSigner: false, isWritable: true },
        { pubkey: input.authority, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([anchorDiscriminator('global', 'withdraw_treasury_sol'), u64Amount]),
    })
  }
  if (input.asset === 'potato') {
    const treasuryPotato = getAssociatedTokenAddressSync(input.potatoMint, input.config, true)
    const destination = getAssociatedTokenAddressSync(input.potatoMint, input.authority, true)
    return new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.config, isSigner: false, isWritable: false },
        { pubkey: input.potatoMint, isSigner: false, isWritable: false },
        { pubkey: treasuryPotato, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: input.adminState, isSigner: false, isWritable: true },
        { pubkey: input.authority, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([anchorDiscriminator('global', 'withdraw_treasury'), u64Amount]),
    })
  }
  const treasurySkrAta = getAssociatedTokenAddressSync(input.skrMint, input.treasurySol, true)
  const destinationAta = getAssociatedTokenAddressSync(input.skrMint, input.authority, true)
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.config, isSigner: false, isWritable: false },
      { pubkey: input.treasurySol, isSigner: false, isWritable: false },
      { pubkey: treasurySkrAta, isSigner: false, isWritable: true },
      { pubkey: input.adminState, isSigner: false, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: true },
      { pubkey: input.skrMint, isSigner: false, isWritable: false },
      { pubkey: destinationAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([anchorDiscriminator('global', 'withdraw_skr_treasury'), u64Amount]),
  })
}

function u64LE(value: bigint): Buffer {
  const out = Buffer.alloc(8)
  out.writeBigUInt64LE(value)
  return out
}
