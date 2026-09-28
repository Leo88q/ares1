/**
 * Self-hosted webfonts (production-deploy checklist §4.6, §3.8.4).
 *
 * Replaces the previous <link> to a third-party font CDN in index.html. That
 * request disclosed every visitor's IP address to the provider before any
 * consent could be given — the pattern a German court held unlawful in
 * Jan 2022 (LG München) — and it forced an extra origin into the CSP.
 *
 * The files are bundled from node_modules/@fontsource and served from our own
 * origin, so no third party observes the request.
 *
 * Why plain imports in a TS module instead of a CSS `@import` chain: Vite only
 * resolves bare package specifiers inside CSS `@import` from v6 onward, so a
 * fonts.css shim is not portable. Importing the stylesheets from TS is.
 *
 * Subsets: latin + latin-ext + cyrillic — every language the landing is
 * translated into (en, es-419, id, pt-BR, tl, vi) plus Russian. Adding a
 * language in another script means adding its subset here.
 *
 * Licence: SIL Open Font License 1.1. See /legal/third-party.html.
 */

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

// Oswald — display headings
import '@fontsource/oswald/latin-400.css'
import '@fontsource/oswald/latin-500.css'
import '@fontsource/oswald/latin-600.css'
import '@fontsource/oswald/latin-700.css'
import '@fontsource/oswald/cyrillic-400.css'
import '@fontsource/oswald/cyrillic-500.css'
import '@fontsource/oswald/cyrillic-600.css'
import '@fontsource/oswald/cyrillic-700.css'

// JetBrains Mono — numbers, addresses, code
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import '@fontsource/jetbrains-mono/cyrillic-400.css'
import '@fontsource/jetbrains-mono/cyrillic-500.css'
import '@fontsource/jetbrains-mono/cyrillic-600.css'
import '@fontsource/jetbrains-mono/cyrillic-700.css'

export {}
