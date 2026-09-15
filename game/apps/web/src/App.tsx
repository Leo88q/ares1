import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import InteractiveTutorial from './components/InteractiveTutorial'
import BackgroundScene from './components/BackgroundScene'
import GrainOverlay from './components/GrainOverlay'
import PageTransition from './components/PageTransition'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { GameProvider } from './contexts/GameContext'
import { t, useI18n } from './i18n'

import { useReferralRegistration } from './hooks/useReferralRegistration'
import { AresBottomNav } from './components/ares/AresBottomNav'
import type { AresTab } from './components/ares/AresBottomNav'
import { LandingSequence } from './components/ares/loading'
import './ui/hull-ui.css'
import './ui/prize-reveal.css'
import { HullSkinMounter } from './ui/HullSkinMounter'

// Route-level code splitting: each screen is its own chunk.
const MainScreen = lazy(() => import('./components/MainScreen'))
const MarketScreen = lazy(() => import('./components/MarketScreen'))
const StatsScreen = lazy(() => import('./components/StatsScreen'))
const ProfileScreen = lazy(() => import('./components/ProfileScreen'))

type Screen = 'farm' | 'market' | 'stats' | 'profile'

export default function App() {
 const { lang } = useI18n()
 const [showTutorial, setShowTutorial] = useState(() => !localStorage.getItem('potato_tutorial_done'))
 const [booted, setBooted] = useState(() => localStorage.getItem('potato_landed') === '1')
 useReferralRegistration()

 // SEO-теги следуют за языком (title, description, html lang).
 useEffect(() => {
  document.title = t('Solana Potato — фарм-игра на Solana')
  document.querySelector('meta[name="description"]')?.setAttribute(
   'content',
   t('Solana Potato — on-chain фарм-игра. Покупай поля, собирай урожай $POTATO каждую секунду и торгуй на встроенном P2P-маркетплейсе за SOL.'),
  )
  document.documentElement.lang = lang === 'es-419' ? 'es' : lang
 }, [lang])

 return (
  <div className="pf-app-bg">
   <GrainOverlay />
   <HullSkinMounter />
   <BackgroundScene variant="farm" />
   <div style={{ maxWidth: 480, margin: '0 auto', position: 'relative', minHeight: '100vh', zIndex: 1 }}>
    <div className="ares-habitat-bg" aria-hidden="true" />
    <ErrorBoundary>
     <ToastProvider>
      <GameProvider>
       {showTutorial && <InteractiveTutorial onComplete={() => setShowTutorial(false)} />}
       {booted ? (
        <AppRoutes />
       ) : (
        <div style={{ minHeight: '100vh' }}>
         <LandingSequence
          onLanded={() => {
           localStorage.setItem('potato_landed', '1')
           setBooted(true)
          }}
         />
        </div>
       )}
             </GameProvider>
     </ToastProvider>
    </ErrorBoundary>
   </div>
  </div>
 )
}

function ScreenFallback() {
 return (
  <div style={{ padding: 20 }} aria-busy="true">
   {Array.from({ length: 3 }).map((_, i) => (
    <div key={i} className="pf-card hull-skin shimmer" style={{ height: 120, borderRadius: 16, marginBottom: 12 }} />
   ))}
  </div>
 )
}

function AppRoutes() {
 const navigate = useNavigate()
 const location = useLocation()

 const currentScreen: Screen =
  location.pathname === '/market' ? 'market'
  : location.pathname === '/stats' ? 'stats'
  : location.pathname === '/profile' ? 'profile'
  : 'farm'

 const handleNavigate = (screen: Screen) => navigate(screen === 'farm' ? '/' : `/${screen}`)

 return (
  <>
   <main id="main">
    <PageTransition>
     <Suspense fallback={<ScreenFallback />}>
      <Routes location={location}>
       <Route path="/" element={<MainScreen />} />
       <Route path="/market" element={<MarketScreen />} />
       <Route path="/stats" element={<StatsScreen />} />
       <Route path="/profile" element={<ProfileScreen />} />
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
