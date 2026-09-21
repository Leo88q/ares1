# Security status — 21 September 2026 (post-remediation, pre-build)

This repository is **not approved for mainnet or real funds**. Internal AI/code
reviews are not independent security audits; earlier “Audited”/“Done” labels are
not certifications. The 2026-09-21 remediation fixed every finding of
[docs/AUDIT-INDEPENDENT-2026-09-21.md](docs/AUDIT-INDEPENDENT-2026-09-21.md)
**in source**; none of it has been compiled or exercised on a validator yet.
See [docs/FIXES-2026-09-21.md](docs/FIXES-2026-09-21.md) for the change list and
the mandatory pre-deploy runbook, and
[stabilization status](docs/STABILIZATION-2026-09-21.md) for the earlier pass.

Fixed in source (pending `anchor build` + `anchor test` + localnet verification):

- Admin guard rails: sensitive updates (SKR mint, presale price raise) are
  two-step behind a 24 h timelock (`AdminState`); treasury withdrawals are
  rate-limited per rolling 24 h window; the presale kill switch (price = 0)
  applies immediately.
- Dynamic epoch cap is now clamped to `[daily_mint_cap_micro, 3×]` — the admin
  setting constrains `roll_epoch`.
- Manual `grant_reward` mints are capped at 10 % of the epoch cap
  (`Epoch.granted_micro` quota).
- Rarity/upgrade randomness mixes in `SlotHashes` — slot-grinding at signing
  time no longer works. Accrual capped at 7 days; lunar multiplier time-weighted.
- `buy_field_sol` prices scale with field type and take a buyer slippage bound
  (`max_total_lamports`); `fill_order` validates license/referral/ATA accounts by
  owner and full deserialization (forged-account discount/referral paths closed).
- The experimental compression/Core/transfer-hook instructions were **removed
  from the ABI** (they were placeholders, never real CPIs); their accounts and
  events are gone. `close_field` decrements `field_count`; `close_old_epoch`
  is a permissionless rent crank; bootstrap (`scripts/init-onchain.ts`) creates
  the mint and hands authority to the config PDA in one atomic transaction.

Still open / unchanged:

- A browser RPC credential was tracked in `.env.production`; the current file was
  removed, but historical exposure and provider revocation remain open.
- Epoch payer must differ from game authority/pending authority/reward signer.
- Upgrade authority and live game authorities have not been verified in this pass.
- The committed `apps/web/src/idl.json` was rebuilt by hand alongside the source
  edits — a genuine pinned-Anchor build MUST regenerate and replace it (plus the
  watchtower snapshot) before any deployment; `yarn check:contract` currently
  passes only the inventory/error comparison.
- Legacy migrations remain uncertified against funded state.

Use Gitleaks with `.gitleaks.toml`; never post a credential in an issue or public
log. Follow [the operational runbook](docs/OPERATIONS.md) for revocation, isolated
payer storage, recovery and pause. Dependency vulnerabilities require an up-to-date
scanner run; old transitive-CVE notes are not a current dependency audit.
