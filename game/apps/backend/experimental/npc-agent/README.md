# NPC agent (experimental, not built)

Prototype of an autonomous "NPC farmer" that plays the game through
[Sentinel Guard](../../../../libs/sentinel) as a transaction firewall.
It targets the Anchor 0.32 client API and `solana-agent-kit`, neither of which
is a dependency of the backend, so this folder is excluded from `tsc`
(`apps/backend/tsconfig.json` only includes `src/`).

To revive it: create a separate package here, add `@coral-xyz/anchor@^0.32`,
switch `new Program(idl, programId, provider)` to `new Program(idl, provider)`
and pass the full account lists (see `apps/web/src/utils/anchorClient.ts`).
