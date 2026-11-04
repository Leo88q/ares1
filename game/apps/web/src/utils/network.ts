/**
 * Сеть сборки и её ярлык для интерфейса.
 *
 * Модуль намеренно листовой: ярлык нужен ранним экранам (загрузка) и подписям в
 * шапке, и тянуть ради константы весь стек web3 из SolanaContext нельзя.
 *
 * Ярлык — не украшение. Аудит P2: подписи «SOLANA DEVNET», «РЫНОК DEVNET»,
 * «ЦЕЛЬ КОЛОНИИ · DEVNET» были зашиты строкой, хотя подключение берётся из
 * `VITE_SOLANA_CLUSTER`. На mainnet-сборке интерфейс денег показывал бы
 * «devnet» — то есть прямо врал бы о сети, в которой подписываются транзакции.
 * Теперь надпись выводится из того же источника, что и RPC-эндпоинт.
 */
// `typeof` защищает от сборок без Vite (тестовые фикстуры esbuild): там
// `import.meta.env` не определён, а падение модуля уронило бы весь экран.
const configuredCluster = typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_SOLANA_CLUSTER : undefined
export const CLUSTER = configuredCluster || 'devnet'
export const IS_MAINNET = CLUSTER === 'mainnet-beta'
/** `MAINNET` или `DEVNET` — подставляется в подписи через `t(..., { network })`. */
export const NETWORK_LABEL = IS_MAINNET ? 'MAINNET' : 'DEVNET'
