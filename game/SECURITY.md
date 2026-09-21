# Security status — 21 September 2026

This repository is **not approved for mainnet or real funds**. Internal AI/code
reviews are not independent security audits; earlier “Audited”/“Done” labels are
not certifications. See [stabilization status](docs/STABILIZATION-2026-09-21.md).

- A browser RPC credential was tracked in `.env.production`; the current file was
  removed, but historical exposure and provider revocation remain open.
- Epoch payer must differ from game authority/pending authority/reward signer.
- Reward signer shares the harvest emission budget. Treasury has no timelock.
- Upgrade authority and live game authorities have not been verified in this pass.
- Dynamic epoch cap is not bounded by the admin `daily_mint_cap_micro` setting.
- Legacy migrations and experimental compression/Core/hook instructions are not
  certified. The latter contain placeholders, not full protocol integrations.
- Committed IDL is stale; Rust build/localnet tests must pass before a deployment.

Use Gitleaks with `.gitleaks.toml`; never post a credential in an issue or public
log. Follow [the operational runbook](docs/OPERATIONS.md) for revocation, isolated
payer storage, recovery and pause. Dependency vulnerabilities require an up-to-date
scanner run; old transitive-CVE notes are not a current dependency audit.
