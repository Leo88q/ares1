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
import App from './App'
import { SolanaProvider, CLUSTER } from './contexts/SolanaContext'
import './theme/tokens.css'
import './styles/global.css'
import './index.css'
import '@solana/wallet-adapter-react-ui/styles.css'

const network =
 CLUSTER === 'mainnet-beta' ? WalletAdapterNetwork.Mainnet
 : CLUSTER === 'testnet' ? WalletAdapterNetwork.Testnet
 : WalletAdapterNetwork.Devnet

// Localnet has no public cluster URL, so VITE_RPC_URL is required there.
const endpoint = import.meta.env.VITE_RPC_URL || (CLUSTER === 'localnet' ? 'http://127.0.0.1:8899' : clusterApiUrl(network))

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
 appIdentity: { name: 'Solana Potato', uri: typeof window !== 'undefined' ? window.location.origin : 'https://play.pages.dev' },
 authorizationResultCache: createDefaultAuthorizationResultCache(),
 chain: CLUSTER as 'devnet' | 'testnet' | 'mainnet-beta',
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
     <h1>💥 Игра упала</h1>
     <p>{this.state.error.message}</p>
     <pre style={{ fontSize: 11, opacity: 0.7 }}>{this.state.error.stack}</pre>
     <button onClick={() => window.location.reload()}>Перезагрузить</button>
    </div>
   )
  }
  return this.props.children
 }
}

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
