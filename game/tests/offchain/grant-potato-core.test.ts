import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { anchorDiscriminator } from '../../apps/backend/src/anchorRaw.js'
import {
  BASE_FIELD_PRICE_MICRO,
  FIELD_ACCOUNT_SIZE,
  FIRST_FIELD_COST_BPS,
  GRANT_EXPIRY_TTL_SECONDS,
  GRANT_QUOTA_SHARE_BPS,
  MAX_REWARD_EXPIRY_SECONDS,
  MAX_REWARD_MICRO,
  assertGrantWithinLimits,
  buildGrantPotatoInstruction,
  chooseFreeNonce,
  computeExpiresAt,
  defaultNonceStart,
  epochGrantQuotaMicro,
  findFreeNonce,
  firstFieldPriceMicro,
  formatPotato,
  parseCommand,
  parsePotatoAmount,
  remainingGrantQuotaMicro,
  rewardClaimPda,
  starterAmountMicro,
  starterEligibility,
} from '../../scripts/grant-potato-core.js'

const randomKey = () => Keypair.generate().publicKey
const rust = fs.readFileSync('programs/solana_potato/src/lib.rs', 'utf8')
const idl = JSON.parse(fs.readFileSync('apps/web/src/idl.json', 'utf8')) as {
  instructions: Array<{
    name: string
    discriminator: number[]
    accounts: Array<{ name: string; writable?: boolean; signer?: boolean }>
    args: Array<{ name: string; type: string }>
  }>
}

function rustConst(name: string): bigint {
  const match = rust.match(new RegExp(`pub const ${name}: (?:u64|i64|u128) = ([\\d_]+)`))
  assert.ok(match, `Rust const ${name} must exist`)
  return BigInt(match[1]!.replaceAll('_', ''))
}

test('grant constants mirror the Rust program (caps, quota share, expiry, first-field price)', () => {
  assert.equal(MAX_REWARD_MICRO, rustConst('MAX_REWARD_MICRO'))
  assert.equal(GRANT_QUOTA_SHARE_BPS, rustConst('GRANT_QUOTA_SHARE_BPS'))
  assert.equal(MAX_REWARD_EXPIRY_SECONDS, rustConst('MAX_REWARD_EXPIRY_SECONDS'))
  assert.equal(BASE_FIELD_PRICE_MICRO, rustConst('BASE_FIELD_PRICE_MICRO'))
  assert.ok(GRANT_EXPIRY_TTL_SECONDS <= MAX_REWARD_EXPIRY_SECONDS)

  // type_cost_bps(0) — множитель самого дешёвого поля в Rust match.
  assert.match(rust, /0 => 4_000,\s*\/\/ 0\.4×/)
  assert.equal(FIRST_FIELD_COST_BPS, 4_000n)
  // 250 POTATO × 0.4 = 100 POTATO ровно.
  assert.equal(firstFieldPriceMicro(), 100_000_000n)
  assert.equal(starterAmountMicro(), firstFieldPriceMicro())
  assert.equal(FIELD_ACCOUNT_SIZE, 70)
  assert.match(rust, /space\s*=\s*8\s*\+\s*Field::INIT_SPACE/)
})

test('starterEligibility: только кошелёк, который ещё не может начать сам', () => {
  assert.deepEqual(starterEligibility({ fieldCount: 0, balanceMicro: 0n }), { eligible: true })
  assert.deepEqual(starterEligibility({ fieldCount: 0, balanceMicro: starterAmountMicro() - 1n }), { eligible: true })
  // Уже есть поле — стартер не положен независимо от баланса.
  assert.deepEqual(starterEligibility({ fieldCount: 1, balanceMicro: 0n }), { eligible: false, reason: 'has-field' })
  // Баланса хватает на первое поле (например, стартер уже получен, поле не куплено).
  assert.deepEqual(
    starterEligibility({ fieldCount: 0, balanceMicro: starterAmountMicro() }),
    { eligible: false, reason: 'has-balance' },
  )
})

test('parsePotatoAmount: точный bigint-парсинг и потолок одной выдачи', () => {
  assert.equal(parsePotatoAmount('100'), 100_000_000n)
  assert.equal(parsePotatoAmount('12.5'), 12_500_000n)
  assert.equal(parsePotatoAmount('0.000001'), 1n)
  assert.equal(formatPotato(100_000_000n), '100')
  assert.throws(() => parsePotatoAmount('0'), /positive/)
  assert.throws(() => parsePotatoAmount('1e2'), /plain decimal/)
  assert.throws(() => parsePotatoAmount('1.0000001'), /at most 6 decimal/)
  assert.throws(() => parsePotatoAmount('1000.000001'), /one-grant cap/)
  assert.throws(() => parsePotatoAmount('-5'))
})

test('квота эпохи повторяет charge_epoch_grant: минимум из квоты грантов и общего капа', () => {
  const cap = 250_000n * 1_000_000n // максимальный дневной кап программы
  assert.equal(epochGrantQuotaMicro(cap), 25_000n * 1_000_000n)

  // Свободная эпоха: ограничивает квота грантов (10 %), а не общий кап.
  assert.equal(remainingGrantQuotaMicro({ mintCapMicro: cap, mintedMicro: 0n, grantedMicro: 0n }), 25_000n * 1_000_000n)
  // Харвесты почти выбрали кап: ограничивает общий кап.
  assert.equal(
    remainingGrantQuotaMicro({ mintCapMicro: cap, mintedMicro: cap - 5_000_000n, grantedMicro: 0n }),
    5_000_000n,
  )
  // Квота выбрана грантами целиком.
  assert.equal(
    remainingGrantQuotaMicro({ mintCapMicro: cap, mintedMicro: 25_000n * 1_000_000n, grantedMicro: 25_000n * 1_000_000n }),
    0n,
  )

  const epoch = { mintCapMicro: cap, mintedMicro: 0n, grantedMicro: 24_950n * 1_000_000n }
  assert.doesNotThrow(() => assertGrantWithinLimits(50n * 1_000_000n, epoch))
  assert.throws(() => assertGrantWithinLimits(51n * 1_000_000n, epoch), /remaining epoch grant quota/)
  assert.throws(() => assertGrantWithinLimits(MAX_REWARD_MICRO + 1n, epoch), /one-grant cap/)
  assert.throws(() => assertGrantWithinLimits(0n, epoch), /positive/)
})

test('nonce: автостарт от цепного времени, перебор мимо занятых, дедлайн внутри лимита программы', async () => {
  assert.equal(defaultNonceStart(1_763_000_000n), 1_763_000_000n)
  assert.throws(() => defaultNonceStart(0n), /positive/)
  assert.equal(chooseFreeNonce(7n, new Set([7n, 8n, 10n])), 9n)
  assert.equal(await findFreeNonce(5n, async n => n < 8n), 8n)
  await assert.rejects(findFreeNonce(5n, async () => true, 3), /no free reward nonce/)

  assert.equal(computeExpiresAt(1_000n), 1_000n + GRANT_EXPIRY_TTL_SECONDS)
  assert.throws(() => computeExpiresAt(1_000n, 901n), /program limit/)
  assert.throws(() => computeExpiresAt(1_000n, 0n), /program limit/)
})

test('buildGrantPotatoInstruction совпадает с IDL grant_reward_once: аккаунты, флаги, дискриминатор, данные', () => {
  const definition = idl.instructions.find(item => item.name === 'grant_reward_once')
  assert.ok(definition, 'grant_reward_once must exist in the committed IDL')
  assert.deepEqual(definition.accounts.map(a => a.name), [
    'config', 'epoch', 'authority', 'potato_mint', 'user_potato', 'reward_claim', 'system_program', 'token_program',
  ])
  assert.deepEqual(definition.args.map(a => [a.name, a.type]), [
    ['nonce', 'u64'], ['amount_micro', 'u64'], ['expires_at', 'i64'],
  ])

  const programId = randomKey()
  const config = randomKey()
  const epoch = randomKey()
  const authority = randomKey()
  const potatoMint = randomKey()
  const userPotato = randomKey()
  const nonce = 42n
  const amountMicro = 100_000_000n
  const expiresAt = 1_763_000_600n

  const ix = buildGrantPotatoInstruction({
    programId, config, epoch, authority, potatoMint, userPotato, nonce, amountMicro, expiresAt,
  })

  assert.equal(ix.programId.toBase58(), programId.toBase58())
  assert.deepEqual(ix.keys.map(meta => meta.pubkey.toBase58()), [
    config.toBase58(),
    epoch.toBase58(),
    authority.toBase58(),
    potatoMint.toBase58(),
    userPotato.toBase58(),
    rewardClaimPda(programId, userPotato, nonce).toBase58(),
    SystemProgram.programId.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
  ])
  assert.deepEqual(
    ix.keys.map(meta => [meta.isSigner, meta.isWritable]),
    definition.accounts.map(account => [Boolean(account.signer), Boolean(account.writable)]),
  )
  assert.equal(ix.data.subarray(0, 8).toString('hex'), Buffer.from(definition.discriminator).toString('hex'))
  assert.equal(ix.data.subarray(0, 8).toString('hex'), anchorDiscriminator('global', 'grant_reward_once').toString('hex'))
  assert.equal(ix.data.readBigUInt64LE(8), nonce)
  assert.equal(ix.data.readBigUInt64LE(16), amountMicro)
  assert.equal(ix.data.readBigInt64LE(24), expiresAt)
  assert.equal(ix.data.length, 32)

  // PDA маркера строится по тем же seeds, что зашиты в Rust-аккаунте.
  assert.match(rust, /seeds = \[b"reward", user_potato\.key\(\)\.as_ref\(\), nonce\.to_le_bytes\(\)\.as_ref\(\)\]/)
  const manual = PublicKey.findProgramAddressSync(
    [Buffer.from('reward'), userPotato.toBuffer(), Buffer.from([42, 0, 0, 0, 0, 0, 0, 0])],
    programId,
  )[0]
  assert.equal(rewardClaimPda(programId, userPotato, nonce).toBase58(), manual.toBase58())

  assert.throws(() => buildGrantPotatoInstruction({
    programId, config, epoch, authority, potatoMint, userPotato, nonce, amountMicro: MAX_REWARD_MICRO + 1n, expiresAt,
  }), /one-grant cap/)
})

test('parseCommand: status/starter/grant и отказы на мусоре', () => {
  const wallet = randomKey()
  const walletText = wallet.toBase58()

  assert.deepEqual(parseCommand(['status', walletText]), { command: 'status', wallet })
  assert.deepEqual(parseCommand(['starter', walletText]), { command: 'starter', wallet })

  const grant = parseCommand(['grant', walletText, '12.5'])
  assert.equal(grant.command, 'grant')
  assert.equal(grant.wallet.toBase58(), walletText)
  assert.equal(grant.command === 'grant' ? grant.amountMicro : -1n, 12_500_000n)
  assert.equal(grant.command === 'grant' ? grant.nonce : -1n, undefined)

  const withNonce = parseCommand(['grant', walletText, '1', '--nonce', '7'])
  assert.equal(withNonce.command === 'grant' ? withNonce.nonce : -1n, 7n)

  assert.throws(() => parseCommand([]), /unknown command/)
  assert.throws(() => parseCommand(['status']), /exactly one wallet/)
  assert.throws(() => parseCommand(['starter', 'not-a-key!!!']), /not a base58 public key/)
  assert.throws(() => parseCommand(['grant', walletText]), /requires an amount/)
  assert.throws(() => parseCommand(['grant', walletText, '1', '--force']), /only an optional trailing --nonce/)
  assert.throws(() => parseCommand(['grant', walletText, '1', '--nonce', '-1']), /non-negative integer/)
  assert.throws(() => parseCommand(['faucet', walletText]), /unknown command/)
})
