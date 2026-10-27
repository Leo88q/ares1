#!/usr/bin/env node
/**
 * Операторский CLI стартовой выдачи POTATO для devnet-беты.
 *
 * Проблема, которую он закрывает: первое поле в игре покупается за POTATO
 * (create_field), публичной выдачи до первого поля нет, а квесты требуют
 * уже иметь поле или баланс — новый кошелёк не мог начать играть вообще.
 * `starter` выдаёт ровно цену первого поля (100 POTATO) одной replay-proof
 * инструкцией grant_reward_once; `grant` — произвольную сумму в пределах
 * ончейн-капа одной выдачи и оставшейся квоты эпохи.
 *
 * Безопасность повторяет контур treasury-admin:
 *   - DEVNET ONLY: кластер задаётся явно и сверяется с genesis-хэшем RPC;
 *     mainnet-выдача этим инструментом запрещена (там — отдельно
 *     ревьюемый запускной флоу, см. launchGates бэкенда);
 *   - ключ подписанта — локальный файл 0600 reward_signer (или authority),
 *     никогда не VPS/CI; подписант сверяется с ончейн-конфигом до отправки;
 *   - запись — только из интерактивного терминала с точной фразой;
 *   - транзакция симулируется fail-closed перед отправкой;
 *   - повторная выдача с тем же (ATA, nonce) невозможна ончейн (init PDA).
 *
 * From game/:
 *   SOLANA_CLUSTER=devnet yarn grant-potato status <wallet>
 *   SOLANA_CLUSTER=devnet REWARD_KEYPAIR_PATH=~/.config/solana/reward.json \
 *     yarn grant-potato starter <wallet>
 *   ... yarn grant-potato grant <wallet> 12.5 [--nonce 42]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token'
import { decodeEpoch, decodeGameConfig, u64LE } from '../apps/backend/src/anchorRaw.js'
import { safeError } from '../apps/backend/src/security.js'
import { expectedGenesisHash } from '../apps/backend/src/cluster.js'
import {
  FIELD_ACCOUNT_SIZE,
  assertGrantWithinLimits,
  buildGrantPotatoInstruction,
  computeExpiresAt,
  defaultNonceStart,
  findFreeNonce,
  formatPotato,
  parseCommand,
  remainingGrantQuotaMicro,
  rewardClaimPda,
  starterAmountMicro,
  starterEligibility,
  type GrantPotatoCommand,
} from './grant-potato-core.js'

const DEFAULT_PROGRAM_ID = 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf'
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com'

class UsageError extends Error {}

interface Runtime {
  readonly connection: Connection
  readonly programId: PublicKey
  readonly configAddress: PublicKey
}

function usage(): string {
  return [
    'Usage:',
    '  SOLANA_CLUSTER=devnet yarn grant-potato status <wallet>',
    '  SOLANA_CLUSTER=devnet REWARD_KEYPAIR_PATH=<0600 reward_signer/authority keypair> yarn grant-potato starter <wallet>',
    '  SOLANA_CLUSTER=devnet REWARD_KEYPAIR_PATH=<...> yarn grant-potato grant <wallet> <amountPotato> [--nonce <u64>]',
    '',
    'Devnet-only operator starter issuance. `starter` grants exactly the first-field',
    'price and refuses wallets that already own a field. Writes need an interactive',
    'terminal and an exact confirmation phrase. Env: SOLANA_CLUSTER=devnet (required),',
    'RPC_URL (default public devnet), PROGRAM_ID (default ARES-1 program),',
    'REWARD_KEYPAIR_PATH or ADMIN_KEYPAIR_PATH (writes only).',
  ].join('\n')
}

function getRuntime(): Runtime {
  const cluster = process.env.SOLANA_CLUSTER
  if (cluster !== 'devnet') {
    throw new UsageError(
      'SOLANA_CLUSTER must be explicitly set to devnet: starter issuance is a devnet-beta '
      + 'operator mechanism; mainnet issuance requires the reviewed launch flow, not this CLI',
    )
  }
  const rpcUrl = process.env.RPC_URL || DEFAULT_RPC_URL
  const programId = new PublicKey(process.env.PROGRAM_ID || DEFAULT_PROGRAM_ID)
  const [configAddress] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
  return { connection: new Connection(rpcUrl, 'confirmed'), programId, configAddress }
}

async function verifyCluster(runtime: Runtime): Promise<void> {
  const genesisHash = await runtime.connection.getGenesisHash()
  if (genesisHash !== expectedGenesisHash('devnet')) {
    throw new Error('RPC cluster mismatch: expected devnet genesis; refusing to continue')
  }
}

function readSignerKeypair(): Keypair {
  const configuredPath = process.env.REWARD_KEYPAIR_PATH || process.env.ADMIN_KEYPAIR_PATH || process.env.ANCHOR_WALLET
  if (!configuredPath) {
    throw new UsageError('REWARD_KEYPAIR_PATH must point to the local reward_signer (or authority) keypair')
  }
  const expandedPath = configuredPath.startsWith('~/')
    ? path.join(os.homedir(), configuredPath.slice(2))
    : configuredPath
  const fileStat = fs.statSync(expandedPath)
  if (process.platform !== 'win32' && (fileStat.mode & 0o077) !== 0) {
    throw new UsageError('signer keypair file must not be readable by group/other; set mode 0600 and retry')
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(expandedPath, 'utf8'))
  if (!Array.isArray(parsed) || parsed.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new UsageError('signer keypair file must contain a JSON byte array')
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]))
}

async function readGameConfig(runtime: Runtime) {
  const account = await runtime.connection.getAccountInfo(runtime.configAddress, 'confirmed')
  if (!account) throw new Error('GameConfig is missing at the configured program; refusing to continue')
  if (!account.owner.equals(runtime.programId)) throw new Error('GameConfig is not owned by the configured program')
  return decodeGameConfig(account.data)
}

function epochAddress(runtime: Runtime, epochId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('epoch'), u64LE(epochId)], runtime.programId)[0]
}

async function readEpoch(runtime: Runtime, epochId: bigint) {
  const address = epochAddress(runtime, epochId)
  const account = await runtime.connection.getAccountInfo(address, 'confirmed')
  if (!account) throw new Error(`Epoch ${epochId} account is missing; refusing to continue`)
  if (!account.owner.equals(runtime.programId)) throw new Error('Epoch account is not owned by the configured program')
  return { address, epoch: decodeEpoch(account.data) }
}

async function currentChainTime(connection: Connection): Promise<bigint> {
  const slot = await connection.getSlot('confirmed')
  const blockTime = await connection.getBlockTime(slot)
  if (blockTime === null) throw new Error('RPC did not return a confirmed block time; refusing time-sensitive action')
  return BigInt(blockTime)
}

async function countWalletFields(runtime: Runtime, wallet: PublicKey): Promise<number> {
  const accounts = await runtime.connection.getProgramAccounts(runtime.programId, {
    commitment: 'confirmed',
    filters: [
      { dataSize: FIELD_ACCOUNT_SIZE },
      { memcmp: { offset: 8, bytes: wallet.toBase58() } },
    ],
  })
  return accounts.length
}

async function readPotatoAta(
  runtime: Runtime,
  ata: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
): Promise<{ exists: boolean; amountMicro: bigint }> {
  const info = await runtime.connection.getAccountInfo(ata, 'confirmed')
  if (!info) return { exists: false, amountMicro: 0n }
  const parsed = unpackAccount(ata, info)
  if (!parsed.mint.equals(mint) || !parsed.owner.equals(owner)) {
    throw new Error('Recipient POTATO ATA has unexpected mint/owner; refusing to proceed')
  }
  return { exists: true, amountMicro: parsed.amount }
}

async function showStatus(runtime: Runtime, wallet: PublicKey): Promise<void> {
  const config = await readGameConfig(runtime)
  const { epoch } = await readEpoch(runtime, config.epochId)
  const ata = getAssociatedTokenAddressSync(config.potatoMint, wallet, false)
  const [ataState, fieldCount] = await Promise.all([
    readPotatoAta(runtime, ata, config.potatoMint, wallet),
    countWalletFields(runtime, wallet),
  ])
  console.log('Cluster:        devnet')
  console.log(`Program:        ${runtime.programId.toBase58()}`)
  console.log(`Authority:      ${config.authority.toBase58()}`)
  console.log(`Reward signer:  ${config.rewardSigner.toBase58()}`)
  console.log(`POTATO mint:    ${config.potatoMint.toBase58()}`)
  console.log(`Paused:         ${config.paused}`)
  console.log(`Epoch:          ${epoch.id} (cap ${formatPotato(epoch.mintCapMicro)} POTATO, minted ${formatPotato(epoch.mintedMicro)}, granted ${formatPotato(epoch.grantedMicro)})`)
  console.log(`Grant quota left this epoch: ${formatPotato(remainingGrantQuotaMicro(epoch))} POTATO`)
  console.log(`Starter amount (first field): ${formatPotato(starterAmountMicro())} POTATO`)
  console.log(`Wallet:         ${wallet.toBase58()}`)
  console.log(`Wallet POTATO ATA: ${ata.toBase58()} (${ataState.exists ? `${formatPotato(ataState.amountMicro)} POTATO` : 'not created yet'})`)
  console.log(`Wallet fields:  ${fieldCount}`)
  const eligibility = starterEligibility({ fieldCount, balanceMicro: ataState.amountMicro })
  console.log(`Starter eligible: ${eligibility.eligible
    ? 'yes'
    : eligibility.reason === 'has-field'
      ? 'no (already owns a field; use grant for a deliberate top-up)'
      : 'no (balance already covers the first field)'}`)
}

async function confirmAction(phrase: string): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Grant writes require an interactive terminal; non-interactive execution is denied')
  }
  const readLine = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await readLine.question(`Type exactly "${phrase}" to continue: `)
    if (answer.trim() !== phrase) throw new Error('Confirmation did not match; no transaction was sent')
  } finally {
    readLine.close()
  }
}

/** Симуляция — жёсткий гейт, пара (blockhash, lastValidBlockHeight) — из одного ответа RPC. */
async function sendInstructions(runtime: Runtime, signer: Keypair, instructions: TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await runtime.connection.getLatestBlockhash('confirmed')
  const transaction = new Transaction()
  for (const instruction of instructions) transaction.add(instruction)
  transaction.recentBlockhash = blockhash
  transaction.feePayer = signer.publicKey
  transaction.sign(signer)
  const simulation = await runtime.connection.simulateTransaction(transaction)
  if (simulation.value.err) {
    const logs = (simulation.value.logs ?? []).join('\n')
    throw new Error(`Simulation failed; nothing was sent: ${JSON.stringify(simulation.value.err)} — ${logs.slice(0, 500)}`)
  }
  const signature = await runtime.connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false })
  const result = await runtime.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  )
  if (result.value.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(result.value.err)}`)
  return signature
}

async function runWrite(runtime: Runtime, command: Exclude<GrantPotatoCommand, { command: 'status' }>): Promise<void> {
  const signer = readSignerKeypair()
  const config = await readGameConfig(runtime)
  if (config.paused) throw new Error('Game is paused on-chain; grants would fail — refusing before signing')
  if (!signer.publicKey.equals(config.rewardSigner) && !signer.publicKey.equals(config.authority)) {
    throw new Error(
      `Signer ${signer.publicKey.toBase58()} is neither reward_signer (${config.rewardSigner.toBase58()}) `
      + `nor authority (${config.authority.toBase58()}); no transaction was sent`,
    )
  }
  const { address: epochAddr, epoch } = await readEpoch(runtime, config.epochId)
  const now = await currentChainTime(runtime.connection)

  const wallet = command.wallet
  const ata = getAssociatedTokenAddressSync(config.potatoMint, wallet, false)
  const amountMicro = command.command === 'starter' ? starterAmountMicro() : command.amountMicro
  assertGrantWithinLimits(amountMicro, epoch)

  const ataState = await readPotatoAta(runtime, ata, config.potatoMint, wallet)
  if (command.command === 'starter') {
    const fieldCount = await countWalletFields(runtime, wallet)
    const eligibility = starterEligibility({ fieldCount, balanceMicro: ataState.amountMicro })
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason === 'has-field'
        ? `Wallet already owns ${fieldCount} field(s); starter is only for the first field — use grant for a deliberate top-up`
        : `Wallet already holds ${formatPotato(ataState.amountMicro)} POTATO — enough for the first field; refusing a second starter`)
    }
  }

  let nonce: bigint
  if (command.command === 'grant' && command.nonce !== undefined) {
    nonce = command.nonce
    const existing = await runtime.connection.getAccountInfo(rewardClaimPda(runtime.programId, ata, nonce), 'confirmed')
    if (existing) throw new Error(`Reward claim already exists for nonce ${nonce}; this grant was already issued (replay refused)`)
  } else {
    nonce = await findFreeNonce(
      defaultNonceStart(now),
      async (candidate) => (await runtime.connection.getAccountInfo(rewardClaimPda(runtime.programId, ata, candidate), 'confirmed')) !== null,
    )
  }
  const expiresAt = computeExpiresAt(now)
  const claimPda = rewardClaimPda(runtime.programId, ata, nonce)

  const grantInstruction = buildGrantPotatoInstruction({
    programId: runtime.programId,
    config: runtime.configAddress,
    epoch: epochAddr,
    authority: signer.publicKey,
    potatoMint: config.potatoMint,
    userPotato: ata,
    nonce,
    amountMicro,
    expiresAt,
  })

  console.log('Cluster:        devnet (test tokens, no monetary value)')
  console.log(`Recipient:      ${wallet.toBase58()}`)
  console.log(`Recipient ATA:  ${ata.toBase58()} (balance now: ${ataState.exists ? `${formatPotato(ataState.amountMicro)} POTATO` : 'will be created'})`)
  console.log(`Amount:         ${formatPotato(amountMicro)} POTATO${command.command === 'starter' ? ' (starter = first-field price)' : ''}`)
  console.log(`Nonce:          ${nonce} (claim PDA ${claimPda.toBase58()})`)
  console.log(`Expires at:     ${expiresAt} (chain time ${now})`)
  console.log(`Epoch quota left after grant: ${formatPotato(remainingGrantQuotaMicro(epoch) - amountMicro)} POTATO`)
  console.log(`Signer:         ${signer.publicKey.toBase58()}${signer.publicKey.equals(config.rewardSigner) ? ' (reward_signer)' : ' (authority)'}`)

  const phrase = command.command === 'starter'
    ? `GRANT STARTER TO ${wallet.toBase58()}`
    : `GRANT ${formatPotato(amountMicro)} POTATO TO ${wallet.toBase58()}`
  await confirmAction(phrase)

  const signature = await sendInstructions(runtime, signer, [
    createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, ata, wallet, config.potatoMint),
    grantInstruction,
  ])
  const after = await readPotatoAta(runtime, ata, config.potatoMint, wallet)
  console.log(`Granted ${formatPotato(amountMicro)} POTATO to ${wallet.toBase58()}.`)
  console.log(`Signature: ${signature}`)
  console.log(`Explorer:  https://explorer.solana.com/tx/${signature}?cluster=devnet`)
  console.log(`Recipient balance now: ${formatPotato(after.amountMicro)} POTATO`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') throw new UsageError(usage())
  let command: GrantPotatoCommand
  try {
    command = parseCommand(argv)
  } catch (error) {
    if (error instanceof RangeError) throw new UsageError(`${error.message}\n\n${usage()}`)
    throw error
  }
  const runtime = getRuntime()
  await verifyCluster(runtime)
  if (command.command === 'status') {
    await showStatus(runtime, command.wallet)
    return
  }
  await runWrite(runtime, command)
}

main().catch(error => {
  if (error instanceof UsageError) {
    console.error(error.message)
    process.exitCode = error.message.startsWith('Usage:') ? 0 : 2
    return
  }
  console.error(`Grant CLI stopped safely: ${safeError(error)}`)
  process.exitCode = 1
})
