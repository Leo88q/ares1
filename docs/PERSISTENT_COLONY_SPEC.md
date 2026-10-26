# ARES-1 persistent colony — hybrid production architecture (draft)

**Target selected by the owner:** full production game for Solana mainnet and Solana Mobile dApp Store; no public pilot. Existing on-chain Field/POTATO/SKR rails remain on Solana. Persistent colony construction and progression are stored by a production backend in PostgreSQL. This is a hybrid product: backend colony state must never be represented as on-chain state or as trustless execution.

Product/SKU/rules proposal and explicit owner decisions: [Colony V1 product proposal](COLONY_V1_PRODUCT_PROPOSAL.md).

**Implementation status: in progress, not releasable.** The repository now has a draft PostgreSQL schema, wallet-auth routes, finalized Field ownership verification, a transactional Colony state/action engine, and a browser client. The purchase entitlement flow remains deliberately closed; product/economy review, production recovery and release review are still incomplete. No mainnet program has been verified or deployed from this checkout. No payment, transaction, Store submission or paid service is authorized by this document.

## Product and trust boundaries

| State/action | Authority | What the client may claim |
|---|---|---|
| Field ownership, Field layout, POTATO/SKR balances and confirmed token transfers | Solana accounts/programs, verified against the configured mainnet program and mint | “Confirmed on Solana” only after the configured commitment and account verification |
| Colony buildings, Lab research, construction slots and non-token colony resources | Production backend and durable database | “Saved to ARES-1 account” / “backend-persistent”; never “on-chain” |
| Predictions of time-based production | UI calculation from backend rules and persisted timestamps | “Estimate” until returned as a committed backend state update |
| Entitlement after a future approved SKR purchase | Backend order/entitlement record linked to a confirmed SPL transfer signature and wallet | “Delivered” only after idempotent backend fulfillment; sale remains closed until a separate GO |

The backend does not hold player wallet keys and cannot fabricate Solana balances or Field ownership. It does own/validate colony progression, so the service is a trusted game operator. The listing, privacy notice, help pages and UI must disclose that boundary. If the service is unavailable, colony mutations stop safely; the browser must not invent or locally persist authoritative game state.

## Mainnet product flow

1. Player connects a wallet and signs a short-lived, single-use authentication challenge. The server verifies the signature, nonce, domain, expiry and replay status; possession of a public address alone is not authentication.
2. Backend checks the player's Field and required token/asset state through a verified mainnet RPC configuration. It records the observed cluster, slot, commitment and account addresses used for the decision.
3. Colony initialization creates a database record in one transaction: owner wallet, linked Field, versioned ruleset, Core/Lab state, sequence number, timestamps and initial non-transferable game resources. It is not a Solana account and creates no claim of on-chain ownership.
4. Every mutation is an authenticated action with a client request ID, expected colony version, bounded payload and idempotency key. The server validates the ruleset and Field ownership, updates the state and append-only event log atomically, and increments the sequence. Duplicate/stale actions do not apply twice.
5. Time-based production is materialized from trusted server UTC and versioned rates whenever state is read or mutated. Long intervals and many short intervals must produce the same result; storage caps and fractional remainders are explicit. There is no player pause or browser timer as authority.
6. On reconnect, the client fetches the last committed backend state. Browser storage may cache presentation only and is never used to restore balances, buildings or progress.

## Persistent data model

The implementation must add versioned PostgreSQL migrations for:

- `wallet_challenges`: nonce hash, wallet, domain, issued/expiry time, consumed time; never store a reusable signed challenge.
- `colonies`: stable ID, owner wallet, verified Field address, ruleset version, creation/update times, sequence/version, serialized bounded state and integrity checksum.
- `colony_events`: append-only action log keyed by colony + sequence, action type, canonical validated payload, previous/new version, request ID, timestamps and result hash. Do not log signatures, secrets or unnecessary personal data.
- `colony_orders` and `entitlements`: only if/when a sale receives separate approval. Unique constraint on `(cluster, payment_signature, instruction_index)` and order ID; state machine such as `observed → confirmed → fulfilled` with `rejected/refund_pending` branches.
- `rulesets`: immutable versioned catalog and resource formulas; changing rates/costs requires a new version and release note, not a client-side constant.

Use parameterized SQL, explicit transaction boundaries, least-privilege DB roles, bounded payloads, indexes for owner/sequence/signature queries, and migrations that can be rolled forward safely. A colony's event log plus periodic snapshots must be sufficient to rebuild its current state. Database credentials are server-only and must not enter APK/web bundles.

## Security, reliability and fairness

- Verify wallet signatures server-side with expiring single-use nonces and origin binding. Protect challenge, mutation and payment routes with abuse limits; do not treat IP rate limiting as identity or Sybil resistance.
- Use a transactional outbox/worker for asynchronous RPC checks and future order fulfillment. A confirmed on-chain payment and a database entitlement are not one atomic transaction; retries must be idempotent, and unresolved orders must be visible to operators and users.
- Require independent RPC providers for production-critical payment/ownership checks. Persist enough evidence to reconcile a provider disagreement or chain rollback; never fulfill a payment from an unconfirmed notification alone.
- Fail closed on unknown program/mint, wrong cluster/genesis, stale ruleset, invalid Field owner, replayed nonce/signature, duplicate order, stale colony version, unsupported action, overflow or DB/RPC outage.
- Use optimistic concurrency (`expectedVersion`) so two tabs/devices cannot spend the same resources. Resource costs and caps are computed on the server from the versioned ruleset, not accepted from client input.
- Back up PostgreSQL with encrypted backups, point-in-time recovery where available, documented retention, access review and successful restore drills. Define and monitor RPO/RTO before Store submission; a free-tier database without verified backups is not production-ready.
- Provide player-visible service status, action history, support/contact and a privacy/deletion process consistent with the published policy. Retention and deletion rules must account for legally required transaction/order records.
- No backend endpoint signs a player's Solana transaction or controls their token account. A separate narrowly scoped game signer is unnecessary for colony persistence.

## Solana deployment and cost boundary

- Existing Field instructions and token logic remain on-chain; this design does **not** remove the cost of deploying that program if mainnet does not already have a verified compatible deployment.
- Moving colony Buildings/Research from PDAs into PostgreSQL avoids colony PDA rent, account growth, per-building rent and many on-chain writes. It does not make the existing game ELF rent-free.
- Use existing System/SPL Token/Associated Token programs; do not deploy a token helper or NFT for each building. If the existing mainnet game program is absent or incompatible, calculate its full new-deploy/upgrade cost before choosing a launch architecture.
- Keep player rent payer explicit. A Field or ATA created on chain still needs rent-exempt funding. If the player pays, show the amount before signing; if the studio sponsors it, bound the per-wallet subsidy and total budget and disclose that it is sponsored.
- Backend persistence has recurring service/operations costs even if the initial provider tier costs $0. Do not equate “no SOL deployment fee” with “free, reliable production service.”

The minimum full-release chain budget therefore consists of: current program deployment or upgrade (if needed), required mint/config/init state, transaction and priority fees, any company-sponsored player rent, and the Store publisher flow. Reserve balances are shown separately from consumed fees/rent. Current live amounts must be measured against the exact artifact and trusted mainnet RPC; test vectors are not quotes.

## Full release acceptance criteria (not a public pilot)

- Complete feature flow works on mainnet: connect → verify Field eligibility → create/recover backend-persistent Colony → open Lab → research → construct/upgrade → reconnect and recover exactly the committed state.
- Mainnet Field/POTATO/SKR contract addresses, authorities, mint decimals, supplies and program artifact hash are independently checked. No devnet fallback is present in the Store build.
- Full backend path is implemented: authentication, durable migrations, transactional actions, idempotency, event replay/rebuild, backups/restore, health/readiness, alerting, failover policy, abuse controls and support runbooks.
- Security review covers both the on-chain contracts and the backend trust boundary, payment saga if enabled, admin controls, database roles, RPC assumptions and recovery process. Critical/high findings are closed or explicitly accepted by the release owner.
- Complete test suite passes: contract unit/property/local-validator/fork tests; backend migration, concurrency, replay, outage/recovery, rollback and payment reconciliation tests; frontend tests; build and signed APK verification.
- WebShell MWA is exercised on a supported Android device/wallet; transaction screens, deep links, back navigation, network mismatch and failure/retry paths are verified on the production build.
- Publisher KYC/KYB, separate release signing key, accurate listing assets/metadata, public HTTPS origin, privacy and publisher-policy review, storage estimate and publisher-wallet quote are complete.
- No public pilot/soft launch is planned. Internal localnet/devnet/fork tests and independent security review are release engineering gates, not a reduced public product. Production launch and Store submission still require their respective explicit final approvals; this spec authorizes neither.

## Implementation status and next work

The repository keeps a design-only package catalog and now contains migrations `0010_colonies.sql` and `0011_colony_entitlement_sku_unique.sql`, one-time hashed wallet challenges, origin-bound short-lived sessions, a backend Field decoder, finalized Field ownership checks (with independent-RPC byte comparison), a transactional state/action engine, versioned v3 prototype rules with server-resolved SKU grants, per-resource capacity multipliers and queue limits, a client UI, and an event-chain audit tool (`yarn colony:audit`). Initialization requires a server-issued Starter entitlement; there is intentionally no entitlement-issuance or payment endpoint while sales are closed. The rules in `game/apps/backend/src/colonies/rules.ts` are internal-review values, not approved product/economy terms. The migration has not been applied to the selected operational PostgreSQL database; the eleven migrations were applied and verified only in a disposable PGlite database. The Colony routes remain disabled by default (`COLONIES_ENABLED=false`). The hard-coded `COLONY_V1_RELEASE_READY=false` gate blocks a production mainnet backend until full acceptance and release review. Real provider backup configuration, an isolated restore drill, purchase fulfillment, device QA, and broader recovery/security review remain incomplete. The existing `ColonyV1` on-chain draft is superseded by this selected hybrid design for Colony state, while existing on-chain Field/token instructions remain subject to mainnet verification. Do not expose purchases or claim a mainnet-ready game until the complete acceptance criteria above pass.
