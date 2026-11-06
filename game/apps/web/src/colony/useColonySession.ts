// Вход по кошельку для API колонии: одноразовый challenge, подпись, токен сессии.
// Подпись не переводит токены и не отправляет транзакцию. Общий вход для серверной симуляции колонии.
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { BACKEND_URL, CLUSTER } from '../contexts/SolanaContext'

interface AuthResult { token: string; wallet: string; cluster: string; expiresInSeconds: number }

export interface ColonySessionState {
  connected: boolean
  /** Кошелёк умеет подписывать сообщения. */
  canSign: boolean
  walletAddress: string | null
  /** Токен действует только для адреса, с которым вошли. */
  token: string | null
  wallet: string | null
  busy: boolean
  /** Код ошибки входа (например AUTH_FAILED) или NO_SIGN_MESSAGE. */
  error: string | null
  signIn: () => Promise<boolean>
  signOut: () => void
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function authPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BACKEND_URL}/api/colonies${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`)
  return payload
}

export function useColonySession(): ColonySessionState {
  const wallet = useWallet()
  const publicKey = wallet.publicKey
  const walletAddress = publicKey?.toBase58() ?? null
  const [token, setToken] = useState<string | null>(null)
  const [authWallet, setAuthWallet] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Смена кошелька сбрасывает сессию: токен выдан на другой адрес.
  useEffect(() => {
    if (authWallet !== walletAddress) {
      setToken(null)
      setAuthWallet(null)
    }
  }, [authWallet, walletAddress])

  const signIn = useCallback(async (): Promise<boolean> => {
    if (!publicKey || !wallet.signMessage) {
      setError('NO_SIGN_MESSAGE')
      return false
    }
    setBusy(true)
    setError(null)
    try {
      const challenge = await authPost<{ challengeId: string; message: string; expiresAt: string }>(
        '/auth/challenge', { wallet: publicKey.toBase58() },
      )
      const signature = await wallet.signMessage(new TextEncoder().encode(challenge.message))
      const session = await authPost<AuthResult>('/auth/verify', {
        wallet: publicKey.toBase58(),
        challengeId: challenge.challengeId,
        message: challenge.message,
        signature: base64Url(signature),
      })
      if (session.cluster !== CLUSTER) throw new Error('CLUSTER_MISMATCH')
      setToken(session.token)
      setAuthWallet(session.wallet)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AUTH_FAILED')
      return false
    } finally {
      setBusy(false)
    }
  }, [publicKey, wallet.signMessage])

  const signOut = useCallback(() => {
    setToken(null)
    setAuthWallet(null)
  }, [])

  const active = token !== null && authWallet === walletAddress
  return {
    connected: wallet.connected,
    canSign: wallet.connected && !!wallet.signMessage,
    walletAddress,
    token: active ? token : null,
    wallet: active ? authWallet : null,
    busy,
    error,
    signIn,
    signOut,
  }
}
