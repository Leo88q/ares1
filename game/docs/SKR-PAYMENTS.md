# SKR settlement v2 — implementation and release checklist

**Source change, not a live deployment. Production prices are NOT set.**
The user's SKR payment requirement supersedes the earlier SOL marketplace design.
Native transaction fees, priority fees and account rent still require SOL; there
is no sponsored-fee service in this patch.

## Currency contract

- POTATO remains the harvested/traded resource and the current achievement/reward
  token. It is not silently renamed SKR or exchanged at an invented rate.
- Field creation, repair, upgrade, tax, fertilizer and referral registration use
  SPL SKR transfers to the canonical treasury ATA. SKR is never minted by this program.
- SKR presale retains its existing 1053 SKR price and 80% treasury / 20% authority
  buyback allocation. Export licenses retain the existing 500 SKR / 30-day terms.
- SKR marketplace buyers pay sellers and treasury in SKR. The resource transfers
  from escrow to buyer. Treasury withdrawals transfer existing SKR balances.
- There is **no promise of SKR harvest yield**, automatic redemption of POTATO,
  or unfunded SKR rewards. Those would require separate reward budgets/terms.

## Pricing: no guessed POTATO→SKR conversion

Authority instruction `configure_skr_pricing(prices: [u64;6], market_min_atoms: u64)`
creates/updates `SkrPricing` at `["skr_pricing", config.skr_mint]`.
SKR mint must be the configured SPL Token mint with six decimals.

`prices` order: **creation, repair, upgrade, tax, fertilizer, referral registration**.
Amounts are SKR atoms (1 SKR = 1,000,000 atoms). Zero disables the corresponding
paid action, and zero `market_min_atoms` disables new listings. A missing pricing
account also disables the new rail. No free-action fallback exists.

For field services, preserve type factors 0.4 / 1 / 2 and level factors:
repair `max(1, floor(L/3))`, upgrade `L`, tax `max(1, floor((L+1)/2))`, fertilizer 1.
Creation has no level multiplier; referral registration is flat.
`max_skr_atoms` is the wallet-approved ceiling in every new paid-service / fill
instruction. A higher on-chain price cannot charge beyond that signed amount.
Arithmetic is checked; balances and both token-account authorities/mints are bound.

The client reads the actual on-chain table, displays SKR costs and disables unset
prices. A referral URL only records a proposed referrer locally: no transaction is
sent on connect/polling. Registration requires a deliberate click and cost confirmation.

## Marketplace v2

| State | Seeds | Bytes incl. discriminator |
|---|---|---:|
| SkrPricing | `skr_pricing`, SKR mint | 97 |
| SkrOrder | `skr_order`, order ID u64 LE | 140 |
| escrow SPL account | `skr_escrow`, SkrOrder key | SPL Token size |
| SkrMarketStats | `skr_market_stats`, SKR mint | 73 |

Instructions: `create_skr_order`, `fill_skr_order(max_skr_atoms)`, `cancel_skr_order`,
`close_expired_skr_order`. Order snapshots resource mint, quote mint and base fee bps.
Price is **SKR atoms per whole POTATO**; total is
`floor(amount_micro * price_skr_atoms / 1_000_000)`, never lamports.

The existing 9–12% fee tiers remain, but **the fee is now deducted from seller SKR
proceeds**, not an extra POTATO deposit/burn. Seller escrows only the offered resource.
An active seller license reduces the rate by 3 percentage points; a valid buyer
referral reduces it by 1 point. This reduces the seller's fee, **not the buyer's
fixed quote**. A valid supplied referrer SKR account receives 0.5% of total from the
fee; otherwise that share stays in the treasury. Optional accounts are:
`[seller_license_or_placeholder, buyer_referral_or_placeholder, referrer_skr]`.
Program checks PDA, account owner and token mint/owner. Self-trades are rejected.
The existing 10 POTATO minimum, 24h lifetime and 3h cancel cooldown are retained.

Fill atomically transfers SKR buyer→seller/treasury/referrer and POTATO escrow→buyer.
Unsolicited escrow dust is refunded to the seller before account closure. Rent is
returned as SOL (not a purchase payout). Cancellation/expiry recovery stays available
while paused. Stats are separate from legacy SOL stats and partitioned by quote mint.

**Economic effect:** removing service/market POTATO burns changes token sinks.
The previous 60% POTATO market-fee burn no longer applies to v2. The harvest/reward
caps and dynamic epoch formula were not retuned. Re-simulate emission/burn utilization
before beta/mainnet: currency conversion is not evidence of sustainable economics.

## Legacy protection and rollout

1. Verify generated IDL, raw builders, host units, SBF, localnet payment tests and
   legacy migration fixtures. `tests/skr_payments.ts` is the current Anchor suite;
   `tests/solana_potato.ts` is the retained historical SOL/burn suite, not a passing
   test suite for the new economics. Do not quote its old test count as new coverage.
2. On a disposable localnet/devnet only, rehearse pause, upgrade and unpause.
   Migration of legacy account layouts is separate; existing layouts are not changed
   by the new pricing/order PDAs. Do not run against mainnet without approval.
3. Inventory open legacy SOL orders. New calls to `create_sell_order`, `fill_order`,
   `buy_field_sol`, legacy POTATO `create_field`, upkeep and `register_referrer`
   reject with `LegacyPaymentDisabled`. Keep `cancel_order` / `close_expired_order`
   to return their original POTATO escrow/fee and SOL rent. Never reprice their stored
   lamport values as SKR atoms. Web exposes old owned SOL orders for recovery only.
4. Confirm the actual SKR mint/decimals and canonical treasury ATA. Obtain explicit
   owner approval of the six SKR prices and market minimum; configure them on chain,
   then verify the fetched values. Test prices in the suite are **not production defaults**.
5. Publish the matching web build only with the matching on-chain ABI. An old deployed
   program will reject new SKR instructions; missing pricing intentionally disables UI.
6. Before changing the configured mint: pause, recover old orders and drain/record
   old-mint treasury balances while it is still configured. Do not migrate quote amounts.
   Order snapshots prevent redirecting an existing fill to a newly configured mint;
   old-mint orders remain contract-cancellable without the config account.
7. Monitor `SkrPricingUpdated`, `SkrPayment`, `SkrOrderCreated`, `SkrOrderFilled`,
   `SkrOrderClosed` separately from old SOL/POTATO events. Old field-state events
   have `cost_micro=0` on the SKR path (no POTATO was burned); read actual payment
   amounts from `SkrPayment`, not from renamed legacy fields.

Still separate release gates: revocation of the historically exposed RPC credential,
full-history remediation decision, treasury governance/budgets and experimental
Core/compression/transfer-hook placeholders. No public-chain write, key rotation,
authority change or history rewrite is performed by this change.
