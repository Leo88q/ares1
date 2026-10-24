// Off-chain colony feature flag (§31.12). Public build-time value, shipped as `false`.
// When on, the player can harvest a ripe greenhouse bed by hand (80–100 % of the cycle).
// The flag changes only the browser UI. It touches no on-chain program, no SKR, no server record.
export const COLONY_MANUAL_HARVEST_ENABLED = import.meta.env.VITE_COLONY_MANUAL_HARVEST === 'true'
