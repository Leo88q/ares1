import { isRateLimited } from './errors'

export interface RetryOptions {
 retries?: number
 baseDelayMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Retries an RPC call on 429 / transient network errors with exponential
 * backoff and jitter. Other errors are rethrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, { retries = 3, baseDelayMs = 700 }: RetryOptions = {}): Promise<T> {
 let attempt = 0
 for (;;) {
  try {
   return await fn()
  } catch (err) {
   const transient = isRateLimited(err) || /failed to fetch|network|ECONN|socket/i.test(String(err))
   if (!transient || attempt >= retries) throw err
   const delay = baseDelayMs * 2 ** attempt + Math.random() * 250
   await sleep(delay)
   attempt += 1
  }
 }
}

/** 8 random bytes as a u64 — used as PDA nonce for fields and orders. */
export function randomU64(): bigint {
 const bytes = new Uint8Array(8)
 crypto.getRandomValues(bytes)
 bytes[7] &= 0x7f
 return new DataView(bytes.buffer).getBigUint64(0, true)
}
