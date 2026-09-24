import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { SKR_MINT } from '../../apps/web/src/utils/anchorClient'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

async function main() {
  // F-19: key material always comes from a file path (env ANCHOR_WALLET or
  // the operator solana CLI id.json) — never from literals in the repository.
  const walletPath = process.env.ANCHOR_WALLET ?? join(homedir(), '.config', 'solana', 'id.json')
  const cli = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(walletPath, 'utf8'))))
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
  const ata = getAssociatedTokenAddressSync(SKR_MINT, cli.publicKey)
  console.log('CLI pubkey:', cli.publicKey.toBase58())
  console.log('CLI SKR ATA:', ata.toBase58())
  try {
    const b = await conn.getTokenAccountBalance(ata)
    console.log('CLI SKR balance:', b.value.uiAmount)
  } catch (e: any) {
    console.log('⚠️ CLI ATA не существует или пуст:', e.message)
  }
}
main()
