import { useEffect, useRef } from 'react'

/**
 * Runs `fn` immediately and then every `intervalMs` while `enabled`.
 * - Pauses while the tab is hidden and fires as soon as it becomes visible.
 * - Backs off (×2, up to ×8) after a failure so a rate-limited RPC recovers.
 * - Never overlaps two runs; cleans up on unmount.
 */
export function usePolling(fn: () => Promise<void>, intervalMs: number, enabled = true): void {
 const fnRef = useRef(fn)
 fnRef.current = fn

 useEffect(() => {
  if (!enabled) return
  let cancelled = false
  let running = false
  let delay = intervalMs
  let timer: number | undefined

  const schedule = () => {
   if (cancelled) return
   window.clearTimeout(timer)
   timer = window.setTimeout(tick, delay)
  }

  const tick = async () => {
   if (cancelled || running) return
   if (document.visibilityState === 'hidden') {
    schedule()
    return
   }
   running = true
   try {
    await fnRef.current()
    delay = intervalMs
   } catch {
    delay = Math.min(delay * 2, intervalMs * 8)
   } finally {
    running = false
    schedule()
   }
  }

  const onVisibility = () => {
   if (document.visibilityState === 'visible') void tick()
  }
  document.addEventListener('visibilitychange', onVisibility)
  void tick()

  return () => {
   cancelled = true
   window.clearTimeout(timer)
   document.removeEventListener('visibilitychange', onVisibility)
  }
 }, [intervalMs, enabled])
}
