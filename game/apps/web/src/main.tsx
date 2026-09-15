import './polyfills'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
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

const wallets = [
 new PhantomWalletAdapter(),
 new SolflareWalletAdapter(),

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
    <WalletProvider wallets={wallets} autoConnect>
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
