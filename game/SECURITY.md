# Security Notes — Sep 2026

## Audited
- All instructions require proper Signer<'info>
- CEI-pattern in fill_order (state update before SOL transfer)
- PDA seeds tied to owner/buyer keys
- Integer overflow protected (28 checked_add/saturating_add)
- No unchecked system_instruction::transfer calls

## Known transitive CVEs (Solana SDK, not on-chain code)
- RUSTSEC-2024-0344: curve25519-dalek timing variability
- RUSTSEC-2022-0093: ed25519-dalek oracle attack
Source: anchor-lang 0.30.1 → solana-program 1.18.26
Mitigation: upgrade to anchor 0.31+ before mainnet
