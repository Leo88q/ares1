import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import {
  ALLOWED_PROGRAMS,
  UnsafeTransactionError,
  assertInstructionsAllowed,
  assertSignedInstructionsMatch,
  assertSignedLegacyInstructionsMatch,
  describeInstructions,
  isAllowedProgram,
} from '../../apps/web/src/utils/txSafety'
import idl from '../../apps/web/src/idl.json'

// Checklist items 50 / 51 / 55 / 56 — client-side signing guards.
// These tests run in CI with no RPC: the guards are pure functions.

const game = new PublicKey(idl.address)
const harvestIx = (): TransactionInstruction =>
  new TransactionInstruction({
    programId: game,
    keys: [{ pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true }],
    data: Buffer.from(idl.instructions.find(ix => ix.name === 'harvest')!.discriminator),
  })

const computeIx = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })

test('allowlist contains only the game program and known-good system programs', () => {
  const ids = ALLOWED_PROGRAMS.map(p => p.toBase58())
  assert.ok(ids.includes(game.toBase58()))
  assert.ok(ids.includes(SystemProgram.programId.toBase58()))
  assert.ok(ids.includes(ComputeBudgetProgram.programId.toBase58()))
  assert.ok(ids.includes(TOKEN_PROGRAM_ID.toBase58()))
  // Item 38/39: Token-2022 (transfer hooks, permanent delegate) is NOT allowed.
  assert.ok(!ids.includes(TOKEN_2022_PROGRAM_ID.toBase58()))
  assert.ok(!isAllowedProgram(TOKEN_2022_PROGRAM_ID, game))
})

test('drainer payload is refused before it reaches the wallet', () => {
  const drainer = (programId: PublicKey) =>
    new TransactionInstruction({
      programId,
      keys: [{ pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true }],
      data: Buffer.from([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]), // SPL Transfer
    })

  // Game + system instructions are fine.
  assert.doesNotThrow(() => assertInstructionsAllowed([computeIx(), harvestIx()], game))
  assert.doesNotThrow(() =>
    assertInstructionsAllowed(
      [SystemProgram.transfer({ fromPubkey: Keypair.generate().publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
      game,
    ),
  )
  // A transfer pushed by a compromised dependency (or a Token-2022 hook program) is not.
  for (const bad of [TOKEN_2022_PROGRAM_ID, Keypair.generate().publicKey]) {
    assert.throws(() => assertInstructionsAllowed([drainer(bad)], game), UnsafeTransactionError)
    assert.throws(() => assertInstructionsAllowed([harvestIx(), drainer(bad)], game), UnsafeTransactionError)
  }
})

test('signed transaction is compared byte-for-byte with what was requested', () => {
  const payer = Keypair.generate().publicKey
  const expected = [computeIx(), harvestIx()]
  const build = (ixs: TransactionInstruction[]) =>
    new VersionedTransaction(
      new TransactionMessage({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions: ixs }).compileToV0Message(),
    )

  const signed = build(expected)
  assert.doesNotThrow(() => assertSignedInstructionsMatch(signed, expected, game))

  // 1) wallet drops an instruction
  assert.throws(
    () => assertSignedInstructionsMatch(build([expected[0]]), expected, game),
    /expected 2 instruction\(s\), got 1/,
  )
  // 2) wallet appends a transfer to an attacker
  assert.throws(
    () =>
      assertSignedInstructionsMatch(
        build([
          ...expected,
          SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1_000_000 }),
        ]),
        expected,
        game,
      ),
    UnsafeTransactionError,
  )
  // 3) wallet mutates the payload of a game instruction (same program, other data)
  const tampered = harvestIx()
  tampered.data = Buffer.from(idl.instructions.find(ix => ix.name === 'close_field')!.discriminator)
  assert.throws(
    () => assertSignedInstructionsMatch(build([computeIx(), tampered]), expected, game),
    /modified the payload/,
  )
  // 4) wallet swaps the program of an instruction
  const swapped = new TransactionInstruction({ programId: TOKEN_2022_PROGRAM_ID, keys: [], data: expected[1].data })
  assert.throws(() => assertSignedInstructionsMatch(build([computeIx(), swapped]), expected, game), UnsafeTransactionError)
})

test('human-readable preview names every instruction we sign', () => {
  const names = describeInstructions([
    computeIx(),
    harvestIx(),
    SystemProgram.transfer({ fromPubkey: Keypair.generate().publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
    new TransactionInstruction({ programId: game, keys: [], data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) }),
  ])
  assert.deepEqual(names, ['compute_budget', 'harvest', 'system_program', 'unknown(' + game.toBase58().slice(0, 8) + ')'])
})

test('legacy (non-versioned) transactions get the same post-sign verification', () => {
  const payer = Keypair.generate().publicKey
  const expected = [computeIx(), harvestIx()]
  const build = (ixs: TransactionInstruction[]) => {
    const tx = new Transaction().add(...ixs)
    tx.feePayer = payer
    tx.recentBlockhash = PublicKey.default.toBase58()
    return tx
  }
  assert.doesNotThrow(() => assertSignedLegacyInstructionsMatch(build(expected), expected, game))
  assert.throws(
    () => assertSignedLegacyInstructionsMatch(build([expected[0]]), expected, game),
    /expected 2 instruction\(s\), got 1/,
  )
  const tampered = harvestIx()
  tampered.data = Buffer.from(idl.instructions.find(ix => ix.name === 'close_field')!.discriminator)
  assert.throws(
    () => assertSignedLegacyInstructionsMatch(build([computeIx(), tampered]), expected, game),
    /modified the payload/,
  )
})

test('инструкция, чья программа пришла из lookup table, не подписывается', () => {
  // Item 50: если кошелёк/подмена решили программу инструкции через address
  // lookup table, статические ключи её не содержат — такие транзакции
  // отказаны до отправки (иначе allowlist проверять нечего).
  const payer = Keypair.generate().publicKey
  const expected = [computeIx(), harvestIx()]
  const signed = new VersionedTransaction(
    new TransactionMessage({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions: expected }).compileToV0Message(),
  )
  assert.doesNotThrow(() => assertSignedInstructionsMatch(signed, expected, game))
  signed.message.compiledInstructions[0].programIdIndex = signed.message.staticAccountKeys.length
  assert.throws(() => assertSignedInstructionsMatch(signed, expected, game), /lookup table/)
})

// --- Audit 2026-09-28: items 82/104/114 — durable nonce / allocate / assign ---

import {
  BLOCKED_SYSTEM_INSTRUCTION_TYPES,
  isBlockedSystemInstruction,
} from '../../apps/web/src/utils/txSafety'

const sysPk = () => ({
  fromPubkey: Keypair.generate().publicKey,
  nonceAccount: Keypair.generate().publicKey,
  authorizedPubkey: Keypair.generate().publicKey,
  toPubkey: Keypair.generate().publicKey,
  lamports: 1,
  space: 80,
  basePubkey: Keypair.generate().publicKey,
  seed: 's',
  newAuthorizedPubkey: Keypair.generate().publicKey,
})

test('durable-nonce family is enumerated and blocked by type', () => {
  const a = sysPk()
  const nonceOps = [
    SystemProgram.nonceAdvance({ noncePubkey: a.nonceAccount, authorizedPubkey: a.authorizedPubkey }),
    SystemProgram.nonceInitialize({ noncePubkey: a.nonceAccount, authorizedPubkey: a.authorizedPubkey }),
    SystemProgram.nonceAuthorize({ noncePubkey: a.nonceAccount, authorizedPubkey: a.authorizedPubkey, newAuthorizedPubkey: a.newAuthorizedPubkey }),
    SystemProgram.nonceWithdraw({ noncePubkey: a.nonceAccount, authorizedPubkey: a.authorizedPubkey, toPubkey: a.toPubkey, lamports: a.lamports }),
    SystemProgram.allocate({ accountPubkey: a.nonceAccount, space: a.space }),
    SystemProgram.allocate({ accountPubkey: a.nonceAccount, basePubkey: a.basePubkey, seed: a.seed, space: a.space, programId: game }),
    SystemProgram.assign({ accountPubkey: a.nonceAccount, programId: game }),
    SystemProgram.assign({ accountPubkey: a.nonceAccount, basePubkey: a.basePubkey, seed: a.seed, programId: game }),
    SystemProgram.createAccountWithSeed({ fromPubkey: a.fromPubkey, basePubkey: a.basePubkey, seed: a.seed, lamports: a.lamports, space: a.space, programId: game, newAccountPubkey: a.nonceAccount }),
  ]
  for (const ix of nonceOps) {
    assert.ok(
      isBlockedSystemInstruction(ix),
      `System ix type ${ix.data[0]} must be recognized as blocked`,
    )
    assert.throws(() => assertInstructionsAllowed([computeIx(), ix], game), UnsafeTransactionError)
  }
  // The types we saw in practice are pinned so a web3.js layout change is caught:
  const types = new Set(nonceOps.map(ix => ix.data[0]))
  for (const t of types) assert.ok(BLOCKED_SYSTEM_INSTRUCTION_TYPES.has(t))
  assert.deepEqual([...BLOCKED_SYSTEM_INSTRUCTION_TYPES].sort((x, y) => x - y), [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
})

test('ordinary system transfer still passes the client guards', () => {
  const transfer = SystemProgram.transfer({
    fromPubkey: Keypair.generate().publicKey,
    toPubkey: Keypair.generate().publicKey,
    lamports: 123,
  })
  assert.ok(!isBlockedSystemInstruction(transfer))
  assert.doesNotThrow(() => assertInstructionsAllowed([transfer], game))
})

test('signed transaction with a smuggled nonce instruction is refused after signing', () => {
  const payer = Keypair.generate().publicKey
  const a = sysPk()
  const expected = [computeIx(), harvestIx()]
  const nonceIx = SystemProgram.nonceAdvance({
    noncePubkey: a.nonceAccount,
    authorizedPubkey: payer,
  })
  // Wallet (or an injected signer shim) appends a durable-nonce instruction.
  const signed = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [...expected, nonceIx],
    }).compileToV0Message(),
  )
  assert.throws(() => assertSignedInstructionsMatch(signed, expected, game), UnsafeTransactionError)
  // And the preview names the family instead of a generic system_program.
  assert.equal(describeInstructions([nonceIx])[0], 'system_nonce_op(type=4)')
})
