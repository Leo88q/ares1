import { Component, ErrorInfo, ReactNode } from 'react'
import { t } from '../i18n'


interface Props {
 children: ReactNode
}

interface State {
 error: Error | null
}

/** Last line of defence: shows a reload card instead of a white screen. */
export default class ErrorBoundary extends Component<Props, State> {
 state: State = { error: null }

 static getDerivedStateFromError(error: Error): State {
  return { error }
 }

 componentDidCatch(error: Error, info: ErrorInfo) {
  console.error('Unhandled UI error', error, info.componentStack)
 }

 render() {
  if (!this.state.error) return this.props.children
  return (
   <div role="alert" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <div className="pf-card hull-skin" style={{ maxWidth: 360, padding: 28, borderRadius: 24, textAlign: 'center' }}>
     <div className="ares-stencil" style={{ fontSize: 30, marginBottom: 12, color: 'var(--ares-hud-amber, #FFB347)', textShadow: '0 0 16px rgba(255,179,71,0.4)' }}>POTATO</div>
     <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t("Что-то пошло не так")}</h2>
     <p style={{ fontSize: 13, color: 'var(--pf-text-secondary)', marginBottom: 16, wordBreak: 'break-word' }}>{this.state.error.message}</p>
     <button
      onClick={() => window.location.reload()}
      className="gradient-primary"
      style={{ width: '100%', padding: 12, borderRadius: 12, color: 'var(--ares-parchment, #F2E8DA)', fontWeight: 700 }}
     >
      {t('Перезагрузить')}
     </button>
    </div>
   </div>
  )
 }
}
