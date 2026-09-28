/**
 * Shared behaviour for the ARES-1 legal documents.
 *
 * Deliberately small and dependency-free. It does three things:
 *   1. Language switching (RU / EN). Both languages are in the HTML, so the
 *      page is readable and archivable without JavaScript.
 *   2. Highlights every unresolved operator placeholder (span.todo), so a
 *      missing legal-entity name or address cannot ship unnoticed.
 *   3. Wires the "cookie settings" button, which must be reachable from every
 *      page — withdrawing consent has to be as easy as giving it (§4.3).
 *
 * No analytics, no network calls, no third-party script.
 */
(function () {
  'use strict';

  var STORAGE_LANG = 'ares1.legal.lang';
  var SUPPORTED = ['ru', 'en'];

  function readStoredLang() {
    try {
      var v = localStorage.getItem(STORAGE_LANG);
      return SUPPORTED.indexOf(v) !== -1 ? v : null;
    } catch (e) {
      return null; // private mode / storage disabled
    }
  }

  function storeLang(lang) {
    try {
      localStorage.setItem(STORAGE_LANG, lang);
    } catch (e) {
      /* non-fatal: the choice just will not persist */
    }
  }

  function detectLang() {
    // ?lang= wins (shareable links), then the saved choice, then the browser.
    var q = new URLSearchParams(window.location.search).get('lang');
    if (q && SUPPORTED.indexOf(q.toLowerCase()) !== -1) return q.toLowerCase();
    var stored = readStoredLang();
    if (stored) return stored;
    var nav = (navigator.language || 'en').toLowerCase();
    return nav.indexOf('ru') === 0 ? 'ru' : 'en';
  }

  function applyLang(lang) {
    document.body.setAttribute('data-active-lang', lang);
    document.documentElement.setAttribute('lang', lang);
    var buttons = document.querySelectorAll('.langswitch button');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang-value') === lang ? 'true' : 'false');
    });
    // Keep the URL shareable without adding a history entry.
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('lang', lang);
      window.history.replaceState(null, '', url);
    } catch (e) {
      /* file:// or an old browser — cosmetic only */
    }
  }

  function initLang() {
    var buttons = document.querySelectorAll('.langswitch button');
    if (!buttons.length) return;
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var lang = btn.getAttribute('data-lang-value');
        storeLang(lang);
        applyLang(lang);
      });
    });
    applyLang(detectLang());
  }

  /**
   * Unresolved placeholders are a launch blocker for the legal pages. Rendering
   * a visible banner makes it impossible to deploy them by accident; the build
   * check in scripts/check-release-artifacts.mjs does not inspect HTML content,
   * so this is the runtime safety net and the report lists them explicitly.
   */
  function flagPlaceholders() {
    var missing = document.querySelectorAll('span.todo');
    if (!missing.length) return;
    var banner = document.createElement('div');
    banner.className = 'panel';
    banner.setAttribute('role', 'status');
    banner.style.borderColor = '#ff8f6b';
    banner.innerHTML =
      '<strong>Draft — not cleared for launch.</strong> ' +
      missing.length +
      ' placeholder(s) on this page still need the operator’s real details. ' +
      'Replace every highlighted field before publishing.';
    var wrap = document.querySelector('.wrap');
    if (wrap && wrap.firstChild) wrap.insertBefore(banner, wrap.firstChild.nextSibling);
  }

  /**
   * "Cookie settings" must be available from every page (§4.3). The consent
   * module lives in the app bundle; if the app is not mounted (these pages are
   * static), fall back to linking back to the site with the settings intent.
   */
  function initCookieSettings() {
    var btn = document.getElementById('open-cookie-settings');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (window.ARES1_CONSENT && typeof window.ARES1_CONSENT.open === 'function') {
        window.ARES1_CONSENT.open();
        return;
      }
      // Static page: send the reader back to the app, which opens the panel.
      window.location.href = '/?cookie-settings=1';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initLang();
    flagPlaceholders();
    initCookieSettings();
  });
})();
