import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

/**
 * The upstream MWA browser adapter injects a Google Fonts stylesheet at runtime.
 * Our UI already serves Inter locally, so strip only that upstream font link
 * while preserving the mobile-wallet handshake (including its localhost probe).
 * Assert the expected upstream block exists so dependency upgrades are reviewed.
 */
function localizeMobileWalletAdapterModal(): import('vite').Plugin {
  return {
    name: 'localize-mobile-wallet-adapter-modal',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/@solana-mobile/wallet-standard-mobile/lib/esm/index.browser.js')) return null
      const start = code.indexOf('const fonts = `')
      const end = start < 0 ? -1 : code.indexOf('\n`;', start)
      const block = start < 0 || end < 0 ? '' : code.slice(start, end + 3)
      if (!block.includes('https://fonts.googleapis.com') || !block.includes('https://fonts.gstatic.com')) {
        throw new Error('MWA modal font block changed upstream; review privacy and release-artifact policy before upgrading')
      }
      return { code: code.replace(block, 'const fonts = ``;').replaceAll('Inter Tight', 'Inter'), map: null }
    },
  }
}

/**
 * .env.example — единственный env-файл в git (политика .gitignore §1.3.1:
 * трекаются только credential-free примеры). Значения VITE_* по определению
 * публичны — они компилируются в браузерный бандл, — поэтому разобранный
 * .env.example можно использовать как явный последний рубеж для сборок,
 * в окружении которых переменные не заданы (Cloudflare Pages `ares1-play`
 * и любой другой CI).
 */
function parseEnvFile(filePath: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return {}
  }
  const parsed: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

export default defineConfig(({ mode }) => {
  // Приоритет Vite по умолчанию: process.env (шелл, CI, Cloudflare Pages) →
  // .env / .env.local / .env.[mode].
  const resolved = loadEnv(mode, projectRoot, 'VITE_')

  // Последний рубеж: публичные devnet-значения из .env.example. Подмена не
  // молчаливая — сборка громко печатает, что и откуда взяла (чеклист §2.3:
  // никакой тихой подмены адресов), а переменные окружения сохраняют
  // приоритет: заданные в Cloudflare/CI значения всегда выигрывают.
  const fellBack: Array<[string, string]> = []
  for (const [key, value] of Object.entries(parseEnvFile(join(projectRoot, '.env.example')))) {
    if (!value || resolved[key]) continue
    process.env[key] = value
    fellBack.push([key, value])
  }
  if (fellBack.length > 0) {
    console.warn(
      [
        '',
        '  ===============================================================',
        '  [ares1] В окружении сборки не заданы переменные:',
        `  [ares1]   ${fellBack.map(([key]) => key).join(', ')}`,
        '  [ares1] Использую публичные devnet-значения из .env.example:',
        ...fellBack.map(([key, value]) => `  [ares1]   ${key}=${value}`),
        '  [ares1] Переопределить: Cloudflare Pages → Settings →',
        '  [ares1] Environment variables (локально — apps/web/.env.local).',
        '  ===============================================================',
        '',
      ].join('\n'),
    )
  }

  return {
    plugins: [react(), localizeMobileWalletAdapterModal()],
    server: {
      port: 5175,
      host: true,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: false,
        },
      },
    },
    preview: {
      port: 4173,
      host: true,
      allowedHosts: true,
    },
    build: {
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          // Keep the heavy, rarely-changing vendors in their own long-cached chunks.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            motion: ['framer-motion'],
            solana: ['@solana/web3.js', '@solana/spl-token'],
            wallets: [
              '@solana/wallet-adapter-react',
              '@solana/wallet-adapter-react-ui',
              '@solana-mobile/wallet-adapter-mobile',
            ],
          },
        },
      },
    },
  }
})
