# ARES-1 API — source reference, 21 September 2026

**Not a statement about the deployed binary.** Anchor CLI/crates 0.31.2; source:
`programs/solana_potato/src/lib.rs`. Committed `apps/web/src/idl.json` is currently
stale (8 instructions missing). Regenerate/compare with `yarn check:contract target/idl/solana_potato.json` after `anchor build`; do not deploy based on this document alone.
Program ID in source: `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf`.

## Confirmed payment rules

Owner clarification: **SKR presale = 1053 SKR; export license = 500 SKR**.
Ordinary field purchases, tax, repairs, upgrades, fertilizer and referral registration
retain their original **POTATO** payments/burns. The attempted generalized SKR
service-pricing rewrite has been withdrawn; it is not the approved game economy.
Marketplace settlement below describes the restored code, not approval of a new
market currency. Any market-only conversion requires separate confirmation.

## Units and accounts

POTATO amounts `*_micro` use 6 decimals. SOL amounts are lamports (1 SOL = 1e9).
`fill_order` settles in **native SOL via System Program**, not SKR. The separate SKR
presale/export-license rail uses 6-decimal token atoms. Resolve its mint from
`GameConfig.skr_mint`, not a hardcoded mainnet assumption.

Sizes include the 8-byte Anchor discriminator:

| Account | Seeds | Current bytes |
|---|---|---:|
| GameConfig | `config` | 228 |
| Epoch | `epoch`, epoch ID u64 LE | 49 |
| Field | `field`, field ID u64 LE | 70 |
| MarketOrder | `order`, order ID u64 LE | 83 |
| MarketStats | `market_stats` | 49 |
| SellerProfile | `seller`, seller pubkey | 49 |
| PresaleState | `presale` | 57 |
| BuyerPresaleCounter | `buyer_presale`, buyer pubkey | 42 |
| Achievements | `achv`, user pubkey | 17 |

Config legacy layouts 156/164 and epoch legacy layout 41 are recognized by raw
clients for reads. That does **not** certify on-chain migration safety. Field migration
and legacy config migration have separate fixture tests; see [MIGRATIONS.md](MIGRATIONS.md)
and the stabilization report for execution status.
Account order, writable/signer flags and discriminators are an ABI. Raw instruction
builders in web/backend must match the generated IDL, not just its address.

## Operational / privileged instructions

| Instruction | Permission and behavior |
|---|---|
| `initialize` | First caller initializes singleton with correctly configured POTATO mint; establishes authority/reward signer |
| `init_epoch` | Authority; bootstrap cap from `config.daily_mint_cap_micro` |
| `roll_epoch` | Any funded payer after 24h; independent dynamic cap clamped to 250k–750k |
| `grant_reward` | Authority OR reward signer; >0 and ≤1000 POTATO/call, within current epoch cap and max supply; blocked while paused |
| `update_reward_signer` | Authority; replace delegated reward signer (authority retains reward permission) |
| `update_skr_mint` | Authority; change configured SKR mint |
| `update_config` | Authority; configured cap ≤250k, multiplier ≤2×; see cap warning below |
| `set_paused` | Authority; does not freeze all instructions or treasury |
| `propose_authority`, `accept_authority` | Two-step game authority transfer, NOT program upgrade authority transfer |
| `withdraw_treasury` | Authority; POTATO treasury ATA → destination token account of same mint |
| `withdraw_treasury_sol` | Authority; SOL vault PDA → authority |
| `withdraw_skr_treasury` | Authority; configured SKR vault ATA → authority's SKR ATA |
| `migrate_config`, `migrate_epoch`, `migrate_field` | Authority; exact legacy/current layouts, discriminator/owner/PDA checks; rent shortfall paid to target; current data preserved on retry |
| `migrate_presale_authority` | New game authority synchronizes presale authority after transfer |

**Cap warning:** changing `daily_mint_cap_micro` does not currently constrain the
next `roll_epoch`. The latter computes its own cap from burn/utilization. Do not
advertise this setting as an emergency mint limit. Economics were not changed in
the stabilization patch. Reward minting shares the harvest budget; there is no
separate daily reward budget, timelock or governance-enforced withdrawal delay.

## Player instructions

- `create_field`: field type 0/1/2; burns 100/250/500 POTATO.
- `harvest`: owned active field, ≥60s interval, ≤48h accrual, epoch/supply limits.
- `batch_harvest`: 1–10 unique writable owned Field accounts in remaining accounts;
  aggregate mint limits; updates field timestamps/durability. Needs integration validation.
- `close_field`: owner closes field account and receives rent, including while paused.
  Historical field counters are not decremented; closing does not guarantee an ID
  can never be reused.
- `repair_field`, `upgrade_field`, `pay_tax`, `apply_fertilizer`: burn-based upkeep;
  level/type scaling, tax prepay ≤28 days, fertilizer ≤7 days.
- `create_sell_order`, `fill_order`, `cancel_order`, `close_expired_order`: current
  market settles in native SOL; minimum order 10 POTATO and total 0.001 SOL. Fees depend on tier
  and referral; 60% of fee burn / 40% treasury before referral adjustments.
- `register_referrer`: one-time link, burn 50 POTATO, self-referral rejected.
- `claim_achievement`: on-chain proofs and bitmap, quest IDs 0–5; transfers existing
  tokens from quest treasury (does not mint new rewards). Duplicate field proofs rejected.
- `init_presale`, `update_presale_price` (authority); `buy_field_sol`, `buy_field_skr`
  (buyer): global cap and 5-field wallet cap.
- `buy_export_license`: configured SKR payment; inspect source/current config for terms.

## Experimental, not release-ready

`init_compression_tree`, `mint_compressed_field`, `mint_core_field`,
`execute_transfer_hook` are placeholder/custom-account implementations. They do
**not** implement the advertised Bubblegum/Light/Core CPI behavior or Token-2022
burn. The unused incompatible SDK dependencies/`full` feature were removed; turning
on a feature cannot make these instructions production-ready. No beta/mainnet funds
should depend on these paths. They remain in source/ABI pending a separate scope decision.

## Events and errors

Use events from the **generated, verified** IDL. At minimum, monitoring/indexing
should cover `FieldCreated`, `Harvested`, `BatchHarvested`, `FieldClosed`,
`OrderCreated`, `OrderFilled`, `PresalePurchase`, `AchievementClaimed`, `RewardGranted`,
`TreasuryWithdrawn`, `TreasurySolWithdrawn`, `TreasurySkrWithdrawn`, `EpochRolled`,
`PausedToggled`, `ConfigUpdated`, `AuthorityProposed`, `AuthorityAccepted`,
`SkrMintUpdated`, `RewardSignerUpdated`.

Error codes start with `AlreadyClaimed=6000`, `BadProof=6001`, `Paused=6002` in the
current enum/committed IDL. Old comments claiming `Paused=6000` are not the ABI.
Frontend translations now look up error **names** from IDL instead of assuming old
numeric offsets. Do not reorder enum variants on upgrade.

## Backend HTTP API

Express, no admin HTTP endpoint and no admin token. Only on-chain write is the
permissionless epoch roller, signed by a dedicated payer. HTTP responses are JSON.

| Method / path | Success | Failure |
|---|---|---|
| `GET /live` | `{live:true}` | Process/network unavailable |
| `GET /ready` | `{ready:true}` after reading config | 503 `{ready:false}` |
| `GET /health` | `{ok,slot,epochId,paused,payer,payerSol,uptime}` | 503 with generic dependency error |
| `GET /api/config` | Config + current epoch snapshot; u64 amounts as decimal strings | 503 with generic error |

`/api/config` returns authority, potatoMint, maxSupplyMicro, dailyMintCapMicro,
baseYieldMicroPerDay, globalMultiplierBps, fieldCount, epochId, totalBurnedMicro,
paused and epoch `{mintCapMicro,mintedMicro,startTime}`. `dailyMintCapMicro` and
`epoch.mintCapMicro` have different semantics (see warning).

Except `/live`, requests share `RATE_LIMIT_PER_MINUTE` (default 30/IP). Behind a
proxy, validate the existing one-hop `trust proxy` assumption. Production RPC URLs
must not be returned or printed; operational errors are redacted.

Required backend env: `RPC_URL`, `PROGRAM_ID`, `PAYER_KEYPAIR_JSON` (path).
`CORS_ORIGIN` is required in production; set explicit origins, never `*`.
Optional: `PORT=8080`, `EPOCH_ROLL_CRON=*/10 * * * *`, `RATE_LIMIT_PER_MINUTE=30`.
See [OPERATIONS.md](OPERATIONS.md) for deployment, key inventory and incident response.
Watchtower endpoints and persistent analytics are **not implemented** in this package.
