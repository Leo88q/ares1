import './polyfills'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import {
 SolanaMobileWalletAdapter,
 createDefaultAddressSelector,
 createDefaultAuthorizationResultCache,
} from '@solana-mobile/wallet-adapter-mobile'
import { reportWalletError } from './utils/walletBus'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { clusterApiUrl } from '@solana/web3.js'
import './i18n/dicts'
import { t } from './i18n'
import { Glyph } from './ui/Emblem'
import './fonts'
import './theme/tokens.css'
import './styles/global.css'
import './styles/kit.css'
import './index.css'
import './styles/i18n-fit.css'
// Vendored: upstream shipped a remote @import for DM Sans (see the file header).
import './styles/wallet-adapter.css'

/**
 * Экран ошибки запуска.
 *
 * Fail-fast проверки конфигурации (VITE_PROGRAM_ID, VITE_RPC_URL) бросают
 * исключение на уровне МОДУЛЯ — до монтирования React и вне ErrorBoundary,
 * поэтому обычный белый экран не объясняет ничего. ./App и
 * ./contexts/SolanaContext импортируются в bootstrap() динамически: если
 * модуль упал на проверке конфигурации, исключение ловится и игрок видит
 * понятный экран с подсказкой, а не пустую страницу.
 *
 * Важно: вендорские зависимости остаются СТАТИЧЕСКИМИ импортами. Перенос
 * их в import() ломает tree-shaking барьера @solana/wallet-adapter-wallets —
 * в бандл едут все адаптеры кошельков с dev-URL и строками CDN, и гейт
 * scripts/check-release-artifacts.mjs краснеет.
 */
function BootErrorScreen({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div style={{ padding: 20, color: '#fff', background: '#0a0a0f', minHeight: '100vh', fontFamily: 'monospace' }}>
      <h1><Glyph name="warning" size={26} style={{ verticalAlign: "-4px", marginRight: 8 }} />{t('Игра упала')}</h1>
      <p>{message}</p>
      <p style={{ opacity: 0.75 }}>
        {t('Игра не запустилась: не заданы VITE_PROGRAM_ID / VITE_RPC_URL. На Cloudflare Pages задай их в Settings → Environment variables; локально — в apps/web/.env (см. .env.example).')}
      </p>
      <button onClick={() => window.location.reload()}>{t('Перезагрузить')}</button>
    </div>
  )
}

const network =
 configuredCluster() === 'mainnet-beta' ? WalletAdapterNetwork.Mainnet
 : configuredCluster() === 'testnet' ? WalletAdapterNetwork.Testnet
 : WalletAdapterNetwork.Devnet

// CLUSTER живёт в SolanaContext, но этот модуль импортируется динамически
// (см. bootstrap) — до его загрузки кластер нужен здесь для выбора сети
// кошельков. Одна и та же логика одной строки: дубликат осознанный.
function configuredCluster(): string {
  return import.meta.env.VITE_SOLANA_CLUSTER || 'devnet'
}

/**
 * RPC endpoint resolution (checklist §3.1.1 — no plaintext transport, §1.3.9 —
 * the RPC key is not a browser secret).
 *
 * Two problems were found by scripts/check-release-artifacts.mjs in the
 * previous one-liner:
 *
 *  1. `clusterApiUrl(network)` returns an **http://** URL by default, so a
 *     production build without VITE_RPC_URL sent every RPC call — including
 *     the transactions a player signs — over plaintext. It is now forced to
 *     https.
 *  2. The localnet fallback `http://127.0.0.1:8899` was shipped in the bundle
 *     for every environment. Local development is the only legitimate use, so
 *     it is gated behind import.meta.env.DEV and stripped from production
 *     builds by the bundler.
 *
 * In production VITE_RPC_URL is mandatory: a silent fallback to a public
 * endpoint is how a game ends up rate-limited, or pointed at the wrong
 * cluster, without anyone noticing. For Cloudflare Pages (and any other CI)
 * vite.config.ts injects the public .env.example values at build time and
 * prints a loud warning, so reaching this guard means the build bypassed
 * the standard config.
 */
const configuredRpcUrl = import.meta.env.VITE_RPC_URL
function resolveEndpoint(): string {
  if (configuredRpcUrl) return configuredRpcUrl
  if (import.meta.env.DEV) {
    return configuredCluster() === 'localnet' ? 'http://127.0.0.1:8899' : clusterApiUrl(network, true)
  }
  throw new Error(
    'VITE_RPC_URL is required in production (see apps/web/.env.example). ' +
      'Refusing to fall back to a public endpoint: it would silently rate-limit ' +
      'the game and, before this guard, used plaintext http.',
  )
}

 // Встроенный кошелёк Seeker (Solana Mobile / Seed Vault) говорит с dApp по
 // собственному протоколу — без официального адаптера в-апп кошелёк
 // «подключается» только через совместимый shim, который умеет connect,
 // но возвращает транзакцию без подписи (ошибка «Missing signature»).
function handleWalletError(error: unknown, adapter?: { name?: string }) {
 const name = (error as { name?: string } | null)?.name ?? ''
 const message = (error as { message?: string } | null)?.message ?? String(error)
 const adapterName = adapter?.name ?? ''
 if (/Sign|SendTransaction/i.test(name)) {
  console.error('[wallet] sign error (already toasted by sendIx):', message)
  return
 }
 if (/user rejected|rejected the request/i.test(message)) {
  reportWalletError({ kind: 'rejected', adapter: adapterName, raw: '' })
  return
 }
 reportWalletError({ kind: 'connect', adapter: adapterName, raw: message })
}

const mobileWallet = new SolanaMobileWalletAdapter({
 addressSelector: createDefaultAddressSelector(),
 // identity = фактический origin страницы (как делает авто-адаптер
 // wallet-adapter-react) — кошелёк связывает авторизацию именно с ним
 appIdentity: { name: 'Solana Potato', uri: typeof window !== 'undefined' ? window.location.origin : 'https://play.ares1.is-a.dev' },
 authorizationResultCache: createDefaultAuthorizationResultCache(),
 chain: configuredCluster() as 'devnet' | 'testnet' | 'mainnet-beta',
 onWalletNotFound: async () => {
  reportWalletError({ kind: 'not-found', adapter: 'Mobile Wallet Adapter', raw: '' })
 },
})

const wallets = [
 new PhantomWalletAdapter(),
 new SolflareWalletAdapter(),
 mobileWallet,
]

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
 state = { error: null as Error | null }
 static getDerivedStateFromError(error: Error) { return { error } }
 render() {
  if (this.state.error) {
   return (
    <div style={{ padding: 20, color: '#fff', background: '#0a0a0f', minHeight: '100vh', fontFamily: 'monospace' }}>
     <h1><Glyph name="warning" size={26} style={{ verticalAlign: "-4px", marginRight: 8 }} />{t('Игра упала')}</h1>
     <p>{this.state.error.message}</p>
     <pre style={{ fontSize: 11, opacity: 0.7 }}>{this.state.error.stack}</pre>
     <button onClick={() => window.location.reload()}>{t('Перезагрузить')}</button>
    </div>
   )
  }
  return this.props.children
 }
}

async function bootstrap(): Promise<void> {
  try {
    // Только прикладные модули — динамически (в них живут fail-fast
    // проверки конфигурации на уровне модуля). Вендор — статически,
    // чтобы не терять tree-shaking.
    const [{ default: App }, { SolanaProvider }] = await Promise.all([
      import('./App'),
      import('./contexts/SolanaContext'),
    ])

    // Внутри try: в production без VITE_RPC_URL resolveEndpoint() бросает
    // fail-fast — он должен ловиться и показывать BootErrorScreen.
    const endpoint = resolveEndpoint()

    ReactDOM.createRoot(document.getElementById('root')!).render(
     <React.StrictMode>
      <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
       <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
        <WalletProvider wallets={wallets} autoConnect onError={handleWalletError}>
         <WalletModalProvider>
          <ErrorBoundary>
           <SolanaProvider>
            <App />
           </SolanaProvider>
          </ErrorBoundary>
         </WalletModalProvider>
        </WalletProvider>
       </ConnectionProvider>
      </BrowserRouter>
     </React.StrictMode>,
    )
  } catch (error) {
    console.error('[boot] Игра не смогла запуститься:', error)
    ReactDOM.createRoot(document.getElementById('root')!).render(<BootErrorScreen error={error} />)
  }
}

void bootstrap()
