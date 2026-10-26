import { PublicKey } from '@solana/web3.js'

/** Read-only helpers for public devnet telemetry. No transaction builders live on the landing page. */
export function pdas(programId: PublicKey) {
  const config = () => PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0]
  return { config }
}

export function treasurySolPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('treasury_sol')], programId)[0]
}

export interface DecodedConfig {
  fieldCount: bigint
  totalBurnedMicro: bigint
  paused: boolean
}

/** Decode only the fields needed for read-only landing telemetry. */
export function decodeConfig(data: Buffer): DecodedConfig {
  if (![156, 164, 228, 260].includes(data.length)) throw new Error('Unsupported GameConfig layout')
  let offset = 8 + 32 * 3
  // Newer layouts add the SKR mint and reward signer after the original keys.
  if (data.length >= 228) offset += 32 * 2

  offset += 8 * 3 + 2
  const fieldCount = data.readBigUInt64LE(offset)
  offset += 8 + 8
  const totalBurnedMicro = data.readBigUInt64LE(offset)
  offset += 8
  if (data.length !== 156) offset += 8 // last_total_burned_micro
  const paused = data.readUInt8(offset) !== 0
  return { fieldCount, totalBurnedMicro, paused }
}
