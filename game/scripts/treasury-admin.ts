#!/usr/bin/env node
/**
 * Cold-key operator CLI for the program's existing two-step treasury withdrawal.
 * Run locally on the authority machine; never install the authority key on VPS.
 * This CLI does not deploy programs or enable deposits.
 *
 * From game/:
 *   SOLANA_CLUSTER=devnet RPC_URL=https://api.devnet.solana.com \
 *   PROGRAM_ID=DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf \
 *   ADMIN_KEYPAIR_PATH=~/.config/solana/id.json yarn treasury:admin status
 *   ... yarn treasury:admin propose sol 0.25
 *   ... yarn treasury:admin execute sol 0.25   # after the on-chain timelock
 *   ... yarn treasury:admin cancel             # cancels every pending asset
 *
 * This raw-keypair CLI is DEVNET-only. Mainnet writes remain disabled until a
 * reviewed Squads-compatible proposal/signing flow is implemented. Never use
 * this script with a hot/VPS key.
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
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { decodeGameConfig } from '../apps/backend/src/anchorRaw.js'
import { safeError } from '../apps/backend/src/security.js'
import { expectedGenesisHash } from '../apps/backend/src/cluster.js'
import type { SolanaCluster } from '../apps/backend/src/cluster.js'
import {
  buildCancelWithdrawalInstruction,
  buildProposeWithdrawalInstruction,
  buildWithdrawalExecutionInstruction,
  decodeAdminState,
  formatAssetAmount,
  parseAssetAmount,
  remainingWindowBudget,
  type DecodedAdminState,
  type TreasuryAsset,
} from './treasury-admin-core.js'

const DEFAULT_PROGRAM_ID = 'DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf'
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com'
const ASSETS: readonly TreasuryAsset[] = ['potato', 'sol', 'skr']

class UsageError extends Error {}

interface Runtime {
  readonly connection: Connection
  readonly programId: PublicKey
  readonly cluster: SolanaCluster
  readonly configAddress: PublicKey
  readonly adminStateAddress: PublicKey
}

function usage(): string {
  return [
    'Usage:',
    '  yarn treasury:admin status',
    '  yarn treasury:admin propose <potato|sol|skr> <amount>',
    '  yarn treasury:admin execute <potato|sol|skr> <amount>',
    '  yarn treasury:admin cancel',
    '',
    'Amounts are human units (POTATO/SKR: 6 decimals; SOL: 9 decimals).',
    'SOLANA_CLUSTER is required; optional RPC_URL/PROGRAM_ID override devnet defaults.',
    'Writes also require',
    'ADMIN_KEYPAIR_PATH pointing to a local authority keypair (chmod 600). No key is uploaded.',
  ].join('\n')
}

function parseCommand(argv: string[]): { command: string; asset?: TreasuryAsset; amount?: string } {
  const [command, assetText, amount, extra] = argv
  if (command === '--help' || command === '-h' || command === undefined) throw new UsageError(usage())
  if (extra !== undefined) throw new UsageError(usage())
  if (command === 'status' && assetText === undefined && amount === undefined) return { command }
  if (command === 'cancel' && assetText === undefined && amount === undefined) return { command }
  if ((command === 'propose' || command === 'execute') && assetText && amount !== undefined) {
    if (!(ASSETS as readonly string[]).includes(assetText)) throw new UsageError(`unknown asset: ${assetText}\n${usage()}`)
    return { command, asset: assetText as TreasuryAsset, amount }
  }
  throw new UsageError(usage())
}

function readCluster(): SolanaCluster {
  const cluster = process.env.SOLANA_CLUSTER
  if (cluster !== 'devnet' && cluster !== 'mainnet-beta') {
    throw new UsageError('SOLANA_CLUSTER must be explicitly set to devnet or mainnet-beta')
  }
  return cluster
}

function getRuntime(): Runtime {
  const cluster = readCluster()
  const rpcUrl = process.env.RPC_URL || DEFAULT_RPC_URL
  const programId = new PublicKey(process.env.PROGRAM_ID || DEFAULT_PROGRAM_ID)
  const [configAddress] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
  const [adminStateAddress] = PublicKey.findProgramAddressSync([Buffer.from('admin_state')], programId)
  return {
    connection: new Connection(rpcUrl, 'confirmed'),
    programId,
    cluster,
    configAddress,
    adminStateAddress,
  }
}

async function verifyCluster(runtime: Runtime): Promise<void> {
  const genesisHash = await runtime.connection.getGenesisHash()
  if (genesisHash !== expectedGenesisHash(runtime.cluster)) {
    throw new Error(`RPC cluster mismatch: expected ${runtime.cluster}; refusing to continue`)
  }
}

function readAuthorityKeypair(): Keypair {
  const configuredPath = process.env.ADMIN_KEYPAIR_PATH || process.env.ANCHOR_WALLET
  if (!configuredPath) throw new UsageError('ADMIN_KEYPAIR_PATH must point to the local cold-authority keypair')
  const expandedPath = configuredPath.startsWith('~/')
    ? path.join(os.homedir(), configuredPath.slice(2))
    : configuredPath
  const fileStat = fs.statSync(expandedPath)
  if (process.platform !== 'win32' && (fileStat.mode & 0o077) !== 0) {
    throw new UsageError('authority keypair file must not be readable by group/other; set mode 0600 and retry')
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(expandedPath, 'utf8'))
  if (!Array.isArray(parsed) || parsed.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new UsageError('authority keypair file must contain a JSON byte array')
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]))
}

async function readGameConfig(runtime: Runtime) {
  const account = await runtime.connection.getAccountInfo(runtime.configAddress, 'confirmed')
  if (!account) throw new Error('GameConfig is missing at the configured program; refusing to continue')
  if (!account.owner.equals(runtime.programId)) throw new Error('GameConfig is not owned by the configured program')
  return decodeGameConfig(account.data)
}

async function readAdminState(runtime: Runtime): Promise<DecodedAdminState | null> {
  const account = await runtime.connection.getAccountInfo(runtime.adminStateAddress, 'confirmed')
  if (!account) return null
  if (!account.owner.equals(runtime.programId)) throw new Error('AdminState is not owned by the configured program')
  return decodeAdminState(account.data)
}

function showPending(asset: TreasuryAsset, pending: { amount: bigint; proposedAt: bigint }, now: bigint): string {
  if (pending.amount === 0n) return 'none'
  const readyAt = pending.proposedAt + 30n
  const status = now >= readyAt ? 'ready' : `timelock: ${readyAt - now}s remaining`
  return `${formatAssetAmount(asset, pending.amount)} (proposed ${pending.proposedAt}, ${status})`
}

async function currentChainTime(connection: Connection): Promise<bigint> {
  const slot = await connection.getSlot('confirmed')
  const blockTime = await connection.getBlockTime(slot)
  if (blockTime === null) throw new Error('RPC did not return a confirmed block time; refusing time-sensitive action')
  return BigInt(blockTime)
}

async function showStatus(runtime: Runtime): Promise<void> {
  const [config, state, slot] = await Promise.all([
    readGameConfig(runtime),
    readAdminState(runtime),
    runtime.connection.getSlot('confirmed'),
  ])
  const blockTime = await runtime.connection.getBlockTime(slot)
  if (blockTime === null) throw new Error('RPC did not return a confirmed block time')
  const now = BigInt(blockTime)
  console.log(`Cluster:       ${runtime.cluster}`)
  console.log(`Program:       ${runtime.programId.toBase58()}`)
  console.log(`Authority:     ${config.authority.toBase58()}`)
  console.log(`POTATO mint:   ${config.potatoMint.toBase58()}`)
  console.log(`SKR mint:      ${config.skrMint.toBase58()}`)
  console.log(`AdminState:    ${runtime.adminStateAddress.toBase58()}`)
  if (!state) {
    console.log('Withdrawal state is not initialized; no proposal or rolling-window spend is recorded.')
    return
  }
  const windowAge = now - state.windowStart
  console.log(`Window start:  ${state.windowStart === 0n ? 'not initialized' : state.windowStart.toString()}`)
  for (const asset of ASSETS) {
    const label = asset.toUpperCase()
    const used = windowAge >= 86_400n ? 0n : state.withdrawn[asset]
    console.log(`\n${label}`)
    console.log(`  used this 24h window: ${formatAssetAmount(asset, used)}`)
    console.log(`  remaining allowance:  ${formatAssetAmount(asset, remainingWindowBudget(state, asset, now))}`)
    console.log(`  pending:               ${showPending(asset, state.pending[asset], now)}`)
  }
}

async function confirmAction(phrase: string, cluster: SolanaCluster): Promise<void> {
  if (cluster !== 'devnet') {
    throw new Error('Direct-key treasury writes are devnet-only; mainnet requires the reviewed Squads-compatible flow')
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Treasury writes require an interactive terminal; non-interactive execution is denied')
  }
  const readLine = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await readLine.question(`Type exactly "${phrase}" to continue: `)
    if (answer.trim() !== phrase) throw new Error('Confirmation did not match; no transaction was sent')
  } finally {
    readLine.close()
  }
}

async function sendInstruction(runtime: Runtime, authority: Keypair, instructions: TransactionInstruction[]): Promise<string> {
  const transaction = new Transaction()
  for (const instruction of instructions) transaction.add(instruction)
  return sendAndConfirmTransaction(runtime.connection, transaction, [authority], { commitment: 'confirmed' })
}

async function ensureAuthority(runtime: Runtime, authority: Keypair): Promise<Awaited<ReturnType<typeof readGameConfig>>> {
  const config = await readGameConfig(runtime)
  if (!config.authority.equals(authority.publicKey)) {
    throw new Error(`Signer ${authority.publicKey.toBase58()} is not the configured game authority; no transaction was sent`)
  }
  return config
}

async function runWrite(runtime: Runtime, command: ReturnType<typeof parseCommand>): Promise<void> {
  const authority = readAuthorityKeypair()
  const config = await ensureAuthority(runtime, authority)
  const now = await currentChainTime(runtime.connection)
  const state = await readAdminState(runtime)
  const base = {
    programId: runtime.programId,
    config: runtime.configAddress,
    adminState: runtime.adminStateAddress,
    authority: authority.publicKey,
  }

  if (command.command === 'cancel') {
    const phrase = 'CANCEL ALL WITHDRAWALS'
    console.log(`Cancels every pending withdrawal. Already consumed 24h allowance is not refunded.`)
    await confirmAction(phrase, runtime.cluster)
    const signature = await sendInstruction(runtime, authority, [buildCancelWithdrawalInstruction(base)])
    console.log(`All pending withdrawal proposals cancelled. Signature: ${signature}`)
    return
  }

  const asset = command.asset
  if (!asset || command.amount === undefined) throw new UsageError(usage())
  const amount = parseAssetAmount(asset, command.amount)
  const stateNow = state ?? {
    windowStart: 0n,
    withdrawn: { potato: 0n, sol: 0n, skr: 0n },
    pending: {
      potato: { amount: 0n, proposedAt: 0n },
      sol: { amount: 0n, proposedAt: 0n },
      skr: { amount: 0n, proposedAt: 0n },
    },
  }

  if (command.command === 'propose') {
    if (stateNow.pending[asset].amount > 0n) throw new Error(`A ${asset.toUpperCase()} withdrawal is already pending`)
    const remaining = remainingWindowBudget(stateNow, asset, now)
    if (amount > remaining) {
      throw new Error(`Amount exceeds remaining ${asset.toUpperCase()} rolling-24h allowance (${formatAssetAmount(asset, remaining)})`)
    }
    console.log(`Propose ${formatAssetAmount(asset, amount)} ${asset.toUpperCase()} to the authority's own destination.`)
    console.log('The rolling 24h allowance is consumed now. Cancellation does not refund it.')
    const phrase = `PROPOSE ${asset.toUpperCase()} ${formatAssetAmount(asset, amount)}`
    await confirmAction(phrase, runtime.cluster)
    const instruction = buildProposeWithdrawalInstruction({ ...base, asset, amount })
    const signature = await sendInstruction(runtime, authority, [instruction])
    console.log(`Withdrawal proposal submitted. Wait at least 30 seconds before a separate execute command. Signature: ${signature}`)
    return
  }

  if (command.command === 'execute') {
    const pending = stateNow.pending[asset]
    if (pending.amount === 0n) throw new Error(`No pending ${asset.toUpperCase()} withdrawal`)
    if (pending.amount !== amount) {
      throw new Error(`Amount must exactly match the pending proposal (${formatAssetAmount(asset, pending.amount)} ${asset.toUpperCase()})`)
    }
    if (now < pending.proposedAt + 30n) {
      throw new Error(`On-chain timelock has not elapsed; wait ${pending.proposedAt + 30n - now} more seconds`)
    }
    const treasurySol = PublicKey.findProgramAddressSync([Buffer.from('treasury_sol')], runtime.programId)[0]
    const instruction = buildWithdrawalExecutionInstruction({
      ...base,
      treasurySol,
      asset,
      amount,
      potatoMint: config.potatoMint,
      skrMint: config.skrMint,
    })
    const preInstructions = []
    if (asset === 'potato') {
      const destination = getAssociatedTokenAddressSync(config.potatoMint, authority.publicKey, true)
      const existing = await runtime.connection.getAccountInfo(destination, 'confirmed')
      if (existing) {
        const parsed = await getAccount(runtime.connection, destination, 'confirmed')
        if (!parsed.mint.equals(config.potatoMint) || !parsed.owner.equals(authority.publicKey)) {
          throw new Error('Authority POTATO ATA has unexpected mint/owner; refusing to proceed')
        }
      } else {
        preInstructions.push(createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          destination,
          authority.publicKey,
          config.potatoMint,
        ))
      }
    }
    console.log(`Execute ${formatAssetAmount(asset, amount)} ${asset.toUpperCase()} to the authority's own account.`)
    const phrase = `EXECUTE ${asset.toUpperCase()} ${formatAssetAmount(asset, amount)}`
    await confirmAction(phrase, runtime.cluster)
    const signature = await sendInstruction(runtime, authority, [...preInstructions, instruction])
    console.log(`Treasury withdrawal executed. Signature: ${signature}`)
    return
  }

  throw new UsageError(usage())
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2))
  const runtime = getRuntime()
  await verifyCluster(runtime)
  if (command.command === 'status') {
    await showStatus(runtime)
    return
  }
  if (runtime.cluster !== 'devnet') {
    throw new Error('Direct-key treasury writes are devnet-only; mainnet requires the reviewed Squads-compatible flow')
  }
  await runWrite(runtime, command)
}

main().catch(error => {
  if (error instanceof UsageError) {
    console.error(error.message)
    process.exitCode = error.message.startsWith('Usage:') ? 0 : 2
    return
  }
  console.error(`Treasury CLI stopped safely: ${safeError(error)}`)
  process.exitCode = 1
})
