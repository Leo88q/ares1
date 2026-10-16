// Test-only real MainScreen harness. Generated output lives in ignored .cache,
// never in the shipped app. Providers are replaced with local callback spies;
// no wallets/RPC/transactions can execute in this fixture.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

export async function mainFixture() {
  const { build } = require('esbuild')
  const repo = fileURLToPath(new URL('../../../../', import.meta.url))
  const src = fileURLToPath(new URL('../src/', import.meta.url))
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(repo, '.cache'), { recursive: true })
  const dir = mkdtempSync(join(repo, '.cache/field-main-fixture-'))
  const game = join(dir, 'game.tsx'), solana = join(dir, 'solana.tsx'), blank = join(dir, 'blank.tsx')
  writeFileSync(game, `
import { useSyncExternalStore } from 'react';
import { PublicKey } from '@solana/web3.js';
const listeners = new Set();
const owner = new PublicKey(new Uint8Array(32).fill(9));
const keys = [new PublicKey(new Uint8Array(32).fill(1)), new PublicKey(new Uint8Array(32).fill(2))];
let fields = keys.map((publicKey, i) => ({publicKey, owner, level:i?8:1, durability:82, lastHarvest:0, taxPaidUntil:0, fertilizerUntil:0, isActive:true, fieldType:i, mutationType:0, accumulated:200000}));
window.__fieldCalls = []; window.__fieldKeys = keys.map(key => key.toString());
const change = () => { snapshot = make(); listeners.forEach(fn=>fn()); };
const action = name => async key => {
 window.__fieldCalls.push([name,key.toString()]);
 fields = fields.map(field => field.publicKey.equals(key) ? {...field,
   ...(name==='upgrade'?{level:field.level+1}:{}),
   ...(name==='harvest'?{accumulated:0}:{}),
   ...(name==='repair'?{durability:100}:{}),
   ...(name==='tax'?{taxPaidUntil:Math.floor(Date.now()/1000)+604800}:{}),
   ...(name==='fertilizer'?{fertilizerUntil:Math.floor(Date.now()/1000)+86400}:{}),
 } : field); change(); return true;
};
const actions = {harvest:action('harvest'),upgradeField:action('upgrade'),repairField:action('repair'),payTax:action('tax'),applyFertilizer:action('fertilizer')};
const make = () => ({fields,stats:{totalFields:fields.length,maxFieldLevel:8,pendingHarvest:400000,playerLevel:1,experience:0,potatoBalance:100000000000,skrBalance:0},...actions,loading:false,fieldsError:null,purchasing:false,reload:async()=>{},purchaseField:async()=>false,batchHarvest:async()=>false,batchLimit:10,licenseActive:false});
let snapshot = make();
window.__reorderFields = () => { fields=[...fields].reverse();change(); };
window.__removeSelected = () => { fields=fields.filter(field=>!field.publicKey.equals(keys[1]));change(); };
export function useGame() { return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot); }
`)
  writeFileSync(solana, 'export function useSolana() { return {ready:true,connected:true,rpcError:null}; }')
  writeFileSync(blank, 'export default function Blank(){return null;}')
  const entry = join(dir, 'entry.tsx')
  writeFileSync(entry, `
import React from 'react'; import {createRoot} from 'react-dom/client';
import '${src}/polyfills';import '${src}/i18n/dicts';import '${src}/fonts';
import '${src}/theme/tokens.css';import '${src}/styles/global.css';import '${src}/styles/kit.css';import '${src}/index.css';import '${src}/ui/hull-ui.css';
import MainScreen from '${src}/components/MainScreen';
createRoot(document.getElementById('root')).render(<div className="pf-phone-chassis"><MainScreen/></div>);
`)
  const result = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    outfile: join(dir, 'out/main.js'), publicPath: '/__fields/', metafile: true, minify: true,
    jsx: 'automatic', loader: { '.woff2': 'file', '.woff': 'file' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    nodePaths: [resolve(src, '../../../node_modules')],
    plugins: [{ name: 'local-provider-spies', setup(builder) {
      builder.onResolve({ filter: /contexts\/(GameContext|SolanaContext)$/ }, args => ({ path: args.path.endsWith('GameContext') ? game : solana }))
      builder.onResolve({ filter: /\.\/(PresaleSection|Header|CaseReveal)$/ }, () => ({ path: blank }))
      builder.onResolve({ filter: /^\/(ares|sfx|models)\// }, args => ({ path: args.path, external: true }))
    } }],
  })
  const assets = new Map()
  for (const path of Object.keys(result.metafile.outputs)) {
    const full = resolve(path), name = basename(path)
    assets.set(`/__fields/${name}`, { bytes: readFileSync(full), type: name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : name.endsWith('.woff2') ? 'font/woff2' : 'font/woff' })
  }
  assets.set('/__fields/main', { bytes: Buffer.from('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__fields/main.css"></head><body><div id="root"></div><script type="module" src="/__fields/main.js"></script></body></html>'), type: 'text/html' })
  return { assets, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
