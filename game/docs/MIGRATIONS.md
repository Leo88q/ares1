# Legacy account migrations

These instructions are not an approval to migrate funded accounts. Verify the
reviewed SBF binary, generated IDL and localnet tests before a live upgrade.

## Supported layouts and invariants

| Account | Legacy → current | Invariants |
|---|---|---|
| Config | 156 / 164 / 228 → 260 | Preserve authority, pending authority, mint, numeric fields, paused and bump. 156/164 insert SKR/reward signer (preserve burn snapshot; absent snapshot → zero); 228 appends guardian (`PublicKey.default`). |
| AdminState | 97 → 145 | Preserve rate-limit counters and pending proposal fields (zeros on 97 → 145); proposed withdrawal destination/amount appended. |
| Field | 69 → 70 | Preserve all 69 original bytes; new mutation byte starts at zero. |
| Epoch | 41 → 49 | Preserve original epoch fields/bump; new grant-quota counter (`granted_micro`, renamed from the never-incremented `burned_micro` on 2026-09-21) starts at zero. |

All handlers validate program ownership, exact supported size and discriminator.
Config must be the canonical PDA; Epoch address must match its stored ID. The
current game authority signs and pays the **target account's rent shortfall** via
System Program CPI before realloc. Never transfer rent to the executable program.
The authority meta is writable in every migration instruction.

Already-current layouts are byte-for-byte unchanged: a retry must not clear a
Field mutation, reset Epoch grant counters, or replace a custom SKR/reward signer.
Unknown layouts/types fail rather than being resized or truncated. These changes
do not alter the emission formula, administrative powers or treasury policy.

## Tests

Both legacy Config layouts and their Field/Epoch fixtures passed CI `35545805957`
for `5ffdc0b`. This certifies that disposable localnet test, not a live migration.

```sh
cd game
cargo test --locked -p solana_potato --lib
./scripts/build-program.sh
yarn typecheck:tools
yarn test:offchain
yarn test:migrations
```

`test:migrations` is a finite, separate localnet harness. It creates ephemeral
signers in memory, writes public genesis fixtures under ignored `.anchor/`, boots
the built program on loopback port 18899, and destroys each validator afterwards.
It refuses occupied test ports and checks the unique fixture config before sending
transactions. It does not read a real wallet or contact devnet/mainnet.

For Config 156, 164 and 228 it tests:
- wrong signer, foreign account owner, wrong discriminator/type, fake config PDA,
  and Epoch at the wrong address, including unchanged target state on rejection;
- migration of Field while config is still legacy;
- correct paused/bump, pending authority, amounts and burn snapshot after migration;
- rent exemption and stable data/lamports on a repeat call;
- nonzero mutation/burn extension preservation on already-current accounts.

Rust unit fixtures independently compare all legacy/current bytes. Off-chain tests
check the raw builder against the browser builder and prohibit a signer flag on
System Program. See STABILIZATION-2026-09-21.md for actual execution status.

## Operator flow (read-only first)

```sh
RPC_URL=<explicit-url> PROGRAM_ID=<verified-program-id> yarn migrate-v2
```

No wallet file is required for a read-only plan. The output contains public account
addresses, sizes, cluster genesis hash and rent shortfalls; never the RPC credential.
Only after reviewing the deployed code, authority, cluster and recovery procedure:

```sh
RPC_URL=<explicit-url> PROGRAM_ID=<verified-program-id> \
EXPECTED_GENESIS_HASH=<independently-verified-hash> \
ADMIN_KEYPAIR_PATH=<private-path> yarn migrate-v2 --execute
```

There is no implicit cluster or deploy wallet. `--execute` is an explicit opt-in;
all required values are validated before network work, and the observed genesis
must match. This is not a substitute for governance/multisig signing before mainnet.

The old web `migrate-devnet.mjs` (now in `scripts/devnet-legacy/`, F-21) now refuses to execute because it targeted an
obsolete program and duplicated unsafe migration code. Bootstrap (`init-onchain`)
reads the supported current layout and **refuses legacy state** instead of silently
performing migrations. Plan/review/migrate first, then rerun bootstrap as needed.
