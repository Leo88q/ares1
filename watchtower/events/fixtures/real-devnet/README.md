# Real devnet evidence — public-explorer capture (2026-10-06)

This directory now contains **real finalized devnet transactions** captured read-only
on 2026-10-06 through public explorers (`explorer.solana.com`), because direct RPC
egress from the sandbox is blocked (`curl https://api.devnet.solana.com` →
`OpenSSL SSL_connect: SSL_ERROR_SYSCALL`, while `https://github.com` answers 200).

Files are named `devnet-<slot>-<event-slug>.json` (not by signature) so that the
repository secret scanner does not mistake a public 88-character transaction
signature in a **file name** for key material; the signature itself is inside the
JSON. Every file contains:

* `provenance: real_devnet_public_explorer_capture` and the explorer URL;
* the finalized coordinates (`slot`, `blockTime`, `instructionIndex`, `innerIndex`);
* the raw `Program data: <base64>` log line;
* the payload decoded offline against the committed IDL
  (`game/apps/web/src/idl.json`, sha256 `6a2bdaab…`), plus the IDL hash.

Captured events: `FieldUpgraded`, `AchievementClaimed` (×2), `ExportLicensePurchased`.
The structured summary lives in `../../runtime-evidence.json`.

## What this is NOT

* It is **not** the exporter's certified smoke
  (`node --env-file=.env --import tsx scripts/verify-devnet.ts --capture-fixture`).
  That script requires a live allowed RPC, a migrated PostgreSQL and a caught-up
  exporter; none of those are configured in the sandbox, and it never ran here.
* It does not change `integration-manifest.json`:
  `deploymentVerified` stays `false` and `lastVerifiedAt` stays `null` until the
  exporter smoke and central handshake are done (the repo's tests pin those values).
  It also does not prove the deployed binary matches the committed source
  (devnet build is not a verified build; last deploy slot 507112076, 2026-10-03).
* It does not prove coverage of all 31 event types — 3 types were sampled.

## Privacy

Fixtures contain **only public devnet chain data** from beta test wallets. No mainnet
players, no emails, no device/IP data, no credentials, no production payloads.
`AchievementClaimed` fixtures reference the same devnet test wallet that appears in
the public explorer pages; nothing was added by hands.

## Re-capturing properly

On a machine with an allowed devnet RPC and a ready exporter:

```sh
cd watchtower
node --env-file=.env --import tsx scripts/verify-devnet.ts --capture-fixture
```

That run overwrites/produces its own fixture files in this directory and is the only
form accepted as the certified devnet smoke evidence.
