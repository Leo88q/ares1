import './polyfills'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import {
 SolanaMobileWalletAdapter,
 createDefaultAddressSelector,
 createDefaultAuthorizationResultCache,
 createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-adapter-mobile'
import { clusterApiUrl } from '@solana/web3.js'
import App from './App'
import { SolanaProvider, CLUSTER } from './contexts/SolanaContext'
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
 new SolanaMobileWalletAdapter({
  addressSelector: createDefaultAddressSelector(),
  appIdentity: { name: 'Seeker Potato', uri: window.location.origin, icon: '/android-chrome-512x512.png' },
  authorizationResultCache: createDefaultAuthorizationResultCache(),
  cluster: network,
  onWalletNotFound: createDefaultWalletNotFoundHandler(),
 }),
]

ReactDOM.createRoot(document.getElementById('root')!).render(
 <React.StrictMode>
  <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
   <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
    <WalletProvider wallets={wallets} autoConnect>
     <WalletModalProvider>
      <SolanaProvider>
       <App />
      </SolanaProvider>
     </WalletModalProvider>
    </WalletProvider>
   </ConnectionProvider>
  </BrowserRouter>
 </React.StrictMode>,
)
