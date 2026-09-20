// SKR market v2: quote atoms are 10^-6 SKR, never SOL lamports.
export const skrAtomsToTokens = (value: number | bigint): number => Number(value) / 1_000_000
export function skrToAtoms(value: number): bigint {
 const atoms = Math.round(value * 1_000_000)
 if (!/^\d+(?:\.\d{1,6})?$/.test(String(value)) || !Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(atoms) || atoms <= 0) throw new Error('Enter a positive SKR price within the supported range')
 return BigInt(atoms)
}
export function marketTotalSkrAtoms(amountMicro: bigint, priceAtoms: bigint): number {
 const total = amountMicro * priceAtoms / 1_000_000n
 if (amountMicro < 0n || priceAtoms < 0n || amountMicro > 0xffffffffffffffffn || priceAtoms > 0xffffffffffffffffn || total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Order amount exceeds the supported display range')
 return Number(total)
}
