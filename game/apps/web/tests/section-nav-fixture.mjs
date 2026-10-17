// Test-only harness for the section console: the real AresBottomNav (seven keys,
// 2026-10-17) plus the real section bays/illustrations. Generated output lives in
// ignored .cache, never in the shipped app. No providers are mounted: the nav and
// the art need no wallet, RPC or game state, and none can execute here.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

export async function sectionNavFixture() {
  const { build } = require('esbuild')
  const repo = fileURLToPath(new URL('../../../../', import.meta.url))
  const src = fileURLToPath(new URL('../src/', import.meta.url))
  mkdirSync(join(repo, '.cache'), { recursive: true })
  const dir = mkdtempSync(join(repo, '.cache/section-nav-fixture-'))
  const entry = join(dir, 'entry.tsx')
  writeFileSync(entry, `
import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
import '${src}/polyfills'; import '${src}/i18n/dicts'; import '${src}/fonts';
import '${src}/theme/tokens.css'; import '${src}/styles/global.css'; import '${src}/styles/kit.css'; import '${src}/index.css'; import '${src}/ui/hull-ui.css';
import { setLang } from '${src}/i18n';
import { AresBottomNav } from '${src}/components/ares/AresBottomNav';
import type { AresTab } from '${src}/components/ares/AresBottomNav';
import { SupplyBay } from '${src}/components/ares/SupplyBay';
import { StatsBay } from '${src}/components/ares/StatsBay';
import { CabinBay } from '${src}/components/ares/CabinBay';

window.__setLang = setLang;
window.__navCalls = [];

function Harness() {
  const [tab, setTab] = useState<AresTab>('market');
  const onChange = (next: AresTab) => { window.__navCalls.push(next); setTab(next); };
  const body = <div data-testid="nav-harness-body" style={{ padding: 16, minHeight: 220 }}>
    <p>ARES—1 · {tab}</p>
  </div>;
  return (
    <div className="pf-phone-chassis">
      <main id="main">
        {tab === 'market' && <SupplyBay o2Percent={98} h2oPercent={71} rationLabel="120 POTATO">{body}</SupplyBay>}
        {tab === 'stats' && <StatsBay o2Percent={97} h2oPercent={69} rationLabel="118 POTATO">{body}</StatsBay>}
        {tab === 'profile' && <CabinBay o2Percent={96} h2oPercent={68} rationLabel="116 POTATO">{body}</CabinBay>}
        {(tab === 'main' || tab === 'lab' || tab === 'colony' || tab === 'operation') && body}
      </main>
      <AresBottomNav active={tab} onChange={onChange} />
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
`)
  const result = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    outfile: join(dir, 'out/nav.js'), publicPath: '/__nav/', metafile: true, minify: true,
    jsx: 'automatic', loader: { '.woff2': 'file', '.woff': 'file' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    nodePaths: [resolve(src, '../../../node_modules')],
    plugins: [{ name: 'nav-art-only', setup(builder) {
      builder.onResolve({ filter: /^\/(ares|sfx|models)\// }, args => ({ path: args.path, external: true }))
    } }],
  })
  const assets = new Map()
  for (const path of Object.keys(result.metafile.outputs)) {
    const name = basename(path)
    assets.set(`/__nav/${name}`, { bytes: readFileSync(resolve(path)), type: name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : name.endsWith('.woff2') ? 'font/woff2' : 'font/woff' })
  }
  assets.set('/__nav/main', { bytes: Buffer.from('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__nav/nav.css"></head><body><div id="root"></div><script type="module" src="/__nav/nav.js"></script></body></html>'), type: 'text/html' })
  return { assets, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
