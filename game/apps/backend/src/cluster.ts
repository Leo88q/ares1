export type SolanaCluster = 'devnet' | 'mainnet-beta';

export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export function expectedGenesisHash(cluster: SolanaCluster): string {
  return cluster === 'mainnet-beta' ? MAINNET_GENESIS_HASH : DEVNET_GENESIS_HASH;
}
