/**
 * Self-hosted webfonts (production-deploy checklist §4.6, §3.8.4).
 *
 * Replaces the old `@import url('<third-party font CDN>...')` at the top
 * of styles/global.css. A font request to Google's CDN discloses every player's
 * IP address to a third party before any consent exists — the pattern a German
 * court held unlawful in Jan 2022 (LG München) — and it forced
 * a font CDN origin into the CSP.
 *
 * The files are bundled from node_modules/@fontsource and served from our own
 * origin, so no third party observes the request.
 *
 * Why plain imports in a TS module instead of a CSS `@import` chain: Vite 5
 * does not resolve bare package specifiers inside CSS `@import`, so a
 * fonts.css shim breaks the build. Importing the stylesheets from TS is
 * portable across Vite versions.
 *
 * Subsets: latin + latin-ext + cyrillic, covering the languages this client
 * ships (en, es-419, id, pt-BR, tl, vi) plus Russian. Adding a language in
 * another script means adding its subset here.
 *
 * NOTE: styles/global.css declares `font-family: "Oswald", "Inter", ...` in two
 * places, but Oswald was never in the Google Fonts request either — browsers
 * have always fallen back to Inter. Oswald is deliberately NOT added here:
 * adding it would silently change the visual design. Design decision pending.
 *
 * Licence: SIL Open Font License 1.1. See the third-party notice linked from
 * the site footer (/legal/third-party.html on the public site).
 */

// DM Sans — wallet-adapter modal (was a remote Google Fonts @import upstream)
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-700.css'

// Oswald — display headings (condensed stencil, cyrillic included).
// Anton/Archivo Black stay loaded for latin-only accents but Russian titles
// now render in Oswald instead of silently falling back to Inter.
import '@fontsource/oswald/latin-500.css'
import '@fontsource/oswald/latin-600.css'
import '@fontsource/oswald/latin-700.css'
import '@fontsource/oswald/cyrillic-500.css'
import '@fontsource/oswald/cyrillic-600.css'
import '@fontsource/oswald/cyrillic-700.css'

// Anton — display
import '@fontsource/anton/latin-400.css'
import '@fontsource/anton/latin-ext-400.css'

// Archivo Black — display
import '@fontsource/archivo-black/latin-400.css'
import '@fontsource/archivo-black/latin-ext-400.css'

// Inter — UI text
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/inter/latin-800.css'
import '@fontsource/inter/latin-ext-400.css'
import '@fontsource/inter/latin-ext-500.css'
import '@fontsource/inter/latin-ext-600.css'
import '@fontsource/inter/latin-ext-700.css'
import '@fontsource/inter/latin-ext-800.css'
import '@fontsource/inter/cyrillic-400.css'
import '@fontsource/inter/cyrillic-500.css'
import '@fontsource/inter/cyrillic-600.css'
import '@fontsource/inter/cyrillic-700.css'
import '@fontsource/inter/cyrillic-800.css'

// JetBrains Mono — balances, addresses, code
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import '@fontsource/jetbrains-mono/cyrillic-500.css'
import '@fontsource/jetbrains-mono/cyrillic-700.css'

export {}
