import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { Keypair, SystemProgram } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { anchorDiscriminator } from '../../apps/backend/src/anchorRaw.js'
import {
  WITHDRAW_CAPS,
  U64_MAX,
  buildCancelWithdrawalInstruction,
  buildProposeWithdrawalInstruction,
  buildWithdrawalExecutionInstruction,
  decodeAdminState,
  formatAssetAmount,
  parseAssetAmount,
  remainingWindowBudget,
} from '../../scripts/treasury-admin-core.js'

const randomKey = () => Keypair.generate().publicKey
const idl = JSON.parse(fs.readFileSync('apps/web/src/idl.json', 'utf8')) as {
  instructions: Array<{ name: string; accounts: Array<{ name: string; writable?: boolean; signer?: boolean }> }>
}

function assertMatchesIdl(name: string, instruction: ReturnType<typeof buildProposeWithdrawalInstruction> | ReturnType<typeof buildCancelWithdrawalInstruction> | ReturnType<typeof buildWithdrawalExecutionInstruction>, expectedAccounts: string[]): void {
  const definition = idl.instructions.find(item => item.name === name)
  assert.ok(definition, `missing ${name} from the committed IDL`)
  assert.deepEqual(definition.accounts.map(account => account.name), expectedAccounts)
  assert.deepEqual(instruction.keys.map(meta => [meta.isSigner, meta.isWritable]), definition.accounts.map(account => [Boolean(account.signer), Boolean(account.writable)]))
  assert.equal(instruction.data.subarray(0, 8).toString('hex'), anchorDiscriminator('global', name).toString('hex'))
}

test('parses and formats token units exactly, with no floating-point conversion', () => {
  assert.equal(parseAssetAmount('potato', '1234.000001'), 1_234_000_001n)
  assert.equal(parseAssetAmount('skr', '0.5'), 500_000n)
  assert.equal(parseAssetAmount('sol', '1.000000001'), 1_000_000_001n)
  assert.equal(formatAssetAmount('sol', 1_000_000_001n), '1.000000001')
  assert.equal(formatAssetAmount('potato', 12_000_000n), '12')
  for (const invalid of ['0', '-1', '+1', '1e3', '01', '1.0000001', '1,2', 'NaN']) {
    assert.throws(() => parseAssetAmount('potato', invalid), RangeError, invalid)
  }
  assert.throws(() => parseAssetAmount('sol', '1.0000000001'), RangeError)
  assert.throws(() => parseAssetAmount('potato', U64_MAX.toString()), RangeError)
})

test('decodes the reviewed 145-byte AdminState layout and rejects legacy/unknown layouts', () => {
  const data = Buffer.alloc(145)
  anchorDiscriminator('account', 'AdminState').copy(data, 0)
  data.writeBigInt64LE(1_700_000_000n, 8)
  data.writeBigUInt64LE(100n, 16)
  data.writeBigUInt64LE(200n, 24)
  data.writeBigUInt64LE(300n, 32)
  data.writeBigUInt64LE(11n, 97)
  data.writeBigInt64LE(1_700_000_010n, 105)
  data.writeBigUInt64LE(22n, 113)
  data.writeBigInt64LE(1_700_000_020n, 121)
  data.writeBigUInt64LE(33n, 129)
  data.writeBigInt64LE(1_700_000_030n, 137)

  const decoded = decodeAdminState(data)
  assert.equal(decoded.windowStart, 1_700_000_000n)
  assert.deepEqual(decoded.withdrawn, { potato: 100n, sol: 200n, skr: 300n })
  assert.deepEqual(decoded.pending, {
    potato: { amount: 11n, proposedAt: 1_700_000_010n },
    sol: { amount: 22n, proposedAt: 1_700_000_020n },
    skr: { amount: 33n, proposedAt: 1_700_000_030n },
  })
  assert.throws(() => decodeAdminState(Buffer.alloc(97)), /unsupported size or discriminator/)
  const wrongDiscriminator = Buffer.alloc(145)
  assert.throws(() => decodeAdminState(wrongDiscriminator), /unsupported size or discriminator/)
})

test('CLI withdrawal limits and timelocks mirror the Rust source', () => {
  const rust = fs.readFileSync('programs/solana_potato/src/lib.rs', 'utf8')
  assert.match(rust, /pub const WITHDRAW_WINDOW_SECONDS: i64 = 86_400;/)
  assert.match(rust, /pub const WITHDRAW_TIMELOCK_SECONDS: i64 = 30;/)
  assert.match(rust, /pub const MAX_WITHDRAW_POTATO_MICRO_PER_WINDOW: u64 = 250_000_000_000;/)
  assert.match(rust, /pub const MAX_WITHDRAW_SOL_LAMPORTS_PER_WINDOW: u64 = 25_000_000_000;/)
  assert.match(rust, /pub const MAX_WITHDRAW_SKR_ATOMS_PER_WINDOW: u64 = 100_000_000_000;/)
})

test('rolling-window display resets only after 24h and never exceeds on-chain caps', () => {
  const state = {
    windowStart: 10_000n,
    withdrawn: { potato: 12n, sol: 2n, skr: WITHDRAW_CAPS.skr },
    pending: {
      potato: { amount: 0n, proposedAt: 0n },
      sol: { amount: 0n, proposedAt: 0n },
      skr: { amount: 0n, proposedAt: 0n },
    },
  }
  assert.equal(remainingWindowBudget(state, 'potato', 10_000n + 86_399n), WITHDRAW_CAPS.potato - 12n)
  assert.equal(remainingWindowBudget(state, 'sol', 10_000n + 86_400n), WITHDRAW_CAPS.sol)
  assert.equal(remainingWindowBudget(state, 'skr', 10_000n + 1n), 0n)
})

test('propose/cancel instruction bytes and account metas match the Anchor interface', () => {
  const programId = randomKey()
  const config = randomKey()
  const adminState = randomKey()
  const authority = randomKey()
  const proposal = buildProposeWithdrawalInstruction({
    programId, config, adminState, authority, asset: 'skr', amount: 123_456n,
  })
  assert.equal(proposal.programId.toBase58(), programId.toBase58())
  assertMatchesIdl('propose_withdrawal', proposal, ['config', 'admin_state', 'authority', 'system_program'])
  assert.equal(proposal.data[8], 2)
  assert.equal(proposal.data.readBigUInt64LE(9), 123_456n)
  assert.deepEqual(proposal.keys.map(meta => meta.pubkey.toBase58()), [
    config.toBase58(), adminState.toBase58(), authority.toBase58(), SystemProgram.programId.toBase58(),
  ])
  assert.deepEqual(proposal.keys.map(meta => [meta.isSigner, meta.isWritable]), [
    [false, false], [false, true], [true, true], [false, false],
  ])

  const cancel = buildCancelWithdrawalInstruction({ programId, config, adminState, authority })
  assertMatchesIdl('cancel_withdrawal', cancel, ['config', 'admin_state', 'authority', 'system_program'])
  assert.equal(cancel.data.toString('hex'), anchorDiscriminator('global', 'cancel_withdrawal').toString('hex'))
  assert.equal(cancel.keys.length, 4)
})

test('execution builders use only the authority destination and the expected token-program accounts', () => {
  const programId = randomKey()
  const config = randomKey()
  const treasurySol = randomKey()
  const adminState = randomKey()
  const authority = randomKey()
  const potatoMint = randomKey()
  const skrMint = randomKey()
  const base = { programId, config, treasurySol, adminState, authority, amount: 7n, potatoMint, skrMint }

  const sol = buildWithdrawalExecutionInstruction({ ...base, asset: 'sol' })
  assertMatchesIdl('withdraw_treasury_sol', sol, ['config', 'treasury_sol', 'admin_state', 'authority', 'system_program'])
  assert.deepEqual(sol.keys.map(meta => meta.pubkey.toBase58()), [
    config.toBase58(), treasurySol.toBase58(), adminState.toBase58(), authority.toBase58(), SystemProgram.programId.toBase58(),
  ])

  const potato = buildWithdrawalExecutionInstruction({ ...base, asset: 'potato' })
  assertMatchesIdl('withdraw_treasury', potato, ['config', 'potato_mint', 'treasury_potato', 'destination', 'admin_state', 'authority', 'token_program', 'system_program'])
  assert.equal(potato.keys[2].pubkey.toBase58(), getAssociatedTokenAddressSync(potatoMint, config, true).toBase58())
  assert.equal(potato.keys[3].pubkey.toBase58(), getAssociatedTokenAddressSync(potatoMint, authority, true).toBase58())
  assert.equal(potato.keys[6].pubkey.toBase58(), TOKEN_PROGRAM_ID.toBase58())

  const skr = buildWithdrawalExecutionInstruction({ ...base, asset: 'skr' })
  assertMatchesIdl('withdraw_skr_treasury', skr, ['config', 'treasury_sol', 'treasury_skr_ata', 'admin_state', 'authority', 'skr_mint', 'destination_ata', 'system_program', 'token_program', 'associated_token_program'])
  assert.equal(skr.keys[2].pubkey.toBase58(), getAssociatedTokenAddressSync(skrMint, treasurySol, true).toBase58())
  assert.equal(skr.keys[6].pubkey.toBase58(), getAssociatedTokenAddressSync(skrMint, authority, true).toBase58())
  assert.equal(skr.keys[9].pubkey.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58())
  assert.equal(skr.keys[6].isWritable, true)
  assert.equal(skr.keys[4].isSigner, true)
  assert.notEqual(skr.keys[6].pubkey.toBase58(), authority.toBase58())
})
