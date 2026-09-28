/**
 * Consent-gated browser storage (production-deploy checklist §4.1–§4.5).
 *
 * Design decisions, stated so they can be argued with:
 *
 * 1. NOTHING non-essential is stored before the user has chosen. The module
 *    exposes getItem/setItem/removeItem; a write to a category that has not
 *    been granted is dropped and the value is kept in memory for this page
 *    view only. That is what "prior consent" means in practice.
 *
 * 2. Only `necessary` is on by default and it cannot be switched off. It holds
 *    the consent record itself and nothing else — a consent banner that needs
 *    consent to store consent is a paradox.
 *
 * 3. `functional` (language, sound, haptics, tutorial, wallet-reconnect flag,
 *    LUT cache) is OFF until granted. The site works without it: the user just
 *    re-picks the language and sees the tutorial again. Everything in this
 *    category is data the user typed or chose, on their own device.
 *
 * 4. `analytics` and `marketing` have no implementation today. The categories
 *    exist and are wired so that adding a script later is impossible without
 *    passing through `onGranted('analytics', ...)`. A category that cannot be
 *    enforced is a category that will be violated.
 *
 * 5. Global Privacy Control (§4.8) is honoured: if the browser sends
 *    `Sec-GPC: 1` / `navigator.globalPrivacyControl === true`, non-essential
 *    categories are treated as rejected from the start.
 *
 * 6. Withdrawing consent deletes the data for that category at once, on the
 *    device. It cannot un-send a request that already happened — which is
 *    exactly why consent must come first.
 *
 * 7. The record is versioned. Bump CONSENT_VERSION when the Cookie Policy
 *    changes materially and the banner is shown again (§4.4).
 */

export type ConsentCategory = 'necessary' | 'functional' | 'analytics' | 'marketing'

export const CONSENT_VERSION = 1
/** Ask again after this long even if the user answered (§4.4: 6–12 months). */
export const CONSENT_MAX_AGE_DAYS = 365

const STORAGE_KEY = 'ares1.consent.v1'

export interface ConsentRecord {
  version: number
  /** ISO timestamp of the choice. */
  decidedAt: string
  /** Short random id so the operator can point to a specific decision (§4.4). */
  decisionId: string
  categories: Record<ConsentCategory, boolean>
  /** True when the choice was forced by GPC rather than made by the user. */
  viaGpc: boolean
}

type Listener = (record: ConsentRecord | null) => void

const listeners = new Set<Listener>()

/**
 * Keys owned by each category. Used to erase data on withdrawal — a category
 * without a key list is a promise you cannot keep.
 */
const KEY_PREFIXES: Record<ConsentCategory, readonly string[]> = {
  necessary: [STORAGE_KEY],
  // Verified against the codebase on 2026-09-28 by grepping every
  // localStorage/sessionStorage call site. Adding a new key here is mandatory
  // when you add a new storage write — otherwise withdrawing consent leaves
  // data behind and the promise in the Cookie Policy becomes false.
  functional: [
    'ares1_lang',
    'wallet_connected',
    'potato_tutorial_done',
    'potato_landed',
    'ares-lut:',
    'potato_notifications',
    'potato_last_notified',
    'potato_music',
    'potato_music_volume',
    'haptics_enabled',
    'ares_ref_registered',
    'ares_ref_link',
    'ares1_gamification',
  ],
  analytics: [],
  marketing: [],
}

// ---------------------------------------------------------------------------
// Storage primitives (never throw: private mode, quota, disabled storage)
// ---------------------------------------------------------------------------

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — the in-memory fallback below still serves this view */
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function safeKeys(): string[] {
  try {
    return Object.keys(window.localStorage)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Global Privacy Control (§4.8)
// ---------------------------------------------------------------------------

function gpcEnabled(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return nav.globalPrivacyControl === true
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cached: ConsentRecord | null | undefined

function isValid(value: unknown): value is ConsentRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Partial<ConsentRecord>
  return (
    r.version === CONSENT_VERSION &&
    typeof r.decidedAt === 'string' &&
    !!r.categories &&
    typeof r.categories === 'object'
  )
}

function isFresh(record: ConsentRecord): boolean {
  const decided = Date.parse(record.decidedAt)
  if (Number.isNaN(decided)) return false
  const ageDays = (Date.now() - decided) / 86_400_000
  return ageDays < CONSENT_MAX_AGE_DAYS
}

function randomId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  } catch {
    return Math.random().toString(36).slice(2, 18)
  }
}

export function readConsent(): ConsentRecord | null {
  if (cached !== undefined) return cached
  const raw = safeGet(STORAGE_KEY)
  if (!raw) {
    cached = null
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isValid(parsed) || !isFresh(parsed)) {
      // A record from an older policy version does not carry forward: the user
      // never agreed to the current one.
      safeRemove(STORAGE_KEY)
      cached = null
      return null
    }
    cached = parsed
    return cached
  } catch {
    safeRemove(STORAGE_KEY)
    cached = null
    return null
  }
}

export function hasDecided(): boolean {
  return readConsent() !== null
}

export function isGranted(category: ConsentCategory): boolean {
  if (category === 'necessary') return true
  const record = readConsent()
  if (!record) return false
  return record.categories[category] === true
}

function notify(): void {
  for (const listener of listeners) listener(readConsent())
}

export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function erase(category: ConsentCategory): void {
  const prefixes = KEY_PREFIXES[category]
  for (const key of safeKeys()) {
    if (key === STORAGE_KEY) continue
    if (prefixes.some((p) => key.startsWith(p))) safeRemove(key)
  }
}

/**
 * Record a decision. Revoked categories are erased immediately — a toggle that
 * leaves the old data behind is theatre.
 */
export function setConsent(
  categories: Record<ConsentCategory, boolean>,
  options: { viaGpc?: boolean } = {},
): ConsentRecord {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    decisionId: randomId(),
    categories: {
      necessary: true, // not negotiable; it is the record of this decision
      functional: !!categories.functional,
      analytics: !!categories.analytics,
      marketing: !!categories.marketing,
    },
    viaGpc: !!options.viaGpc,
  }
  cached = record
  safeSet(STORAGE_KEY, JSON.stringify(record))

  for (const category of ['functional', 'analytics', 'marketing'] as const) {
    if (!record.categories[category]) erase(category)
  }
  notify()
  return record
}

export const acceptAll = () =>
  setConsent({ necessary: true, functional: true, analytics: true, marketing: true })

export const rejectAll = () =>
  setConsent({ necessary: true, functional: false, analytics: false, marketing: false })

/**
 * Apply GPC once, on first load, if the user has not decided yet. Deliberately
 * does not overwrite an explicit user decision: GPC is a default, not a veto.
 */
export function applyGpcDefault(): void {
  if (hasDecided()) return
  if (!gpcEnabled()) return
  setConsent({ necessary: true, functional: false, analytics: false, marketing: false }, { viaGpc: true })
}

// ---------------------------------------------------------------------------
// Consent-gated storage
// ---------------------------------------------------------------------------

/**
 * In-memory fallback for the current page view: without it, rejecting
 * `functional` storage would make the language switcher and the sound toggle
 * look broken rather than merely non-persistent.
 */
const memory = new Map<string, string>()

export function getItem(category: ConsentCategory, key: string): string | null {
  if (isGranted(category)) return safeGet(key)
  return memory.has(key) ? (memory.get(key) as string) : null
}

export function setItem(category: ConsentCategory, key: string, value: string): void {
  memory.set(key, value)
  if (isGranted(category)) safeSet(key, value)
}

export function removeItem(category: ConsentCategory, key: string): void {
  memory.delete(key)
  if (isGranted(category)) safeRemove(key)
}

/**
 * Run `fn` only when `category` has been granted, and re-run it if consent is
 * granted later in the same session. This is the only supported way to load a
 * third-party script (§3.8.4, §4.3).
 */
export function onGranted(category: ConsentCategory, fn: () => void): () => void {
  let done = false
  const run = () => {
    if (done) return
    if (!isGranted(category)) return
    done = true
    fn()
  }
  run()
  const unsubscribe = subscribeConsent(run)
  return () => {
    unsubscribe()
  }
}
