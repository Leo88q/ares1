// The browser flag is public. Keep the V2 UI disabled until the matching
// program is deployed to the selected cluster and draft seller-volume limits
// have explicit owner approval. This flag never deploys or upgrades a program.
export const MARKET_V2_ENABLED = import.meta.env.VITE_MARKET_V2_ENABLED === 'true'
