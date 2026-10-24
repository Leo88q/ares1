import { getItem, setItem } from './utils/consent'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import InteractiveTutorial from './components/InteractiveTutorial'
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
import { ColonyProvider } from './colony/ColonyContext'
import { SectionFrame } from './components/ares/SectionFrame'
import type { AresTab } from './components/ares/AresBottomNav'
import { LandingSequence } from './components/ares/loading'
import './ui/hull-ui.css'
import './styles/seeker-touch.css'
import './ui/prize-reveal.css'
import { HullSkinMounter } from './ui/HullSkinMounter'
import { CookieConsent } from './components/CookieConsent'

// Route-level code splitting: each screen is its own chunk.
const MainScreen = lazy(() => import('./components/MainScreen'))
const MarketScreen = lazy(() => import('./components/MarketScreen'))
const StatsScreen = lazy(() => import('./components/StatsScreen'))
const ProfileScreen = lazy(() => import('./components/ProfileScreen'))
const OperationScreen = lazy(() => import('./components/OperationScreen'))
// АГРО: настоящие поля. ЛАБ: продуктовая полевая лаборатория. КОЛОНИЯ: 3D-база.
// Все три читают один стор колонии (ColonyProvider), поэтому ресурсы секций не расходятся.
const FieldLabScreen = lazy(() => import('./lab/FieldLabScreen'))
const ColonyScreen = lazy(() => import('./colony/ColonyScreen'))

type Screen = 'farm' | 'lab' | 'colony' | 'market' | 'stats' | 'profile' | 'operation'

export default function App() {
 const { lang } = useI18n()
 const [showTutorial, setShowTutorial] = useState(() => !getItem("functional", "potato_tutorial_done"))
 const [booted, setBooted] = useState(() => getItem("functional", "potato_landed") === "1")
 useReferralRegistration()

 // Фоновая музыка глобальная: запускается один раз на всю игру
 useEffect(() => {
  ambientMusic.init()
 }, [])

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
   <MkRoughFilters />
   <HullSkinMounter />

   {/* Телефонная подножка: центрированный корпус интерфейса колониста */}
   <div className="pf-phone-chassis">
    <BackgroundScene />
    <div style={{ position: 'relative', minHeight: '100vh', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
     <ErrorBoundary>
      <ToastProvider>
       <WalletErrorReporter />
       <CookieConsent />
       <GameProvider>
        {showTutorial && <InteractiveTutorial onComplete={() => setShowTutorial(false)} />}
        {booted ? (
         <ColonyProvider>
          <AppRoutes />
         </ColonyProvider>
        ) : (
         <div style={{ minHeight: '100vh' }}>
          <LandingSequence
           onLanded={() => {
            setItem("functional", "potato_landed", "1")
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
  : location.pathname === '/base' ? 'colony'
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
       <Route path="/base" element={<ColonyScreen embedded />} />
       <Route path="/market" element={<MarketScreen />} />
       <Route path="/stats" element={<StatsScreen />} />
       <Route path="/profile" element={<ProfileScreen />} />
       <Route path="/operation" element={<SectionFrame section="journal" label={t('ОПЕРАЦИЯ: ПЕРВАЯ ТЕПЛИЦА')}><OperationScreen /></SectionFrame>} />
       {/* Песочница /demo заменена продуктовой лабораторией: старые ссылки ведут туда же. */}
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
