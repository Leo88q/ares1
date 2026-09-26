# Security status — 21 September 2026 (post-remediation, CI-verified)

This repository is **not approved for mainnet or real funds**. Internal AI/code
reviews are not independent security audits; earlier “Audited”/“Done” labels are
not certifications. The 2026-09-21 remediation fixed every finding of
[docs/AUDIT-INDEPENDENT-2026-09-21.md](docs/AUDIT-INDEPENDENT-2026-09-21.md)
in source, and the pinned-toolchain CI gate compiles it and exercises it on a
clean localnet (`anchor build` + `anchor test` + `yarn test:migrations` +
`check:contract` full ABI equality + offchain/watchtower suites). It has **not**
been deployed to devnet/mainnet, and the operational items below remain open.
See [docs/FIXES-2026-09-21.md](docs/FIXES-2026-09-21.md) for the change list and
the pre-deploy runbook, and
[stabilization status](docs/STABILIZATION-2026-09-21.md) for the earlier pass.

## Extended checklist audit — 26 September 2026

A second pass covered checklist items **31–70** (Anchor/Solana specifics, tokenomics,
infrastructure, supply chain): [docs/SECURITY_CHECKLIST_AUDIT_2026-09-26.md](../docs/SECURITY_CHECKLIST_AUDIT_2026-09-26.md).

Four real defects were found and fixed in source — client-side double execution
(same instructions re-sent after a V0 send), missing SKR `decimals` validation on
the timelocked mint migration, "whitelist-only" transaction simulation and the
absence of any instruction allowlist / post-sign verification. A pre-minted supply
at `initialize` is now rejected as well.

Operational items (upgrade authority multisig, reproducible build, key rotation,
DNSSEC, external audit) are **not code** and remain open until the
[mainnet launch gate](docs/MAINNET_LAUNCH_GATE.md) is signed off;
`scripts/preflight-mainnet.sh` machine-checks the parts that can be checked.

Fixed and CI-verified on localnet (`anchor build` + `anchor test`):

- Admin guard rails: sensitive updates (SKR mint, presale price raise) are
  two-step behind a 24 h timelock (`AdminState`); treasury withdrawals are
  two-step (`propose_withdrawal` → short on-chain timelock → `withdraw_*`,
  cancellable via `cancel_withdrawal`) on top of the rolling 24 h window caps
  (250 000 🥔 / 25 SOL / 100 000 SKR), and POTATO leaves only through the
  authority's own ATA; the presale kill switch (price = 0) applies immediately.
- Emergency pause can also be raised by a dedicated **guardian** key
  (`update_guardian`); only the authority can unpause.
- Paid RNG (`buy_field_skr` tier roll, `upgrade_field` mutation) rejects CPI
  invocation (stack-height guard), closing the revert-if-unlucky grind.
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
- The committed `apps/web/src/idl.json` is now the **genuine pinned-Anchor build**
  (Anchor 0.31.2) recovered from CI for the fixes revision; `yarn
  check:contract target/idl/solana_potato.json` passes the full ABI comparison
  (built == committed) and the watchtower snapshot is re-synced to it. Any future
  program change must re-run `anchor build` → `check:contract` →
  `watchtower/scripts/sync-idl.mjs` before deploy.
- Legacy migrations remain uncertified against funded state.

Use Gitleaks with `.gitleaks.toml`; never post a credential in an issue or public
log. Follow [the operational runbook](docs/OPERATIONS.md) for revocation, isolated
payer storage, recovery and pause. Dependency vulnerabilities require an up-to-date
scanner run; old transitive-CVE notes are not a current dependency audit.

## Reporting a vulnerability (F-23)

Private channel: GitHub Security Advisories for this repository
(`https://github.com/Leo88q/ares1/security/advisories/new`) — reports go only to
repository administrators. No public issue for exploitable findings; no
additional email address is published (requires human decision to add one).
Include affected component, reproduction steps and impact; do not attach
private keys or funded-wallet material to the report.
