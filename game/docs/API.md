# ARES-1 API — source reference, 21 September 2026 (post-audit remediation)

**Not a statement about the deployed binary.** Anchor CLI/crates 0.31.2; source:
`programs/solana_potato/src/lib.rs`. Committed `apps/web/src/idl.json` describes
the remediated source (**39 instructions, 12 accounts, 30 events, 41 errors**);
it was rebuilt together with the 2026-09-21 security fixes and must be
re-verified against a real pinned-Anchor build before deploy: run `anchor build`,
then `yarn check:contract target/idl/solana_potato.json` and copy the built IDL
over `apps/web/src/idl.json`. Do not deploy based on this document alone.
Program ID in source: `DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf`.

Removed from the ABI on 2026-09-21 (were placeholder stubs, never performed the
advertised Bubblegum/Core/Token-2022 CPI): `init_compression_tree`,
`mint_compressed_field`, `mint_core_field`, `execute_transfer_hook` plus their
accounts (`CompressionTree`, `CoreCollection`, `CoreAsset`) and events. Historical
devnet logs containing their events decode as `Unknown` in the watchtower.

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
| AdminState | `admin_state` | 97 |
| ExportLicense | `license`, holder pubkey | — |
| Referral | `referral`, buyer pubkey | — |

`Epoch` byte 41..49 was `burned_micro` (never incremented) and is now
`granted_micro` — the per-epoch manual-grant quota counter. Layout size is
unchanged (49 bytes), so no rent migration is needed; legacy accounts simply
reinterpret the field (they hold 0).

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
| `roll_epoch` | Any funded payer after 24h; dynamic cap = mean(burn axis, utilization axis) clamped to `[daily_mint_cap_micro, 3×daily_mint_cap_micro]` |
| `close_old_epoch` | Permissionless rent-reclaim crank; closes epoch PDAs older than `current − KEEP_EPOCHS` (2). Historical emission stats remain in events and config counters |
| `grant_reward` | Authority OR reward signer; >0 and ≤1000 POTATO/call, within current epoch cap and max supply, and within the **manual grant quota** (`GRANT_QUOTA_SHARE_BPS` = 10 % of the epoch cap, tracked in `Epoch.granted_micro`); blocked while paused |
| `update_reward_signer` | Authority; replace delegated reward signer (authority retains reward permission) |
| `update_skr_mint` | Authority; **proposal only** — stores pending mint in `AdminState` |
| `apply_pending_skr_mint` | Authority; applies the proposal after the 24 h timelock (`TimelockNotExpired` otherwise) |
| `update_presale_price` | Authority; `price = 0` is the **kill switch** and applies immediately (closes both presale rails); `price > 0` is a proposal only |
| `apply_pending_presale_price` | Authority; applies a pending price proposal after the 24 h timelock |
| `update_config` | Authority; cap in `(0, 250k]`, multiplier ≤2×, `base_yield_micro_per_day` in `(0, 100 🥔/day]` (`BaseYieldTooHigh`) |
| `set_paused` | Authority; does not freeze all instructions or treasury |
| `propose_authority`, `accept_authority` | Two-step game authority transfer, NOT program upgrade authority transfer |
| `withdraw_treasury` | Authority; POTATO treasury ATA → destination token account of same mint; ≤ **250 000 🥔 per rolling 24 h** (`AdminState`) |
| `withdraw_treasury_sol` | Authority; SOL vault PDA → authority; ≤ **25 SOL per rolling 24 h** |
| `withdraw_skr_treasury` | Authority; configured SKR vault ATA → authority's SKR ATA; ≤ **100 000 SKR per rolling 24 h** |
| `migrate_config`, `migrate_epoch`, `migrate_field` | Authority; exact legacy/current layouts, discriminator/owner/PDA checks; rent shortfall paid to target; current data preserved on retry |
| `migrate_presale_authority` | New game authority synchronizes presale authority after transfer |

The three `withdraw_*` instructions lazily create the `AdminState` PDA
(`init_if_needed`, payer = authority), so the first withdrawal also passes the
system program and authority rent. Withdrawal counters roll over once per 24 h
window (`WITHDRAW_WINDOW_SECONDS`); exceeding a limit fails with
`WithdrawWindowLimitExceeded` (6036).

**Cap semantics:** `daily_mint_cap_micro` is now respected by `roll_epoch` as the
floor of the dynamic clamp (upper bound = 3× the configured cap). Lowering it via
`update_config` tightens emission at the next roll. Manual grants additionally
consume only the 10 % quota, leaving ≥90 % of every epoch cap for gameplay
harvests.

## Player instructions

- `create_field`: field type 0/1/2; burns 100/250/500 POTATO.
- `harvest`: owned active field, ≥60s interval, ≤**7 days** accrual
  (`MAX_ACCRUAL_SECONDS`), epoch/supply limits; lunar multiplier is **time-weighted**
  across the accrual window (`lunar_weighted_bps`), so harvesting right before
  `roll_epoch` no longer arbitrages the lunar phase.
- `batch_harvest`: 1–10 unique writable owned Field accounts in remaining accounts;
  aggregate mint limits; updates field timestamps/durability. Covered by localnet CI.
- `close_field`: owner closes field account and receives rent, including while paused.
  Now **decrements `GameConfig.field_count`**, keeping global stats truthful.
  Closing still does not guarantee a field ID can never be reused.
- `repair_field`, `upgrade_field`, `pay_tax`, `apply_fertilizer`: burn-based upkeep;
  level/type scaling, tax prepay ≤28 days, fertilizer ≤7 days.
- `upgrade_field`: the 5 % mutation roll mixes in the latest `SlotHashes` entry —
  the hash of the inclusion slot is unknown when the player signs, so slot
  grinding for a guaranteed Golden/Silicon mutation does not work. Requires the
  `slotHashes` sysvar account.
- `create_sell_order`, `fill_order`, `cancel_order`, `close_expired_order`: current
  market settles in native SOL; minimum order 10 POTATO and total 0.001 SOL. Fees depend on tier
  and referral; 60% of fee burn / 40% treasury before referral adjustments.
  `fill_order` validates license/referral remaining accounts by **owner = program**
  and fully deserializes the referrer ATA (`spl TokenAccount`), rejecting forged
  discount/referral accounts.
- `register_referrer`: one-time link, burn 5 POTATO (owner-confirmed registration price), self-referral rejected.
- `claim_achievement`: on-chain proofs and bitmap, quest IDs 0–5; transfers existing
  tokens from quest treasury (does not mint new rewards). Duplicate field proofs
  rejected; proof count per call capped at `MAX_CLAIM_PROOFS` = 12 to keep the
  O(n²) duplicate check inside CU limits.
- `init_presale` (authority): cap + SOL price arguments; SKR price is the program
  constant 1053 SKR.
- `buy_field_sol` (buyer): args `(field_id, field_type, max_total_lamports)`.
  SOL price scales with field type like the POTATO prices (0.4× / 1× / 2× of
  `price_lamports`); `max_total_lamports` is a slippage guard — the tx reverts
  with `InvalidPrice` if the price was raised after signing. Rarity roll mixes in
  `SlotHashes` (needs the `slotHashes` sysvar account).
- `buy_field_skr` (buyer): 1053 SKR split 80 % treasury / 20 % buyback; global cap
  and 5-field wallet cap; same `SlotHashes` rarity entropy (needs `slotHashes`).
- `buy_export_license`: configured SKR payment; inspect source/current config for terms.

Both presale rails check `price_lamports > 0` (`PresaleNotActive`), which is how
the kill switch stops purchases; `buy_field_skr` checks its cap before the wallet
limit, `buy_field_sol` checks `PresaleNotActive` before the cap.

## Events and errors

Use events from the **generated, verified** IDL. At minimum, monitoring/indexing
should cover `FieldCreated`, `Harvested`, `BatchHarvested`, `FieldClosed`,
`OrderCreated`, `OrderFilled`, `PresalePurchase`, `AchievementClaimed`, `RewardGranted`,
`TreasuryWithdrawn`, `TreasurySolWithdrawn`, `TreasurySkrWithdrawn`, `EpochRolled`,
`PausedToggled`, `ConfigUpdated`, `AuthorityProposed`, `AuthorityAccepted`,
`SkrMintUpdated`, `RewardSignerUpdated`. (`close_old_epoch` emits no event, only
a program log; watch the transaction log if you need crank activity.)

Error codes start with `AlreadyClaimed=6000`, `BadProof=6001`, `Paused=6002`.
New codes from the 2026-09-21 remediation: `GrantQuotaExceeded=6035`,
`WithdrawWindowLimitExceeded=6036`, `BaseYieldTooHigh=6037`,
`TimelockNotExpired=6038`, `NothingPending=6039`, `EpochTooRecent=6040`.
Frontend translations look up error **names** from the IDL instead of assuming
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
paused and epoch `{mintCapMicro,mintedMicro,startTime}`. `dailyMintCapMicro` is
the configured clamp floor; `epoch.mintCapMicro` is the dynamic cap of the
current epoch (see cap semantics above).

Except `/live`, requests share `RATE_LIMIT_PER_MINUTE` (default 30/IP).
`trust proxy` is env-driven via `TRUST_PROXY` (default `1` hop; set `false` when
the API is exposed without a reverse proxy, or the limiter can be bypassed with a
spoofed `X-Forwarded-For`). Production RPC URLs must not be returned or printed;
operational errors are redacted.

Required backend env: `RPC_URL`, `PROGRAM_ID`, `PAYER_KEYPAIR_JSON` (path).
`CORS_ORIGIN` is required in production; set explicit origins, never `*`.
Optional: `PORT=8080`, `EPOCH_ROLL_CRON=*/10 * * * *`, `RATE_LIMIT_PER_MINUTE=30`,
`TRUST_PROXY=1`.
See [OPERATIONS.md](OPERATIONS.md) for deployment, key inventory and incident response.
Watchtower endpoints and persistent analytics are **not implemented** in this package.
