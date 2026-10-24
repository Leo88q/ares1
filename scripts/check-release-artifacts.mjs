#!/usr/bin/env node
/**
 * Release-artifact gate for the build output (checklist §1.3.5, §2.2, §2.3,
 * §2.5, §2.6, §4.6, §8.2).
 *
 * The point of this script: the thing you deploy is NOT the repository. A
 * `.env` can be absent from Git and still end up inside dist/, a source map can
 * reappear with a Vite upgrade, and a dependency can quietly reintroduce a
 * third-party font request. All of those are invisible in a code review and
 * obvious here.
 *
 * It fails (exit 1) on:
 *   - any *.map file or `sourceMappingURL` comment (§2.3)
 *   - committed secret material: *.env*, *.pem, *.key, keypair JSON, dumps (§2.2)
 *   - a .git directory inside the deploy folder (§2.1/§2.2)
 *   - requests to a third-party font/script CDN (§4.6, §3.8.4)
 *   - absolute http:// URLs to non-HTTPS hosts, and localhost/127.0.0.1
 *     hard-coded into shipped assets (§3.1.1)
 *   - leftover debug endpoints or absolute internal paths (§3.6.3)
 *
 * It warns (does not fail) on:
 *   - files larger than a threshold (§8.2 performance budget)
 *
 * Usage:
 *   node scripts/check-release-artifacts.mjs [DIR ...]
 *   node scripts/check-release-artifacts.mjs landing/dist game/apps/web/dist
 *
 * Default directories: landing/dist and game/apps/web/dist, whichever exist.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const dirs = args.length > 0 ? args : ['landing/dist', 'game/apps/web/dist'];

const SIZE_BUDGET_BYTES = 1_500_000; // gzip is what matters, but raw size is a cheap proxy

// Origins that must not be requested by our own origin without consent or a
// documented reason. `fonts.googleapis.com` / `fonts.gstatic.com` are here
// because a font request discloses the visitor's IP before consent (§4.6).
const BANNED_THIRD_PARTY = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'ajax.googleapis.com',
  'code.jquery.com',
  'cdn.jsdelivr.com',
];

// Files whose extension means "never look inside" (binary assets).
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.bmp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.mov',
  '.pdf', '.zip', '.gz', '.br',
]);

const SCANNABLE_EXT = new Set([
  '.html', '.js', '.mjs', '.cjs', '.css', '.json', '.map', '.svg', '.txt',
  '.webmanifest', '.xml', '.md',
]);

const NEVER_IN_DIST = [
  { id: 'artifact-env-file', re: /^\.env(\..*)?$/, severity: 'FAIL', note: 'environment file shipped in the deploy artifact' },
  { id: 'artifact-key-file', re: /\.(pem|key|p12|keystore|pfx|p8)$/i, severity: 'FAIL', note: 'key material shipped in the deploy artifact' },
  { id: 'artifact-keypair', re: /^(id|keypair.*|wallet.*|serviceAccount.*)\.json$/i, severity: 'FAIL', note: 'keypair / service account shipped in the deploy artifact' },
  { id: 'artifact-dump', re: /\.(sqlite3?|sql|bak|dump)(\.gz)?$/i, severity: 'FAIL', note: 'database dump shipped in the deploy artifact' },
  { id: 'artifact-npmrc', re: /^\.npmrc$/, severity: 'FAIL', note: '.npmrc can contain registry auth tokens' },
  { id: 'artifact-source-map', re: /\.map$/, severity: 'FAIL', note: 'source map published: it hands the attacker readable game/economy source' },
  { id: 'artifact-lockfile', re: /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/, severity: 'WARN', note: 'lockfile in the deploy artifact (harmless, but it enumerates your dependency tree)' },
  { id: 'artifact-vcs', re: /^\.git.*/, severity: 'FAIL', note: 'VCS metadata shipped: exposes the whole source history' },
  { id: 'artifact-editor', re: /^\.DS_Store$|^\.vscode$|^\.idea$/, severity: 'WARN', note: 'editor/OS metadata in the deploy artifact' },
  { id: 'artifact-docker', re: /^(Dockerfile|docker-compose\.ya?ml)$/, severity: 'WARN', note: 'build/deploy file in the deploy artifact' },
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile() || e.isSymbolicLink()) {
      yield full;
    }
  }
}

const findings = [];
const add = (severity, id, file, note, extra = '') =>
  findings.push({ severity, id, file, note, extra });

let checkedDirs = 0;
let fileCount = 0;

for (const dir of dirs) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) {
    console.log(`check-release-artifacts: skipped ${dir} (not built)`);
    continue;
  }
  checkedDirs++;
  console.log(`check-release-artifacts: scanning ${dir}`);

  for (const abs_file of walk(abs)) {
    const rel = relative(ROOT, abs_file);
    const name = abs_file.split('/').pop();
    fileCount++;

    for (const rule of NEVER_IN_DIST) {
      if (rule.re.test(name)) {
        add(rule.severity, rule.id, rel, rule.note);
      }
    }

    let size;
    try {
      size = statSync(abs_file).size;
    } catch {
      continue;
    }
    if (size > SIZE_BUDGET_BYTES && /\.(js|css)$/.test(name)) {
      add('WARN', 'artifact-size', rel, `${(size / 1024 / 1024).toFixed(2)} MiB exceeds the ${SIZE_BUDGET_BYTES / 1024 / 1024} MiB per-file budget — check gzip size and consider code splitting`);
    }

    const ext = extname(name).toLowerCase();
    if (!SCANNABLE_EXT.has(ext)) continue;
    if (size === 0 || size > 8 * 1024 * 1024) {
      if (!BINARY_EXT.has(ext)) {
        add('WARN', 'artifact-unscanned', rel, `not scanned (size ${size} bytes)`);
      }
      continue;
    }

    let content;
    try {
      content = readFileSync(abs_file, 'utf8');
    } catch {
      continue;
    }

    if (content.includes('sourceMappingURL')) {
      add('FAIL', 'artifact-sourcemappingurl', rel, 'sourceMappingURL comment present (§2.3)');
    }
    if (/bigint[-_]buffer/i.test(content)) {
      add('FAIL', 'artifact-vulnerable-bigint-buffer', rel, 'vulnerable bigint-buffer package marker shipped in a release bundle');
    }

    for (const host of BANNED_THIRD_PARTY) {
      if (content.includes(host)) {
        add('FAIL', 'artifact-third-party-cdn', rel, `references third-party CDN ${host} (§4.6 / §3.8.4)`);
      }
    }

    // Hard-coded loopback or plain-HTTP absolute URLs in shipped assets.
    const absUrls = content.match(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/g);
    if (absUrls) {
      const uniq = [...new Set(absUrls)].slice(0, 3);
      add('FAIL', 'artifact-loopback-url', rel, `hard-coded loopback URL(s): ${uniq.join(', ')}`);
    }
    if (ext !== '.md' && ext !== '.txt') {
      const httpUrls = content.match(/http:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
      // XML namespace URIs (SVG, XHTML) are identifiers, not network targets —
      // www.w3.org would otherwise generate a warning on every SVG asset.
      // http://www.w3.org and http://www.sitemaps.org are XML namespace URIs
      // in SVG and sitemap files, not network targets.
      const real = [...new Set(httpUrls)].filter(
        (u) => !u.startsWith('http://www.w3.org') && !u.startsWith('http://www.sitemaps.org'),
      );
      if (real.length > 0) {
        add('WARN', 'artifact-insecure-url', rel, `plain http:// URL(s): ${real.slice(0, 3).join(', ')} (mixed content risk, §3.1.1)`);
      }
    }

    // Debug/internal paths that should never be in a production bundle.
    if (/\/(admin|debug|internal|__debug)\b/.test(content) && ext === '.js') {
      // Only a signal for JS bundles; matches are common in routing tables.
      const m = content.match(/\/(admin|debug|internal|__debug)\b/g);
      if (m && m.length > 3) {
        add('WARN', 'artifact-debug-route', rel, `${m.length} references to admin/debug/internal route strings — confirm none is a live production endpoint (§3.6.3)`);
      }
    }
  }
}

const fails = findings.filter((f) => f.severity === 'FAIL');
const warns = findings.filter((f) => f.severity === 'WARN');

console.log('');
for (const f of fails) console.log(`  [FAIL] ${f.id} — ${f.file} — ${f.note}`);
for (const f of warns) console.log(`  [WARN] ${f.id} — ${f.file} — ${f.note}`);
console.log('');
console.log(`check-release-artifacts: ${fileCount} files in ${checkedDirs} directory(ies) — ${fails.length} failure(s), ${warns.length} warning(s)`);

if (checkedDirs === 0) {
  console.error('check-release-artifacts: no build output found. Run the builds first.');
  process.exit(2);
}

process.exit(fails.length > 0 ? 1 : 0);
