// Test-only Field Lab harness. The local field records below are isolated
// fixture data for browser tests; the shipped UI has no wallet-free bench,
// colony provider, local resource ledger, or transaction-capable wallet.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

/**
 * @param {object} [options]
 * @param {boolean} [options.connected] — true renders mock wallet fields;
 *   false renders the real no-wallet empty state (never training fields).
 * @param {number} [options.fields] — number of fixture fields when connected.
 * @param {string} [options.slug] — unique asset prefix for concurrent smokes.
 */
export async function labFixture({ connected = false, fields: fieldCount = 2, slug = 'lab' } = {}) {
  const prefix = `/__${slug}/`
  const { build } = require('esbuild')
  const repo = fileURLToPath(new URL('../../../../', import.meta.url))
  const src = fileURLToPath(new URL('../src/', import.meta.url))
  mkdirSync(join(repo, '.cache'), { recursive: true })
  const dir = mkdtempSync(join(repo, '.cache/lab-fixture-'))
  const game = join(dir, 'game.tsx'), solana = join(dir, 'solana.tsx'), market = join(dir, 'market.ts')

  writeFileSync(game, `
import { useSyncExternalStore } from 'react';
import { PublicKey } from '@solana/web3.js';
const listeners = new Set();
const owner = new PublicKey(new Uint8Array(32).fill(9));
const keys = Array.from({ length: ${fieldCount} }, (_, i) => new PublicKey(new Uint8Array(32).fill(i + 1)));
let fields = ${connected} ? keys.map((publicKey, i) => ({ publicKey, owner, level: i ? 8 : 1, durability: 82, lastHarvest: 0, taxPaidUntil: 0, fertilizerUntil: 0, isActive: true, fieldType: i, mutationType: 0, accumulated: 200000 })) : [];
window.__fieldCalls = []; window.__fieldKeys = keys.map(key => key.toString());
const change = () => { snapshot = make(); listeners.forEach(fn => fn()); };
const action = name => async key => {
  window.__fieldCalls.push([name, key.toString()]);
  fields = fields.map(field => field.publicKey.equals(key) ? { ...field,
    ...(name === 'upgrade' ? { level: field.level + 1 } : {}),
    ...(name === 'harvest' ? { accumulated: 0 } : {}),
    ...(name === 'repair' ? { durability: 100 } : {}),
    ...(name === 'tax' ? { taxPaidUntil: Math.floor(Date.now() / 1000) + 604800 } : {}),
    ...(name === 'fertilizer' ? { fertilizerUntil: Math.floor(Date.now() / 1000) + 86400 } : {}),
  } : field); change(); return true;
};
const make = () => ({
  fields,
  stats: { totalFields: fields.length, maxFieldLevel: 8, pendingHarvest: 400000, playerLevel: 1, experience: 0, potatoBalance: 100000000000, skrBalance: 250 },
  harvest: action('harvest'), upgradeField: action('upgrade'), repairField: action('repair'),
  payTax: action('tax'), applyFertilizer: action('fertilizer'),
  loading: false, fieldsError: null, purchasing: false, reload: async () => {},
});
let snapshot = make();
window.__reorderFields = () => { fields = [...fields].reverse(); change(); };
window.__removeSelected = () => { fields = fields.filter(field => !field.publicKey.equals(keys[1])); change(); };
window.__dropWalletFields = () => { fields = []; change(); };
export function useGame() { return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => snapshot); }
`)

  writeFileSync(solana, `
import { PublicKey } from '@solana/web3.js';
const owner = new PublicKey(new Uint8Array(32).fill(9));
export function useSolana() {
  return ${connected}
    ? { ready: true, connected: true, rpcError: null, publicKey: owner,
        config: { baseYieldMicroPerDay: 1000000, globalMultiplierBps: 10000, epochId: 7 } }
    : { ready: true, connected: false, rpcError: null, publicKey: null, config: null };
}
`)

  writeFileSync(market, `
export function useMarketplace() {
  return {
    orders: [
      { id: 'a', priceLamportsPerPotato: 900, amountMicro: 1000000, isOwn: false, totalLamports: 900 },
      { id: 'b', priceLamportsPerPotato: 1200, amountMicro: 2500000, isOwn: false, totalLamports: 3000 },
      { id: 'c', priceLamportsPerPotato: 1500, amountMicro: 500000, isOwn: true, totalLamports: 750 },
    ],
    myOrders: [],
    stats: { sellVolume24h: 1200, buyVolume24h: 900, totalSolVolume: 12.5, totalTrades: 7 },
    loading: false, actionLoading: false, error: null,
    createOrder: async () => {}, fillOrder: async () => {}, cancelOrder: async () => {}, reload: async () => {},
  };
}
`)

  const entry = join(dir, 'entry.tsx')
  writeFileSync(entry, `
import React from 'react'; import { createRoot } from 'react-dom/client';
import '${src}/polyfills'; import '${src}/i18n/dicts'; import '${src}/fonts';
import '${src}/theme/tokens.css'; import '${src}/styles/global.css'; import '${src}/styles/kit.css'; import '${src}/index.css'; import '${src}/ui/hull-ui.css';
import { setLang } from '${src}/i18n';
import { ToastProvider } from '${src}/components/Toast';
import FieldLabScreen from '${src}/lab/FieldLabScreen';
window.__setLang = setLang;
createRoot(document.getElementById('root')).render(
  <div className="pf-phone-chassis"><ToastProvider><FieldLabScreen /></ToastProvider></div>,
);
`)

  const result = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    outfile: join(dir, 'out/main.js'), publicPath: prefix, metafile: true, minify: true,
    jsx: 'automatic', loader: { '.woff2': 'file', '.woff': 'file' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    nodePaths: [resolve(src, '../../../node_modules')],
    plugins: [{ name: 'lab-provider-spies', setup(builder) {
      builder.onResolve({ filter: /contexts\/(GameContext|SolanaContext)$/ }, args => ({ path: args.path.endsWith('GameContext') ? game : solana }))
      builder.onResolve({ filter: /hooks\/useMarketplace$/ }, () => ({ path: market }))
      builder.onResolve({ filter: /^\/(ares|sfx|models)\// }, args => ({ path: args.path, external: true }))
    } }],
  })
  const assets = new Map()
  for (const path of Object.keys(result.metafile.outputs)) {
    const full = resolve(path), name = basename(path)
    assets.set(`${prefix}${name}`, { bytes: readFileSync(full), type: name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : name.endsWith('.woff2') ? 'font/woff2' : 'font/woff' })
  }
  assets.set(`${prefix}main`, { bytes: Buffer.from(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${prefix}main.css"></head><body><div id="root"></div><script type="module" src="${prefix}main.js"></script></body></html>`), type: 'text/html' })
  return { assets, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
