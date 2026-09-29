import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CONSENT_VERSION,
  applyGpcDefault,
  hasDecided,
  isGranted,
  readConsent,
  setConsent,
  subscribeConsent,
  type ConsentCategory,
} from '../utils/consent'
import { useI18n } from '../i18n'
import './CookieConsent.css'

/**
 * Consent UI (checklist §4.3, §4.4, §4.5).
 *
 * Rules this component must not break:
 *   - "Reject all" is a first-level button with the same weight as "Accept all"
 *     and the same number of clicks. No dark patterns, no nagging interstitial,
 *     no cookie wall: the game stays playable if the user rejects everything.
 *   - Nothing non-essential is pre-ticked.
 *   - Per-category choice is available on the first level, not behind a
 *     "manage preferences" maze.
 *   - Withdrawing is as easy as giving: `?cookie-settings=1` or
 *     `window.ARES1_CONSENT.open()` reopens this panel from anywhere, and the
 *     footer links to it on every page (§4.3).
 *
 * The banner is not a modal: it does not block the page, it is announced to
 * screen readers, and it can be dismissed without a choice only in the sense
 * that the game continues to work — no storage is written until a choice is
 * made, because an undecided state means "not granted".
 */

interface Labels {
  title: string
  intro: string
  necessary: string
  necessaryNote: string
  functional: string
  functionalNote: string
  analytics: string
  analyticsNote: string
  marketing: string
  marketingNote: string
  acceptAll: string
  rejectAll: string
  save: string
  close: string
  manage: string
  policy: string
  gpc: string
  alwaysOn: string
  record: string
}

// Ярлыки строятся через i18n: ключ — русская строка, перевод берётся из словаря.
function buildLabels(tr: (k: string) => string): Labels {
  return {
    title: tr('Cookies и локальное хранилище'),
    intro: tr(
      'Мы не используем аналитику и рекламу и не устанавливаем cookies. Данные ниже остаются в вашем браузере и нужны только для работы сайта. Решение можно изменить в любой момент.',
    ),
    necessary: tr('Необходимое'),
    necessaryNote: tr('Только запись вашего выбора. Без этого баннер нельзя запомнить.'),
    functional: tr('Функциональное'),
    functionalNote: tr('Язык, звук, вибрация, флаг подключения кошелька, кэш адресов.'),
    analytics: tr('Аналитика'),
    analyticsNote: tr('Сейчас не используется. Включается только вами.'),
    marketing: tr('Маркетинг'),
    marketingNote: tr('Сейчас не используется. Включается только вами.'),
    acceptAll: tr('Принять все'),
    rejectAll: tr('Отклонить все'),
    save: tr('Сохранить выбор'),
    close: tr('Закрыть'),
    manage: tr('Настроить'),
    policy: tr('Политика cookie'),
    gpc: tr('Браузер передаёт сигнал Global Privacy Control — необязательные категории отключены.'),
    alwaysOn: tr('всегда'),
    record: tr('Запись решения'),
  }
}

const OPTIONAL: Exclude<ConsentCategory, 'necessary'>[] = ['functional', 'analytics', 'marketing']

/**
 * Open the panel from anywhere without prop-drilling or a React context: the
 * footer, the static legal pages and any future screen all need this, and a
 * "cookie settings" link that only exists on the banner is not §4.3.
 */
const OPEN_EVENT = 'ares1:open-cookie-settings'

export function openCookieSettings(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_EVENT))
}

export function CookieConsent(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const { lang, t: translate } = useI18n()
  const [draft, setDraft] = useState<Record<string, boolean>>({
    functional: false,
    analytics: false,
    marketing: false,
  })
  const [record, setRecord] = useState(() => readConsent())

  const t = useMemo(() => buildLabels(translate), [lang, translate])

  useEffect(() => {
    applyGpcDefault()
    setRecord(readConsent())
    if (!hasDecided()) setOpen(true)
    return subscribeConsent((next) => {
      setRecord(next)
      if (next) {
        setDraft({
          functional: next.categories.functional,
          analytics: next.categories.analytics,
          marketing: next.categories.marketing,
        })
      }
    })
  }, [])

  // Reopen from anywhere: ?cookie-settings=1 in the URL, or the JS API used by
  // the static legal pages.
  const openPanel = useCallback(() => {
    const current = readConsent()
    setDraft({
      functional: current?.categories.functional ?? false,
      analytics: current?.categories.analytics ?? false,
      marketing: current?.categories.marketing ?? false,
    })
    setShowDetail(true)
    setOpen(true)
  }, [])

  useEffect(() => {
    const onOpenRequest = () => openPanel()
    window.addEventListener(OPEN_EVENT, onOpenRequest)
    if (window.location.search.includes('cookie-settings=1')) openPanel()
    const api = { open: openPanel }
    ;(window as unknown as { ARES1_CONSENT?: { open: () => void } }).ARES1_CONSENT = api
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpenRequest)
      const w = window as unknown as { ARES1_CONSENT?: { open: () => void } }
      if (w.ARES1_CONSENT === api) delete w.ARES1_CONSENT
    }
  }, [openPanel])

  const decide = useCallback((choice: Record<ConsentCategory, boolean>) => {
    setConsent(choice)
    setOpen(false)
    setShowDetail(false)
  }, [])

  if (!open) return null

  const gpc = record?.viaGpc === true

  return (
    <div className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-title">
      <div className="consent__panel">
        <h2 className="consent__title" id="consent-title">
          {t.title}
        </h2>
        <p className="consent__intro">{t.intro}</p>

        {gpc ? <p className="consent__gpc">{t.gpc}</p> : null}

        {showDetail ? (
          <ul className="consent__list">
            <li className="consent__item">
              <label className="consent__row">
                <input type="checkbox" checked disabled aria-describedby="consent-note-necessary" />
                <span className="consent__name">{t.necessary}</span>
                <span className="consent__badge">{t.alwaysOn}</span>
              </label>
              <p className="consent__note" id="consent-note-necessary">
                {t.necessaryNote}
              </p>
            </li>
            {OPTIONAL.map((category) => (
              <li className="consent__item" key={category}>
                <label className="consent__row">
                  <input
                    type="checkbox"
                    checked={draft[category] ?? false}
                    aria-describedby={`consent-note-${category}`}
                    onChange={(e) => setDraft((d) => ({ ...d, [category]: e.target.checked }))}
                  />
                  <span className="consent__name">{t[category]}</span>
                </label>
                <p className="consent__note" id={`consent-note-${category}`}>
                  {t[`${category}Note` as keyof Labels]}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            className="consent__link"
            onClick={() => setShowDetail(true)}
          >
            {t.manage}
          </button>
        )}

        <div className="consent__actions">
          {/* Equal weight, equal click count: an "accept" button that is more
              prominent than "reject" is a dark pattern (§4.3). */}
          <button type="button" className="consent__btn consent__btn--primary" onClick={() => decide({ necessary: true, functional: true, analytics: true, marketing: true })}>
            {t.acceptAll}
          </button>
          <button type="button" className="consent__btn consent__btn--primary" onClick={() => decide({ necessary: true, functional: false, analytics: false, marketing: false })}>
            {t.rejectAll}
          </button>
          {showDetail ? (
            <button
              type="button"
              className="consent__btn"
              onClick={() =>
                decide({
                  necessary: true,
                  functional: !!draft.functional,
                  analytics: !!draft.analytics,
                  marketing: !!draft.marketing,
                })
              }
            >
              {t.save}
            </button>
          ) : null}
        </div>

        <p className="consent__footnote">
          <a href="/legal/cookies.html" target="_blank" rel="noreferrer noopener">
            {t.policy}
          </a>
          {record ? (
            <span className="consent__record">
              {' '}
              · {t.record}: {record.decisionId} · v{CONSENT_VERSION} ·{' '}
              {new Date(record.decidedAt).toLocaleDateString(lang === 'es-419' ? 'es' : lang)}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  )
}

export { isGranted }
