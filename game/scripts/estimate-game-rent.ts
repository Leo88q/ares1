import { Connection } from '@solana/web3.js';
import { expectedGenesisHash, type SolanaCluster } from '../apps/backend/src/cluster.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
const FIELD_ACCOUNT_BYTES = 70; // 8-byte Anchor discriminator + Field::INIT_SPACE (62)
const SPL_TOKEN_ACCOUNT_BYTES = 165;

function positiveInteger(value: string | undefined, name: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

async function main(): Promise<void> {
  const cluster = (process.env.SOLANA_CLUSTER ?? 'devnet') as SolanaCluster;
  if (cluster !== 'devnet' && cluster !== 'mainnet-beta') {
    throw new Error('SOLANA_CLUSTER must be devnet or mainnet-beta');
  }
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl || !/^https:\/\//i.test(rpcUrl)) {
    throw new Error('Set SOLANA_RPC_URL to a trusted HTTPS RPC endpoint; no transaction is sent');
  }
  const colonyBytes = positiveInteger(process.env.COLONY_ACCOUNT_BYTES, 'COLONY_ACCOUNT_BYTES', 512);
  const newBuildingCount = Number(process.env.NEW_BUILDING_PDA_COUNT ?? '0');
  if (!Number.isSafeInteger(newBuildingCount) || newBuildingCount < 0) {
    throw new Error('NEW_BUILDING_PDA_COUNT must be a non-negative integer');
  }
  const buildingBytes = newBuildingCount > 0
    ? positiveInteger(process.env.BUILDING_ACCOUNT_BYTES, 'BUILDING_ACCOUNT_BYTES')
    : 0;
  const missingBuyerAta = process.env.BUYER_SKR_ATA_MISSING === 'true';

  const connection = new Connection(rpcUrl, 'confirmed');
  const genesis = await connection.getGenesisHash();
  const expected = expectedGenesisHash(cluster);
  if (genesis !== expected) {
    throw new Error(`RPC cluster mismatch: expected ${cluster} genesis ${expected}, received ${genesis}`);
  }

  const accounts = [
    { label: 'Existing Field account created by Starter', bytes: FIELD_ACCOUNT_BYTES, count: 1 },
    { label: 'Proposed compact Colony account (draft size; includes discriminator)', bytes: colonyBytes, count: 1 },
    ...(missingBuyerAta ? [{ label: 'Buyer SKR ATA if absent (not needed if already created)', bytes: SPL_TOKEN_ACCOUNT_BYTES, count: 1 }] : []),
    ...(newBuildingCount > 0 ? [{ label: 'Separate Building PDAs (alternative design; avoid if packed into Colony)', bytes: buildingBytes, count: newBuildingCount }] : []),
  ];

  let total = 0;
  console.log(`Read-only rent estimate · ${cluster} · genesis verified · confirmed RPC`);
  console.log('No wallet, signer, or transaction is used. Values are queried live and are not cached.');
  for (const item of accounts) {
    const perAccount = await connection.getMinimumBalanceForRentExemption(item.bytes, 'confirmed');
    const subtotal = perAccount * item.count;
    total += subtotal;
    console.log(`${item.label}: ${item.count} × ${item.bytes} bytes → ${(subtotal / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
  }
  console.log(`Estimated rent-exempt deposits: ${(total / LAMPORTS_PER_SOL).toFixed(9)} SOL (${total.toLocaleString()} lamports)`);
  console.log('Not included: transaction fees, priority fees, program deployment/upgrade, dApp Store publishing or future reallocations.');
  console.log('The Colony byte size is a planning input until the account layout is implemented and measured from the built IDL/program.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Rent estimate failed');
  process.exitCode = 1;
});
