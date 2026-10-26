// Test-only real scene. No URL switch, debug globals or synthetic balances ship.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

export async function performanceFixture() {
  const { build } = require('esbuild')
  const repo = fileURLToPath(new URL('../../../../', import.meta.url))
  const src = fileURLToPath(new URL('../src/', import.meta.url))
  mkdirSync(join(repo, '.cache'), { recursive: true })
  const dir = mkdtempSync(join(repo, '.cache/colony-performance-')), prefix = '/__colony-performance/'
  const entry = join(dir, 'main.ts')
  writeFileSync(entry, `
import { createColonyScene } from '${src}/colony/scene';
import { initialColony, syncView, MODULE_KINDS, greenhouseBeds, dailyBudget } from '${src}/colony/simulation';
import { starterNetworks } from '${src}/colony/networks';
import { initialUnifiedBase } from '${src}/organism/unified';
import { placementWorld, modulePlacement } from '${src}/colony/layout';
let active = null, state = null, selected = null;
window.__picked = null;
const frames = async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); };
function stress(count) {
  if (count === 8) return initialColony();
  const base = initialColony();
  const modules = Array.from({ length: count }, (_, i) => {
    const kind = MODULE_KINDS[i % MODULE_KINDS.length];
    return { id: 'stress-' + kind + '-' + i, kind, slot: i, placement: { x: i % 16 * 3, z: Math.floor(i / 16) * 3, rotation: 0 }, condition: 100, growthDays: kind === 'greenhouse' ? i % 90 : 0, beds: kind === 'greenhouse' ? greenhouseBeds(i % 90) : undefined };
  });
  const ledger = initialUnifiedBase({plots: modules.filter(m=>m.kind==='greenhouse').map(m=>({id:m.id,tier:0,beds:m.beds})),crew:4,storageCapKg:120,startKg:120});
  return syncView({...base,modules,ledger,networks:starterNetworks(modules)});
}
window.__mount = async (count, batching, incremental = true) => {
  active?.dispose(); active = null;
  state = stress(count); selected = state.modules[Math.floor(count / 2)].id;
  let done, fail; const ready = new Promise((r, j) => { done = r; fail = j });
  active = createColonyScene(document.getElementById('host'), {
    onSelect: id => { window.__picked = id; selected = id; active.update(state,selected,18) },
    onSite: () => {}, onReady: () => done(),
    onModelError: files => fail(Error('Stress model failed: ' + files.join(', '))),
    onContextLost: () => fail(Error('Unexpected context loss')),
  }, { batching, incremental });
  active.update(state, selected, 18);
  let timeout;
  try { await Promise.race([ready,new Promise((_,reject)=>{ timeout=setTimeout(()=>reject(Error('Scene readiness timeout')),45000) })]); } finally { clearTimeout(timeout) }
  await frames(); return active.diagnostics();
};
window.__sample = async (count = 5) => {
  const samples = [];
  for (let i = 0; i < count; i++) {
    // Fresh snapshots with changed crop/condition values, not repeated identity.
    state = {...state, day:state.day+1, modules:state.modules.map(m=>({...m,
      condition:Math.max(1,m.condition-0.1),growthDays:(m.growthDays+1)%90}))};
    active.update(state,selected,18); await frames(); samples.push(active.diagnostics())
  }
  return samples;
};
window.__zoom = async factor => { active.zoom(factor); await frames(); return active.diagnostics() };
window.__recycle = async (index = 0) => {
  const original = state;
  state = {...state,modules:state.modules.filter((_,i)=>i!==index)};
  active.update(state,selected,18); await frames();
  state = original;
  active.update(state,selected,18); await frames(); return active.diagnostics();
};
window.__solar = async coverage => {
  const budget = state.lastDay ?? dailyBudget(state);
  state = {...state,lastDay:{...budget,generationKwh:coverage*budget.demandKwh}};
  active.update(state,selected,18); await frames(); return active.diagnostics();
};
window.__night = async () => { active.update(state,selected,0); await frames(); return active.diagnostics() };
window.__choose = async (index = 1) => { selected = state.modules[index].id; active.update(state,selected,18); await frames(); return active.diagnostics() };
window.__move = async () => {
  const m = state.modules[0];
  state = {...state,modules:state.modules.map((m,i)=>i===0?{...m,placement:{...modulePlacement(m),rotation:(modulePlacement(m).rotation+1)%4}}:m)};
  active.update(state,selected,18); await frames(); return active.diagnostics();
};
window.__turn = async () => { active.rotate(1); await frames(); return active.diagnostics() };
window.__pickTarget = () => {
  const m = state.modules[Math.min(state.modules.length-1,136)], p = placementWorld(m.kind,modulePlacement(m));
  return {x:p.x+p.width/2-0.25,z:p.z+p.depth/2-0.25};
};
window.__dispose = async () => { active.dispose(); const stats = active.diagnostics(); active = null; await frames(); return {stats,canvases:document.querySelectorAll('canvas').length} };
`)
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    outfile: join(dir, 'main.js'), metafile: true, minify: true,
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    nodePaths: [resolve(src, '../../../node_modules')],
  })
  const assets = new Map()
  for (const path of Object.keys(result.metafile.outputs)) assets.set(`${prefix}${basename(path)}`, { bytes: readFileSync(resolve(path)), type: 'application/javascript' })
  assets.set(`${prefix}main`, { bytes: Buffer.from(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#161410}#host{width:min(480px,100%);height:420px;margin:0 auto;touch-action:none}canvas{display:block}</style></head><body><div id="host"></div><script type="module" src="${prefix}main.js"></script></body></html>`), type: 'text/html' })
  return { assets, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
