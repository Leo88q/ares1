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
 *  2. `assertSignedInstructionsMatch` — after signing, the entire serialized
 *     message is compared byte-for-byte with a snapshot taken BEFORE calling
 *     the wallet. This includes fee payer, blockhash, every account key and its
 *     signer/writable privileges, program IDs, instruction data/order and lookup
 *     table references. A wallet (or injected signer shim) cannot redirect an
 *     instruction while preserving its program and payload.
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

/**
 * System-program instruction types that must NEVER be routed through this
 * client (checklist items 82/114, audit 2026-09-28). The nonce family creates
 * signatures that do not expire: Drift lost $285M+ because signers approved
 * durable-nonce transactions in advance. Allocate/Assign/CreateAccountWithSeed
 * were used by SwapNet-style routers to smuggle account ownership changes.
 * The game client only ever needs plain `transfer` (type 2) — allowlisted
 * alongside 0 (CreateAccount) only because it is harmless rent-paid creation;
 * everything else in this set requires a conscious change to this constant.
 *
 * Blocked here: 1 = Assign, 3 = CreateAccountWithSeed, 4..7 = nonce family
 * (Advance/Deallocate/Initialize/Authorize), 8/9 = Allocate(+WithSeed),
 * 10 = AssignWithSeed, 11 = TransferWithSeed, 12 = WithdrawNonceAccount.
 */
export const BLOCKED_SYSTEM_INSTRUCTION_TYPES: ReadonlySet<number> = new Set([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

/** True if the instruction is a System-program operation the client refuses to route. */
export function isBlockedSystemInstruction(ix: { programId: PublicKey; data: Uint8Array }): boolean {
  if (!ix.programId.equals(SystemProgram.programId)) return false
  const type = ix.data.length > 0 ? ix.data[0] : -1
  return BLOCKED_SYSTEM_INSTRUCTION_TYPES.has(type)
}

/**
 * Layer 1 supplement: durable nonces / allocate / assign are refused even
 * though SystemProgram itself is allowlisted (only `transfer` and `createAccount`
 * style ops with data outside the blocked set pass).
 */
function assertSystemInstructionAllowed(data: Uint8Array): void {
  const type = data.length > 0 ? data[0] : -1
  if (BLOCKED_SYSTEM_INSTRUCTION_TYPES.has(type)) {
    throw new UnsafeTransactionError(
      `Blocked System instruction type ${type} (durable nonce / allocate / assign family)`,
    )
  }
}

/** Human-readable instruction names (falls back to the program id for system ixs). */
export function describeInstructions(ixs: readonly TransactionInstruction[]): string[] {
  return ixs.map(ix => {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) return 'compute_budget'
    if (ix.programId.equals(SystemProgram.programId)) {
      // Human preview must name the dangerous family explicitly (item 104:
      // the player sees WHAT is signed — nonce ops would be a red flag).
      if (isBlockedSystemInstruction(ix)) return `system_nonce_op(type=${ix.data[0]})`
      return 'system_program'
    }
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
    if (ix.programId.equals(SystemProgram.programId)) {
      assertSystemInstructionAllowed(ix.data)
    }
  }
}

/**
 * Snapshot the exact legacy message before handing the transaction to a wallet.
 * Do not keep the Transaction object as the expected value: wallet adapters may
 * mutate and return that same object.
 */
export function snapshotLegacyMessage(tx: Transaction): Buffer {
  return Buffer.from(tx.serializeMessage())
}

/**
 * Layer 2 (legacy path): compare the complete signed message with the
 * pre-signing snapshot. This covers account keys/order/privileges, fee payer,
 * blockhash, program IDs and instruction data, not just instruction payloads.
 */
export function assertSignedLegacyInstructionsMatch(
  signed: Transaction,
  expectedMessage: Uint8Array,
): void {
  let actual: Uint8Array
  try {
    actual = signed.serializeMessage()
  } catch {
    throw new UnsafeTransactionError('Wallet returned an invalid legacy transaction message')
  }
  if (!Buffer.from(actual).equals(Buffer.from(expectedMessage))) {
    throw new UnsafeTransactionError('Wallet changed the transaction message after it was built')
  }
}

/**
 * Snapshot the exact v0 message before handing the transaction to a wallet.
 * The serialized form includes the header, payer, blockhash, account-key order,
 * all compiled instruction indexes/data, and address lookup table references.
 */
export function snapshotVersionedMessage(tx: VersionedTransaction): Buffer {
  return Buffer.from(tx.message.serialize())
}

/**
 * Layer 2: compare the complete signed v0 message with the immutable snapshot
 * captured before the wallet call. This also rejects account-meta, fee-payer,
 * blockhash and lookup-table substitutions.
 */
export function assertSignedInstructionsMatch(
  signed: VersionedTransaction,
  expectedMessage: Uint8Array,
): void {
  if (!Buffer.from(signed.message.serialize()).equals(Buffer.from(expectedMessage))) {
    throw new UnsafeTransactionError('Wallet changed the transaction message after it was built')
  }
}
