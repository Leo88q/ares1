import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import BackgroundScene from './components/BackgroundScene'
import GrainOverlay, { MkRoughFilters } from './components/GrainOverlay'
import PageTransition from './components/PageTransition'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { WalletErrorReporter } from './components/WalletErrorReporter'
import { GameProvider } from './contexts/GameContext'
import { t, useI18n } from './i18n'
import { ambientMusic } from './utils/ambientMusic'
import { useReferralRegistration } from './hooks/useReferralRegistration'
import { AresBottomNav } from './components/ares/AresBottomNav'
import { SectionFrame } from './components/ares/SectionFrame'
import type { AresTab } from './components/ares/AresBottomNav'
import { HullSkinMounter } from './ui/HullSkinMounter'
import { CookieConsent } from './components/CookieConsent'
import './ui/hull-ui.css'
import './styles/seeker-touch.css'
import './ui/prize-reveal.css'

// Route-level code splitting: each screen is its own chunk.
const MainScreen = lazy(() => import('./components/MainScreen'))
const MarketScreen = lazy(() => import('./components/MarketScreen'))
const StatsScreen = lazy(() => import('./components/StatsScreen'))
const ProfileScreen = lazy(() => import('./components/ProfileScreen'))
const OperationScreen = lazy(() => import('./components/OperationScreen'))
const FieldLabScreen = lazy(() => import('./lab/FieldLabScreen'))
const ColonyStatusScreen = lazy(() => import('./components/ColonyStatusScreen'))

type Screen = 'farm' | 'lab' | 'colony' | 'market' | 'stats' | 'profile' | 'operation'

export default function App() {
 const { lang } = useI18n()
 useReferralRegistration()

 useEffect(() => {
  ambientMusic.init()
 }, [])

 useEffect(() => {
  document.title = t('Solana Potato — фарм-игра на Solana')
  document.querySelector('meta[name="description"]')?.setAttribute(
   'content',
   t('Solana Potato — игра с on-chain-полями в Solana devnet. Тестовые токены не имеют денежной стоимости, а devnet-прогресс не переносится в mainnet.'),
  )
  document.documentElement.lang = lang === 'es-419' ? 'es' : lang
 }, [lang])

 return (
  <div className="pf-app-bg">
   <GrainOverlay />
   <MkRoughFilters />
   <HullSkinMounter />
   <div className="pf-phone-chassis">
    <BackgroundScene />
    <div style={{ position: 'relative', minHeight: '100vh', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
     <ErrorBoundary>
      <ToastProvider>
       <WalletErrorReporter />
       <CookieConsent />
       <GameProvider>
        <AppRoutes />
       </GameProvider>
      </ToastProvider>
     </ErrorBoundary>
    </div>
   </div>
  </div>
 )
}

function ScreenFallback() {
 return (
  <div style={{ padding: 20 }} aria-busy="true">
   {Array.from({ length: 3 }).map((_, i) => (
    <div key={i} className="mk-skel" style={{ height: 120, marginBottom: 12 }} />
   ))}
  </div>
 )
}

function AppRoutes() {
 const navigate = useNavigate()
 const location = useLocation()

 const currentScreen: Screen =
  location.pathname === '/lab' ? 'lab'
  : location.pathname === '/market' ? 'market'
  : location.pathname === '/stats' ? 'stats'
  : location.pathname === '/profile' ? 'profile'
  : location.pathname === '/operation' ? 'operation'
  : location.pathname === '/base' || location.pathname === '/colony' ? 'colony'
  : 'farm'

 const handleNavigate = (screen: Screen) => navigate(screen === 'farm' ? '/' : screen === 'colony' ? '/base' : `/${screen}`)

 return (
  <>
   <main id="main">
    <PageTransition>
     <Suspense fallback={<ScreenFallback />}>
      <Routes location={location}>
       <Route path="/" element={<MainScreen />} />
       <Route path="/lab" element={<FieldLabScreen />} />
       <Route path="/base" element={<ColonyStatusScreen />} />
       <Route path="/colony" element={<Navigate to="/base" replace />} />
       <Route path="/market" element={<MarketScreen />} />
       <Route path="/stats" element={<StatsScreen />} />
       <Route path="/profile" element={<ProfileScreen />} />
       <Route path="/operation" element={<SectionFrame section="journal" label={t('ОПЕРАЦИЯ: ПЕРВАЯ ТЕПЛИЦА')}><OperationScreen /></SectionFrame>} />
       {/* Backward compatibility: the former demo URL opens the live field console. */}
       <Route path="/demo" element={<Navigate to="/lab" replace />} />
       <Route path="*" element={<MainScreen />} />
      </Routes>
     </Suspense>
    </PageTransition>
   </main>
   <AresBottomNav
    active={currentScreen === 'farm' ? 'main' : currentScreen}
    onChange={(tab: AresTab) => handleNavigate(tab === 'main' ? 'farm' : tab)}
   />
  </>
 )
}
