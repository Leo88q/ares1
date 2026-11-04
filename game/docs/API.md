# ARES-1 API — source reference, 21 September 2026 (post-audit remediation)

**Not a statement about the deployed binary.** The checked-in IDL describes the
remediated source; deploying it is a separate, reviewed step (see the launch gate).
The V2 market is the default screen — `/market` renders it — and the legacy V1 rail
is **closed for new listings** in the program (P2-2: `create_sell_order` always
answers `LegacyMarketClosed`, 6058). The V1 book stays reachable in its own tab so
open legacy escrow can still be filled, canceled or closed. Anchor CLI/crates
0.31.2; source:
`programs/solana_potato/src/lib.rs`. Committed `apps/web/src/idl.json` describes
the remediated source (**48 instructions, 16 accounts, 35 events, 59 errors** —
counts re-checked against the committed IDL on 2026-11-04; `yarn check:contract`
fails if this file is regenerated without updating the client ABI);
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
The current source still has the restored V1 SOL-only market described below. On
11 October 2026 the owner separately approved a V2 POTATO/SKR market and a seller-paid
5–8% settlement fee in the quote asset, retained from successful fills and routed
to the treasury in that same asset. The V2 fee is intended to use cumulative UTC-day
POTATO volume per seller address across both quote pairs; it is not part of this ABI.
The V2 handlers are in the committed IDL (`create_sell_order_v2`, `fill_order_v2`,
`fill_order_v2_skr`, `cancel_order_v2`, `close_expired_order_v2`) and are the only
place where a new order can be created: `/market` renders V2 by default
(`VITE_MARKET_V2_ENABLED=true` in `.env.example`), and the legacy screen keeps only
the settle/cancel path. The V2 marginal tiers are 5/6/7/8 % at 1k/10k/100k POTATO
of a seller's rolling UTC-day volume.

**Legacy fee base closed instead of documented away (P2-2).** Both rails charge the
same ladder (500/600/700/800 bps at 1k/10k/100k POTATO), but they select the tier from
different numbers: the legacy pair priced the **order size**
(`calculate_fee_bps(amount_micro)`), while V2 prices the **seller's cumulative UTC-day
volume** and cuts the rate at the tier boundaries inside a single fill
(`calculate_settlement_fee_v2`). The table in `docs/ECONOMY.md` §5 shows that leaving
both rails open was not neutral: splitting into <1k POTATO orders paid 5 % where V2
would charge 8 %, while one 150k POTATO order overpaid 8 % against V2's marginal
7.26 %. Therefore `LEGACY_MARKET_WRITES_ENABLED = false`: every new listing is rejected
with `LegacyMarketClosed` (6058) while `fill_order` / `cancel_order` /
`close_expired_order` stay ungated, so pre-existing escrow is never stuck and the book
drains within `ORDER_TTL` (7 days). The divergence itself remains pinned by
`legacy_and_v2_fee_bases_differ_by_design` and
`fee_base_divergence_examples_match_documented_table` — do not describe the rails as
"the same fee" in UI copy or docs.

## Draft V2 market (not deploy-verified)

- Versioned handlers use separate `MarketOrderV2`, `SellerVolumeV2`, `MarketStatsV2`, and V2 escrow seeds; they do not reinterpret the legacy `MarketOrder` layout or `fill_order` behavior. The UI keeps the V1 book in its own tab (view, buy, cancel, close-expired only — no create) so open legacy escrow remains reachable.
- Listings escrow only POTATO principal. Successful SOL/SKR fills atomically transfer the buyer's gross quote amount between seller net and the same-asset treasury fee, deliver POTATO, then update seller daily volume and global market stats. Cancel/expiry return the whole POTATO deposit without fee.
- The seller-volume counter is keyed by seller address, uses UTC-day windows, and is shared between quote pairs. The progressive 9/10/11/12% marginal breakpoints are draft thresholds; same-address splitting should not lower the marginal fee, but Sybil wallets are not prevented.
- SKR fill is permitted only against `GameConfig.skr_mint` with the classic SPL Token Program and six decimals. The browser blocks new SKR listings/fills until the configured mint passes verification; the pair remains viewable so users can cancel their active orders or return expired escrow if verification fails. On-chain validation remains authoritative.
- `VITE_MARKET_V2_ENABLED=true` is the shipped default because V1 listings are closed in the program. `VITE_MARKET_V2_ENABLED=false` survives only as an emergency UI rollback: it hides V2 and does **not** reopen V1 writes. Final tier thresholds still need owner approval before a V2 release on a new cluster.

## Units and accounts

POTATO amounts `*_micro` use 6 decimals. SOL amounts are lamports (1 SOL = 1e9).
`fill_order` settles in **native SOL via System Program**, not SKR. The separate SKR
presale/export-license rail uses 6-decimal token atoms. Resolve its mint from
`GameConfig.skr_mint`, not a hardcoded mainnet assumption.

Sizes include the 8-byte Anchor discriminator:

| Account | Seeds | Current bytes |
|---|---|---:|
| GameConfig | `config` | 260 (legacy: 156/164/228) |
| Epoch | `epoch`, epoch ID u64 LE | 49 |
| Field | `field`, field ID u64 LE | 78 (legacy: 70/69) |
| MarketOrder | `order`, order ID u64 LE | 83 |
| MarketStats | `market_stats` | 49 |
| MarketOrderV2 | `order_v2`, order ID u64 LE | 85 (draft) |
| SellerVolumeV2 | `seller_volume_v2`, seller pubkey | 57 (draft) |
| MarketStatsV2 | `market_stats_v2` | 49 (draft) |
| SellerProfile | `seller`, seller pubkey | 49 |
| PresaleState | `presale` | 57 |
| BuyerPresaleCounter | `buyer_presale`, buyer pubkey | 42 |
| Achievements | `achv`, user pubkey | 17 |
| AdminState | `admin_state` | 145 (legacy: 97) |
| ExportLicense | `license`, holder pubkey | 49 |
| Referral | `referral`, owner pubkey | 73 |
| RewardClaim | `reward`, recipient ATA + nonce u64 LE | 65 |

`RewardClaim` is the replay marker of `grant_reward_once` (P1-2): its size is
pinned by a host test, because a layout change must never make a second payout
with the same nonce possible. Every size in the table is asserted by
`account_sizes_match_client_decoders` (`lib.rs`), which is the single source of
truth for client decoders.

`Epoch` byte 41..49 was `burned_micro` (never incremented) and is now
`granted_micro` — the per-epoch manual-grant quota counter. Layout size is
unchanged (49 bytes), so no rent migration is needed; legacy accounts simply
reinterpret the field (they hold 0).

Config legacy layouts 156/164/228 and epoch legacy layout 41 are recognized by raw
clients for reads. That does **not** certify on-chain migration safety. Field migration
and legacy config migration have separate fixture tests; see [MIGRATIONS.md](MIGRATIONS.md)
and the stabilization report for execution status.

**Field layout v3 (P1-3).** `field_id: u64` was appended, so the account now
carries the id its PDA was derived from (78 bytes; 70/69 are legacy). Every
instruction that takes an existing Field (`harvest`, `batch_harvest`,
`repair_field`, `pay_tax`, `apply_fertilizer`, `upgrade_field`, `close_field`)
verifies `seeds = [b"field", field.field_id]` plus the stored bump, and the
quest proofs in `verify_fields` do the same for the remaining accounts — a
program-owned account with a Field discriminator but a non-canonical address is
no longer evidence of anything. Consequence: **a Field that has not been
migrated cannot be harvested or used in a proof.** Migrate all fields
(`migrate_field` per id, `scripts/migrate-v2.ts`) in the same window as the
program upgrade; raw clients accept both layouts for reads and mark the legacy
one with `fieldId === null`.
Account order, writable/signer flags and discriminators are an ABI. Raw instruction
builders in web/backend must match the generated IDL, not just its address.

## Operational / privileged instructions

| Instruction | Permission and behavior |
|---|---|
| `initialize` | First caller initializes singleton with correctly configured POTATO mint; establishes authority/reward signer. `config.skr_mint` defaults to the pinned `SKR_MINT` constant; the deployer may instead pass its own SKR mint as the **first** remaining account (must be owned by SPL Token with `SKR_DECIMALS` decimals, else `InvalidMint`/`InvalidSkrDecimals`). This exists so localnet can exercise the SKR rails — the constant devnet mint does not exist there and `update_skr_mint` sits behind a 24 h timelock. A call with no remaining accounts behaves byte-for-byte as before. |
| `init_epoch` | Authority; bootstrap cap from `config.daily_mint_cap_micro` |
| `roll_epoch` | Any funded payer after 24h; dynamic cap = mean(burn axis, utilization axis) clamped to `[daily_mint_cap_micro, 3×daily_mint_cap_micro]` |
| `close_old_epoch` | Permissionless rent-reclaim crank; closes epoch PDAs older than `current − KEEP_EPOCHS` (2). Historical emission stats remain in events and config counters |
| `grant_reward_once` | **The only reward mint** (the replayable `grant_reward` was removed in the 2026-11-03 upgrade). Authority OR reward signer; >0 and ≤1000 POTATO/call, within the current epoch cap and max supply, and within the **manual grant quota** (`GRANT_QUOTA_SHARE_BPS` = 25 % of the epoch cap, tracked in `Epoch.granted_micro`); blocked while paused. Creates the replay marker `reward_claim` PDA (`["reward", recipient ATA, nonce]` with plain `init` — never `init_if_needed`), so a repeated `(recipient ATA, nonce)` aborts in the runtime before any mint; `expires_at` must be within `MAX_REWARD_EXPIRY_SECONDS` (900 s) of chain time; the recipient account must be the canonical ATA of (owner, mint). Used by the backend rail, the bootstrap and the quest-pool top-up |
| `update_reward_signer` | Authority; replace delegated reward signer (authority retains reward permission) |
| `update_skr_mint` | Authority; **proposal only** — stores pending mint in `AdminState` |
| `apply_pending_skr_mint` | Authority; applies the proposal after the 24 h timelock (`TimelockNotExpired` otherwise) |
| `update_presale_price` | Authority; `price = 0` is the **kill switch** and applies immediately (closes both presale rails); `price > 0` is a proposal only |
| `apply_pending_presale_price` | Authority; applies a pending price proposal after the 24 h timelock |
| `update_config` | Authority; cap in `(0, 250k]`, multiplier in **[0.5×, 2×]** (`MultiplierTooHigh` / `InvalidAmount`), `base_yield_micro_per_day` in `(0, 100 🥔/day]` (`BaseYieldTooHigh`) |
| `set_paused` | Authority **or dedicated guardian key** (F-02); pause only — does not freeze all instructions or treasury; only authority unpauses |
| `propose_authority`, `accept_authority` | Two-step game authority transfer, NOT program upgrade authority transfer |
| `withdraw_treasury` | Authority; POTATO treasury ATA → destination token account of same mint; ≤ **250 000 🥔 per rolling 24 h** (`AdminState`) |
| `withdraw_treasury_sol` | Authority; SOL vault PDA → authority; ≤ **25 SOL per rolling 24 h** |
| `withdraw_skr_treasury` | Authority; configured SKR vault ATA → authority's SKR ATA; ≤ **100 000 SKR per rolling 24 h** |
| `propose_withdrawal`, `cancel_withdrawal` | Authority; two-step gate for `withdraw_*`: proposal stores the destination/amount, execution allowed after `WITHDRAW_TIMELOCK_SECONDS` (30 s), cancelable while pending |
| `update_guardian` | Authority; set/clear the emergency-pause guardian key in `GameConfig` (260-byte layout) |
| `migrate_admin_state` | Authority; migrates `AdminState` 97 → 145 (proposed withdrawal fields appended), exact-size/discriminator checks like other migrations |
| `migrate_config`, `migrate_epoch`, `migrate_field` | Authority; exact legacy/current layouts, discriminator/owner/PDA checks; `migrate_field(field_id)` additionally requires the canonical `[b"field", field_id]` PDA; rent shortfall paid to target; current data preserved on retry |
| `migrate_presale_authority` | New game authority synchronizes presale authority after transfer |

The three `withdraw_*` instructions lazily create the `AdminState` PDA
(`init_if_needed`, payer = authority), so the first withdrawal also passes the
system program and authority rent. Withdrawal counters roll over once per 24 h
window (`WITHDRAW_WINDOW_SECONDS`); exceeding a limit fails with
`WithdrawWindowLimitExceeded` (6036). Every `withdraw_*` call must follow a
`propose_withdrawal` and observe the 30 s on-chain timelock (`CanceledBeforeTimelock`
6041 if earlier); the proposal is cancellable via `cancel_withdrawal`.

**POTATO share cap (P1-4):** the POTATO window (250 000 🥔) equals the default
daily mint cap, i.e. the size of the whole treasury. `withdraw_treasury`
therefore also requires `amount_micro <= 10 %` of the current `treasury_potato`
balance (`MAX_WITHDRAW_BALANCE_SHARE_BPS = 1_000`, helper
`single_withdraw_cap`), failing with `WithdrawShareExceeded` (6056) before the
timelock is checked. Repeated executions of the same window geometrically decay,
so a single compromised `authority` key cannot drain the treasury in one call.
Smaller balances yield a zero cap (dust is not withdrawable).

**Cap semantics:** `daily_mint_cap_micro` is now respected by `roll_epoch` as the
floor of the dynamic clamp (upper bound = 3× the configured cap). Lowering it via
`update_config` tightens emission at the next roll. Manual grants additionally
consume only the 25 % quota (`GRANT_QUOTA_SHARE_BPS = 2_500`), leaving ≥75 % of
every epoch cap for gameplay harvests. Both bounds of `global_multiplier_bps`
are enforced: `0` (which used to zero every field's yield in one call) is
rejected with `InvalidAmount`.

## Player instructions

- `create_field`: field type 0/1/2; burns 100/250/500 POTATO. Top-level only:
  a CPI caller gets `CpiGrindNotAllowed` (6041) — an external contract must not
  be able to buy a field (and burn the player's POTATO) inside its own
  instruction.
- `harvest`: owned active field, ≥60s interval, ≤**7 days** accrual
  (`MAX_ACCRUAL_SECONDS`), epoch/supply limits; lunar multiplier is **time-weighted**
  across the accrual window (`lunar_weighted_bps`). Since P2-6 the lunar phase is
  derived from the **UTC day** (`lunar_day_index(now) = floor(now / 86400) mod 28`),
  not from `config.epoch_id`: a late or missing `roll_epoch` no longer shifts the
  phase, so harvesting cannot be timed against the peak and the phase matches the
  client's clock-based display.
  When the epoch cap or `max_supply` truncates the payout, `last_harvest` advances
  only by the paid share of the window and the unpaid remainder keeps accruing.
  The `Harvested` event carries `pending_micro` (the full accrual) and `truncated`
  so a client can tell a partial payout apart from a full one; durability is
  charged proportionally to the paid time (`harvest_decay`), so a truncated
  harvest no longer costs a point of durability for ~zero payout.
- `batch_harvest`: 1–10 unique writable owned Field accounts in remaining accounts;
  aggregate mint limits; updates field timestamps/durability. Covered by localnet CI.
  A cap shortfall scales **every** field by the same ratio (`available / total_gross`):
  each field is paid `pending_i × scale` and its `last_harvest` advances by
  `elapsed_i × scale`. `BatchHarvested` reports `requested_micro` and `truncated`
  alongside the paid totals. If the available cap rounds the player's share down to
  zero the instruction fails with `EpochCapExceeded` — no field is touched and no
  durability is spent, because the cap check happens before any state mutation.
  The cap rises to **1–30** (`BATCH_LIMIT_BASE` → `BATCH_LIMIT_LICENSED`) when the
  caller's export-license PDA `[b"license", owner]` is passed as the **first**
  remaining account (read-only) and `expires_at` is still in the future. The key is
  compared against the derived PDA and the owner must be this program, so a
  fabricated account cannot grant the tier. The license is excluded from the field
  list either way, active or expired. The 30-field tier needs a VersionedTransaction
  with an Address Lookup Table — 30 writable accounts do not fit a 1232-byte legacy tx.
- `close_field`: owner closes field account and receives rent, including while paused.
  Now **decrements `GameConfig.field_count`**, keeping global stats truthful.
  Closing still does not guarantee a field ID can never be reused.
- `repair_field`, `upgrade_field`, `pay_tax`, `apply_fertilizer`: burn-based upkeep;
  level/type scaling, tax prepay ≤28 days, fertilizer ≤7 days.
  `repair_field` prices **only the missing durability**:
  `BASE_REPAIR_MICRO × type_cost × max(level/3, 1) × (100 − durability) / 100`
  (minimum 1 micro), so repairing at 96 durability costs 4 % of a full repair
  instead of 100 %. `apply_fertilizer` is priced against the yield it multiplies:
  `BASE_FERTILIZER_MICRO × type_yield × level_mult × durability_mult`
  (minimum 1 micro) — +50 % of daily yield always costs 40 % of that gain, at any
  level and any durability.
- `upgrade_field`: the 5 % mutation roll mixes in the latest `SlotHashes` entry —
  the hash of the inclusion slot is unknown when the player signs, so slot
  grinding for a guaranteed Golden/Silicon mutation does not work. Requires the
  `slotHashes` sysvar account.
- `create_sell_order`, `create_sell_order_v2`: top-level only
  (`CpiGrindNotAllowed`), so a contract cannot list the player's POTATO at a
  price the player never saw or park their `CancelCooldown`.
- `create_sell_order` is **closed for new listings** (P2-2): valid arguments are
  rejected with `LegacyMarketClosed` (6058) after argument validation and before any
  transfer, so no account is created and no POTATO moves.
- `fill_order`, `cancel_order`, `close_expired_order` stay **open**: existing V1
  escrow must be settleable. Old market settles in native SOL; minimum order
  10 POTATO and total 0.001 SOL. The fee split is a pure function
  (`legacy_fee_split` in `lib.rs`): `60%` burn / `40%` treasury, then a `−3%`
  export-license discount, a `−1%` buyer-referral discount and a `0.5%` referrer
  reward capped by the burn share; an unusable referrer ATA makes the reward burn
  with the fee, so escrow always drains to zero. `fill_order` validates
  license/referral remaining accounts by **owner = program** and fully
  deserializes the referrer ATA (`spl TokenAccount`), rejecting forged accounts.
  The referrer-ATA check runs before the CEI effects, so `total_burned_micro`
  equals the supply actually burned.
- `register_referrer` is **retired** (`ReferralProgramRetired`, 6059). The reward
  and the buyer discount were paid only by `fill_order` above, so a new
  registration would promise payouts that cannot happen. The instruction stays in
  the ABI (clients get a program-level refusal instead of "unknown instruction");
  already registered pairs keep earning while the drained V1 book settles.
- `claim_achievement`: on-chain proofs and bitmap, quest IDs 0–5; requires the
  quest vault to hold at least the reward (`QuestPoolEmpty` otherwise, 6057);
  transfers existing
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
- `buy_field_skr` (buyer): 1053 SKR, **100 %** to the treasury SKR ATA.
  The historical 80/20 split was removed: the 20 % share went to a token account
  owned by the `authority` wallet, i.e. outside the program, outside the
  treasury withdrawal limits and invisible to the withdrawal audit. There is
  **no** on-chain buyback/burn, so a "reserve" the code cannot spend is not a
  reserve — everything now lands in the treasury, where it is visible and
  capped. Global cap and 5-field wallet cap; same `SlotHashes` rarity entropy
  (needs `slotHashes`). The drop odds are `PRESALE_SKR_ODDS_PCT = [20, 68, 12]`
  (COMMON / RARE / EPIC). With the flat 1053 SKR price the expectation is
  0.20×100 + 0.68×250 + 0.12×500 = **250 POTATO**, i.e. exactly the RARE price
  a `buy_field_sol` buyer pays deterministically; the old 70/25/5 odds returned
  only 157.5 POTATO (63 % of the price) and are locked against by the host test
  `skr_presale_odds_are_value_neutral`. Reopening the SKR rail in the UI
  requires the odds to be disclosed (or the tier to become a deterministic
  argument, which is an ABI change).
- `buy_export_license`: configured SKR payment; inspect source/current config for terms.

Both presale rails check `price_lamports > 0` (`PresaleNotActive`), which is how
the kill switch stops purchases; `buy_field_skr` checks its cap before the wallet
limit, `buy_field_sol` checks `PresaleNotActive` before the cap.

## Events and errors

Use events from the **generated, verified** IDL. At minimum, monitoring/indexing
should cover `FieldCreated`, `Harvested`, `BatchHarvested`, `FieldClosed`,
`OrderCreated`, `OrderFilled`, `PresalePurchase`, `AchievementClaimed`, `RewardGrantedOnce`,
`TreasuryWithdrawn`, `TreasurySolWithdrawn`, `TreasurySkrWithdrawn`, `EpochRolled`,
`PausedToggled`, `ConfigUpdated`, `AuthorityProposed`, `AuthorityAccepted`,
`SkrMintUpdated`, `RewardSignerUpdated`. The legacy `RewardGranted` struct is still
in the ABI (the hub adapter allowlist references the name) but **no instruction
emits it** since `grant_reward` was removed on 2026-11-03; every reward mint
surfaces as `RewardGrantedOnce`. (`close_old_epoch` emits no event, only
a program log; watch the transaction log if you need crank activity.)

Error codes start with `AlreadyClaimed=6000`, `BadProof=6001`, `Paused=6002`.
New codes from the 2026-09-21 remediation: `GrantQuotaExceeded=6035`,
`WithdrawWindowLimitExceeded=6036`, `BaseYieldTooHigh=6037`,
`TimelockNotExpired=6038`, `NothingPending=6039`, `EpochTooRecent=6040`,
`WithdrawShareExceeded=6056` (10 % of the treasury balance per withdrawal),
`QuestPoolEmpty=6057` (`claim_achievement` when the quest vault cannot pay the
reward — a named reason instead of an SPL `insufficient funds`).
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
| `GET /api/store` | `{enabled, reason, currency:"POTATO", packs[]}` — каталог паков из тех же данных, что и выдача | Никогда не 5xx: при закрытых продажах `enabled:false` + `reason` |
| `GET /api/features` | `{colonies, coloniesReleaseReady, rewardsRail, presalePayments}` — публичные гейты UI | 200 без чтения цепи: при недоступном RPC эндпоинт обязан отвечать |
| `GET /api/rewards/status` | `{enabled, reason, rewardSigner, starter, daily}` | 200 всегда: состояние, а не действие |
| `POST /api/rewards/starter` | `201 {ok,kind,wallet,amountMicro,signature}` (250 POTATO, один раз на кошелёк) | `400 BAD_WALLET`, `409 ALREADY_GRANTED`, `429 COOLDOWN`, `503 NOT_ENABLED`, `503 BUDGET_EXHAUSTED`, `502 GRANT_FAILED` |
| `POST /api/rewards/daily` | `201` — 7 POTATO, один раз в UTC-сутки | те же коды, что у `starter` |

Тело `POST /api/rewards/*` — `{ "wallet": "<base58>" }`; ключи и секреты не
принимаются. Оба эндпоинта платят за счёт отдельного `reward_signer`
(не authority и не epoch-payer), подпись проверяется по ончейн-конфигу перед
отправкой, а транзакция симулируется перед подписью. `nonce` детерминирован
(`sha256("starter:"+wallet)` / `sha256("daily:<utcDay>:"+wallet)`, первый u64 LE),
поэтому повтор запроса не создаёт второй грант: PDA `[b"reward", ata, nonce]`
уже существует, и клиент получает `409`. Мягкие бюджеты — 20 000 POTATO в сутки
на каждый вид гранта, кулдаун 15 с на кошелёк.

`/api/features` — только видимость разделов: клиент скрывает «Колонию», когда
сервер отдаёт `colonies:false`, но ни одно действие этими флагами не
разрешается — гейты остаются на сервере (`COLONIES_ENABLED`,
`USER_PRESALE_PAYMENTS_ENABLED`, `REWARDS_RAIL_ENABLED`).

`/api/store` — витрина без БД. `packs[].fields` содержит `{type,count,name}`,
`potatoMicro` — строка микро-POTATO, `potato` — целая часть. `enabled` — тот же
гейт, что у платежей (`USER_PRESALE_PAYMENTS_ENABLED` + одобрение сети), поэтому
витрина не выглядит покупаемой до запуска.

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

Rewards rail (off by default): `REWARD_KEYPAIR_JSON` (path to a `solana-keygen`
JSON or inline array) holds the dedicated `reward_signer`; the rail stays off
while `REWARDS_RAIL_ENABLED=false` in `src/launchGates.ts`, when the key is
absent, and on mainnet unless `NODE_ENV=production` and
`REWARDS_MAINNET_APPROVED=true`. `REWARD_DELIVERY_INTERVAL_SECONDS` (default `0`
= worker off) starts the `reward_intents` delivery worker; it needs `game_ops`
and recovers an already-sent grant from the claim PDA instead of re-sending it.
`QUEST_BUDGET_INTERVAL_SECONDS` (default `0` = off) starts the quest-pool cron:
it tops `quest_ata` up through `grant_reward_once` only below the low-water mark
(100 POTATO), at most one full pool (550 POTATO) per UTC day, with a nonce bound
to the UTC day so a restart cannot double-fund it.
### Presale: public endpoints

Prices are not in code: a run stores `price_units`, so every sale is auditable.
All amounts cross the wire as decimal **strings** (u64/bigint), never as numbers.

| Method / path | Success | Failure |
|---|---|---|
| `GET /api/presale/packs` | `{packs:[{id,titleRu,titleEn,fields,potatoMicro}]}` — каталог паков | — |
| `GET /api/presale/runs/:runId` | `{run:{...,isOpen,cluster,paymentsEnabled}}`; `isOpen` уже учитывает гейт запуска и кластер | 404 `RUN_NOT_FOUND` |
| `POST /api/presale/runs/:runId/reserve` | `201 {orderNo,state,currency,payUnits,treasury,reserveSecondsLeft,remaining,instruction}` | 503 `NOT_CONFIGURED` (гейт закрыт, devnet), 404 `RUN_NOT_FOUND`, 409 при закрытом тираже/исчерпанном cap |
| `POST /api/presale/runs/:runId/orders/:orderNo/payment` | `200 {state,needsManualReview,message}` — подпись принята, проверка отдельно | 503 `NOT_CONFIGURED`, 404 `ORDER_NOT_FOUND` |
| `GET /api/presale/runs/:runId/orders/:orderNo` | `{order}` — публичное представление (`presale_orders_public`) | 404 `ORDER_NOT_FOUND` |

Пресейл монтируется **только** при настроенном `game_ops` и читаемой
ончейн-конфигурации: без БД нет учёта заказов, без цепи нет верификации
платежа. Если префикс `/api/presale` отвечает 404 на всё — это fail-closed
режим, а не ошибка маршрутизации (`apps/backend/src/index.ts:231-247`).

`payUnits = price_units + order_no`: сумма счёта уникальна, поэтому платёж
привязывается арифметикой без платёжного процессора. Покупатель обязан
перевести ровно эту сумму — пыль и есть номер заказа.

### Presale: admin endpoints

Требуют `Authorization: Bearer <ADMIN_API_TOKEN>` (≥32 символа, иначе сервис не
стартует). Отказ пишется в аудит `admin.access` (`missing_token`/`bad_token`) с
адресом запроса, но ошибка аудита не меняет ответ клиенту: `401 UNAUTHORIZED`.

| Method / path | Назначение |
|---|---|
| `POST /api/presale/admin/runs` | открыть тираж (`runId,packId,currency,priceUnits,cap,treasury,reserveMinutes`) → 201. Mainnet принимает только `sol` (400); для `skr` — preflight ATA казны → **409 `VALIDATION` / `SKR_TREASURY_NOT_READY`** (P2-1) |
| `POST /api/presale/admin/runs/:runId/close` | аварийное закрытие — работает и при выключенном гейте платежей |
| `POST /api/presale/admin/expire` | истечь просроченные резервы |
| `POST /api/presale/admin/orders/:id/verify` | сверить платёж по цепи |
| `POST /api/presale/admin/orders/:id/deliver` | создать идемпотентный `reward_intents` → `{intentId,reused,plan}` |
| `POST /api/presale/admin/orders/:id/delivered` | `{intentId}` → заказ `delivered`; **409 `INVALID_TRANSITION`**, если интент ещё не `confirmed`: выдача фиксируется только после ончейн-подтверждения |
| `POST /api/presale/admin/orders/:id/refund` | `{reason}` (3..500 символов) → **решение** о возврате; текст причины неизменяем (миграция 0016). Работает при закрытом гейте |
| `POST /api/presale/admin/orders/:id/refund-settled` | `{signature}` → факт выплаты, **только после проверки цепи** (ниже) |
| `GET /api/presale/admin/pending` | заказы, оплаченные но не выданные |
| `GET /api/presale/admin/refunds` | решения о возврате без подтверждённой выплаты |
| `GET /api/presale/admin/attention` | очередь «требует внимания» |
| `GET /api/presale/admin/reconcile` | сверка платежей с цепью (`?since=…`; плательщик — по дельте баланса, см. P2-12) |

`refund-settled` отвечает `400 VALIDATION` с машинным `detail`, когда перевод не
доказывает возврат: `NOT_FINALIZED`, `TX_FAILED`, `WALLET_NOT_INVOLVED`,
`AMOUNT_MISMATCH`, `TOO_EARLY`, **`SOURCE_NOT_TREASURY`** (P2-9: казна обязана
участвовать в транзакции и потерять не меньше суммы возврата — иначе подошёл бы
любой входящий перевод той же суммы от третьего лица). Повтор с той же подписью
идемпотентен; другая подпись после закрытия — конфликт.

### game_ops admin endpoints

Тот же `ADMIN_API_TOKEN`, та же fail-closed схема: без `game_ops` префикс
`/api/gameops` не монтируется. Актор берётся из заголовка `X-Actor` (по
умолчанию `admin:api`), а не из тела. Основные группы: `GET /api/gameops/readiness`
(5 проверок → 503), `POST /api/gameops/intents[/batch]` и переходы
`submitted → confirmed|failed`, `POST /api/gameops/ledger/append` +
`GET /api/gameops/ledger/{tail,verify,anchor}` (журнал с хеш-цепочкой),
`/reconciliation`, `/audit`, `/cursors/:stream`. Полный список — в
`apps/backend/src/routes/gameops.ts`; ни один маршрут не двигает деньги:
выплаты идут через интенты и подтверждаются цепью.

See [OPERATIONS.md](OPERATIONS.md) for deployment, key inventory and incident response.
Watchtower endpoints and persistent analytics are **not implemented** in this package.
