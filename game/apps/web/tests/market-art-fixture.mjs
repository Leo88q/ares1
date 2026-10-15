// Test-only actual V1 MarketScreen and CreateOrderModal with local provider spies.
// No RPC, wallet connection, signature or transaction can execute here.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
export async function marketArtFixture() {
  const { build } = require('esbuild')
  const repo = fileURLToPath(new URL('../../../../', import.meta.url)), src = fileURLToPath(new URL('../src/', import.meta.url))
  mkdirSync(join(repo, '.cache'), { recursive: true })
  const dir = mkdtempSync(join(repo, '.cache/market-art-fixture-'))
  const game = join(dir, 'game.tsx'), solana = join(dir, 'solana.tsx'), market = join(dir, 'market.tsx'), toast = join(dir, 'toast.tsx')
  writeFileSync(game, 'export function useGame(){return {stats:{potatoBalance:100000000000,skrBalance:0},fields:[]};}')
  writeFileSync(solana, `import {PublicKey} from '@solana/web3.js';
const key=new PublicKey(new Uint8Array(32).fill(7));
export const IS_MAINNET=false;export const CLUSTER='devnet';
export function useSolana(){return {publicKey:key,programId:key,ready:true,connected:true,config:{},connection:{getAccountInfo:async()=>null},refreshConfig:async()=>{},sendIx:async()=>{throw new Error('Forbidden signing in art test')}};}`)
  writeFileSync(toast, 'export function useToast(){return {show:message=>{window.__artNotices.push(message)}};}')
  writeFileSync(market, `import {PublicKey} from '@solana/web3.js';
const foreign=new PublicKey(new Uint8Array(32).fill(8)), own=new PublicKey(new Uint8Array(32).fill(7));
const orders=[{publicKey:new PublicKey(new Uint8Array(32).fill(3)),seller:foreign,amountMicro:100000000,priceLamportsPerPotato:1000000,feeMicro:9000000,status:'active',createdAt:0,expiresAt:2000000000,totalLamports:100000000,isOwn:false},{publicKey:new PublicKey(new Uint8Array(32).fill(4)),seller:own,amountMicro:200000000,priceLamportsPerPotato:1000000,feeMicro:18000000,status:'active',createdAt:0,expiresAt:2000000000,totalLamports:200000000,isOwn:true}];
window.__artOrderCalls=[];window.__artNotices=[];window.__artOrderIds=orders.map(order=>order.publicKey.toString());
export function useMarketplace(){return {orders,myOrders:orders.filter(order=>order.isOwn),stats:{sellVolume24h:300,buyVolume24h:100,totalSolVolume:0.3,totalTrades:2},loading:false,actionLoading:null,error:null,reload:async()=>{},createOrder:async(a,p)=>{window.__artOrderCalls.push(['create',a,p]);return true},fillOrder:async order=>{window.__artOrderCalls.push(['fill',order.publicKey.toString()]);return true},cancelOrder:async key=>{window.__artOrderCalls.push(['cancel',key.toString()]);return true}};}`)
  const entry = join(dir, 'entry.tsx')
  writeFileSync(entry, `import React from 'react';import {createRoot} from 'react-dom/client';
import '${src}/polyfills';import '${src}/i18n/dicts';import '${src}/fonts';import '${src}/theme/tokens.css';import '${src}/styles/global.css';import '${src}/styles/kit.css';import '${src}/index.css';import '${src}/ui/hull-ui.css';
import MarketScreen from '${src}/components/MarketScreen';
createRoot(document.getElementById('root')).render(<div className="pf-phone-chassis"><MarketScreen/></div>);`)
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', outfile: join(dir, 'out/market.js'), publicPath: '/__market-art/', metafile: true, minify: true, jsx: 'automatic', loader: { '.woff2': 'file', '.woff': 'file' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_MARKET_V2_ENABLED': '"false"' }, nodePaths: [resolve(src, '../../../node_modules')],
    plugins: [{ name: 'no-wallet-spies', setup(b) {
      b.onResolve({ filter: /contexts\/(GameContext|SolanaContext)$/ }, args => ({ path: args.path.endsWith('GameContext') ? game : solana }))
      b.onResolve({ filter: /hooks\/useMarketplace$/ }, () => ({ path: market }))
      b.onResolve({ filter: /\.\/Toast$/ }, () => ({ path: toast }))
      b.onResolve({ filter: /^\/(ares|sfx|models)\// }, args => ({ path: args.path, external: true }))
    } }],
  })
  const assets = new Map()
  for (const path of Object.keys(result.metafile.outputs)) { const name = basename(path); assets.set(`/__market-art/${name}`, { bytes: readFileSync(resolve(path)), type: name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : 'font/woff2' }) }
  assets.set('/__market-art/market', { bytes: Buffer.from('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__market-art/market.css"></head><body><div id="root"></div><script type="module" src="/__market-art/market.js"></script></body></html>'), type: 'text/html' })
  return { assets, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
