import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import idl from '../idl.json'

/**
 * Client-side signing guards (security checklist items 50/51/55/56).
 *
 * The browser builds every instruction by hand (see `anchorClient.ts`), so the
 * *only* thing standing between a compromised dependency / injected script and
 * the player's wallet is this module. Three layers, all fail-closed:
 *
 *  1. `assertInstructionsAllowed` — before a transaction is built, every
 *     instruction must target the game program or a known-good system program
 *     (ComputeBudget / System / SPL Token / Associated Token). A wallet-drainer
 *     payload (`transfer` to an attacker, `setAuthority`, Token-2022 with a
 *     transfer hook, …) is rejected before the wallet ever sees it.
 *  2. `assertSignedInstructionsMatch` — after signing, the compiled message is
 *     compared byte-for-byte with what we asked to sign: same program, same
 *     instruction data, same order. A wallet (or an injected signer shim) that
 *     swaps, appends or drops an instruction cannot get the transaction sent.
 *  3. `describeInstructions` — human-readable preview for logs and prompts, so
 *     a player-facing confirmation can name what is being signed.
 *
 * Note on Token-2022: the on-chain program pins the classic SPL Token program
 * (see `Program<'info, Token>` in every context), so TOKEN_2022 is deliberately
 * NOT on the allowlist — no transfer hooks, no permanent delegates.
 */

export class UnsafeTransactionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeTransactionError'
  }
}

const IDL_PROGRAM_ID = new PublicKey(idl.address)

/** Discriminator (first 8 bytes) → instruction name, straight from the pinned IDL. */
const DISCRIMINATOR_NAMES: Map<string, string> = new Map(
  (idl.instructions as { name: string; discriminator: number[] }[]).map(ix => [
    Buffer.from(ix.discriminator).toString('hex'),
    ix.name,
  ]),
)

/** Programs the game is allowed to invoke. Anything else is refused. */
export const ALLOWED_PROGRAMS: PublicKey[] = [
  IDL_PROGRAM_ID,
  ComputeBudgetProgram.programId,
  SystemProgram.programId,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
]

export function isAllowedProgram(programId: PublicKey, gameProgram: PublicKey): boolean {
  if (programId.equals(gameProgram)) return true
  return ALLOWED_PROGRAMS.some(allowed => allowed.equals(programId))
}

/** Human-readable instruction names (falls back to the program id for system ixs). */
export function describeInstructions(ixs: readonly TransactionInstruction[]): string[] {
  return ixs.map(ix => {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) return 'compute_budget'
    if (ix.programId.equals(SystemProgram.programId)) return 'system_program'
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) return 'spl_token'
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) return 'associated_token'
    const name = DISCRIMINATOR_NAMES.get(Buffer.from(ix.data.subarray(0, 8)).toString('hex'))
    return name ?? `unknown(${ix.programId.toBase58().slice(0, 8)})`
  })
}

/**
 * Layer 1: refuse any instruction that is not ours or a known-good system
 * program. Called before the transaction is compiled, so a malicious payload
 * never reaches the wallet's signing prompt.
 */
export function assertInstructionsAllowed(
  ixs: readonly TransactionInstruction[],
  gameProgram: PublicKey,
): void {
  for (const ix of ixs) {
    if (!isAllowedProgram(ix.programId, gameProgram)) {
      throw new UnsafeTransactionError(
        `Blocked instruction to a non-allowlisted program ${ix.programId.toBase58()}`,
      )
    }
  }
}

/**
 * Layer 2 (legacy path): the same verification for a `Transaction` returned by
 * wallets that do not support VersionedTransaction. Legacy messages keep the
 * decoded instructions, so the check is a direct comparison.
 */
export function assertSignedLegacyInstructionsMatch(
  signed: Transaction,
  expected: readonly TransactionInstruction[],
  gameProgram: PublicKey,
): void {
  const actual = signed.instructions;
  if (actual.length !== expected.length) {
    throw new UnsafeTransactionError(
      `Wallet changed the transaction: expected ${expected.length} instruction(s), got ${actual.length}`,
    )
  }
  for (const [i, ix] of actual.entries()) {
    if (!isAllowedProgram(ix.programId, gameProgram)) {
      throw new UnsafeTransactionError(`Blocked instruction to a non-allowlisted program ${ix.programId.toBase58()}`)
    }
    if (!ix.programId.equals(expected[i].programId)) {
      throw new UnsafeTransactionError(
        `Wallet replaced instruction #${i + 1}: expected ${expected[i].programId.toBase58()}, got ${ix.programId.toBase58()}`,
      )
    }
    if (!Buffer.from(ix.data).equals(Buffer.from(expected[i].data))) {
      throw new UnsafeTransactionError(`Wallet modified the payload of instruction #${i + 1}`)
    }
  }
}

type CompiledIx = { programIdIndex: number; data: Uint8Array }

function compiledInstructions(message: VersionedTransaction['message']): CompiledIx[] {
  if ('compiledInstructions' in message) return message.compiledInstructions as CompiledIx[]
  // Legacy message: `instructions` is the same shape for our purposes.
  return (message as unknown as { instructions: CompiledIx[] }).instructions ?? []
}

/**
 * Layer 2: verify that the signed transaction still contains exactly the
 * instructions we asked for — same programs, same payload, same order.
 */
export function assertSignedInstructionsMatch(
  signed: VersionedTransaction,
  expected: readonly TransactionInstruction[],
  gameProgram: PublicKey,
): void {
  const compiled = compiledInstructions(signed.message)
  if (compiled.length !== expected.length) {
    throw new UnsafeTransactionError(
      `Wallet changed the transaction: expected ${expected.length} instruction(s), got ${compiled.length}`,
    )
  }
  const statics = signed.message.staticAccountKeys
  for (const [i, ci] of compiled.entries()) {
    if (ci.programIdIndex >= statics.length) {
      throw new UnsafeTransactionError('Wallet resolved an instruction program through a lookup table')
    }
    const program = statics[ci.programIdIndex]
    if (!isAllowedProgram(program, gameProgram)) {
      throw new UnsafeTransactionError(`Blocked instruction to a non-allowlisted program ${program.toBase58()}`)
    }
    if (!program.equals(expected[i].programId)) {
      throw new UnsafeTransactionError(
        `Wallet replaced instruction #${i + 1}: expected ${expected[i].programId.toBase58()}, got ${program.toBase58()}`,
      )
    }
    if (!Buffer.from(ci.data).equals(Buffer.from(expected[i].data))) {
      throw new UnsafeTransactionError(`Wallet modified the payload of instruction #${i + 1}`)
    }
  }
}
