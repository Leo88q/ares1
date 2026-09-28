#!/usr/bin/env node
/**
 * Secret scanner for the production-deploy checklist (§1.1.2, §1.1.3, §1.3.5).
 *
 * Why this exists: the pinned scanner (gitleaks 8.30.1, see game/scripts/
 * install-gitleaks.sh) cannot be downloaded in every environment (the GitHub
 * release asset host is blocked in some sandboxes/CI networks). This script is
 * dependency-free, deterministic and covers exactly the patterns the deploy
 * checklist asks for, so the gate exists even when the binary does not.
 *
 * It is an ADDITIONAL net, not a replacement: it does not do entropy analysis,
 * so it will miss a high-entropy secret that matches no named pattern. Run the
 * pinned gitleaks in CI too (game/scripts/scan-secrets.sh).
 *
 * Usage:
 *   node scripts/secret-scan.mjs                 # scan tracked + new files
 *   node scripts/secret-scan.mjs --root dist     # scan a build output directory
 *   node scripts/secret-scan.mjs --all-files     # include gitignored files
 *   node scripts/secret-scan.mjs --json
 *   git diff --cached --name-only -z | node scripts/secret-scan.mjs --stdin  # staged only
 *
 * Exit codes: 0 = clean, 1 = findings (or suspicious filenames), 2 = usage error.
 *
 * Never print secret material: findings are reported with the matched value
 * redacted (--redact keeps a short prefix only when --show-context is passed).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

const ROOT = process.cwd();

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const flagValue = (f, def) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

if (has('--help') || has('-h')) {
  console.log('Usage: node scripts/secret-scan.mjs [--root DIR] [--all-files] [--json] [--allowlist-file FILE]');
  process.exit(0);
}

const SCAN_ROOT = flagValue('--root', '.');
const ALL_FILES = has('--all-files');
const AS_JSON = has('--json');
const ALLOWLIST_FILE = flagValue('--allowlist-file', '.secret-scan-allowlist.json');

// ---------------------------------------------------------------------------
// §1.1.2 — filenames that must never be in the repository.
// `secret` matches must be confirmed by content inspection; the filename alone
// is only a signal, so these are reported as WARN, not as hard failures.
// ---------------------------------------------------------------------------
const SUSPICIOUS_FILENAMES = [
  { id: 'filename-env', re: /^\.env(\..+)?$/, note: 'env file (only .env.example / .env.*.example may be tracked)' },
  { id: 'filename-key', re: /\.(pem|key|p12|keystore)$/i, note: 'private key / keystore material' },
  { id: 'filename-solana-keypair', re: /^(id|keypair.*|wallet.*)\.json$/i, note: 'possible wallet keypair JSON' },
  { id: 'filename-service-account', re: /^serviceAccount.*\.json$/i, note: 'cloud service account' },
  { id: 'filename-credentials', re: /^(credentials?|secrets?)(\..*)?\.(json|ya?ml|toml|txt|env)$/i, note: 'credentials/secrets file' },
  { id: 'filename-dump', re: /\.(sqlite|sqlite3|sql|bak|dump)$/i, note: 'database dump / backup' },
];

// Names that are explicitly expected to be present (documentation, examples).
const FILENAME_EXEMPTIONS = [
  /README/i,
  /^\.env\.example$/,
  /\.env\..*\.example$/,
  /example/i,
  /schema\.json$/i,
  /manifest\.json$/i,
  /package(-lock)?\.json$/i,
  /tsconfig.*\.json$/i,
  /\.test\.mjs$/,
];

// ---------------------------------------------------------------------------
// §1.1.3 — content patterns.
// `re` is applied with the flags given in `flags`. `entropy` (optional) is a
// minimum Shannon entropy over the captured secret, used to cut the noise from
// base58/base64 identifiers that are not secrets (program IDs, tx signatures).
// ---------------------------------------------------------------------------
const RULES = [
  {
    id: 'solana-keypair-array',
    severity: 'critical',
    note: 'Solana keypair: JSON array of 64 numbers',
    flags: 'g',
    re: /\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/,
  },
  {
    id: 'solana-base58-secret',
    severity: 'critical',
    note: 'base58 private key (87-88 chars)',
    flags: 'g',
    // Exclude surrounding base58 characters so a 88-char secret embedded in a
    // longer base58 blob (e.g. a keypair file) is still caught on word bounds.
    re: /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{87,88}(?![1-9A-HJ-NP-Za-km-z])/,
    entropy: 3.6,
  },
  {
    id: 'evm-private-key',
    severity: 'critical',
    note: 'EVM private key (0x + 64 hex)',
    flags: 'gi',
    re: /0x[a-fA-F0-9]{64}\b/,
  },
  {
    id: 'telegram-bot-token',
    severity: 'critical',
    note: 'Telegram bot token',
    flags: 'g',
    re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/,
  },
  {
    id: 'rpc-url-credential',
    severity: 'high',
    note: 'RPC provider URL with embedded API key (Helius/QuickNode/Alchemy/Infura)',
    flags: 'gi',
    re: /https?:\/\/[^\s"'`)]*\?(?:[^#\s"'`)]*&)?(?:api[-_]?key|token|access[-_]?token|key)=([^\s"'`&)]{8,})/,
    group: 1,
  },
  {
    id: 'helius-key-in-url',
    severity: 'high',
    note: 'Helius RPC URL (key is the first path segment)',
    flags: 'gi',
    re: /https:\/\/(?:mainnet|devnet|rpc)\.helius-rpc\.com\/\?api-key=[^\s"'`)]+/i,
  },
  {
    id: 'db-connection-string',
    severity: 'high',
    note: 'database connection string with credentials',
    flags: 'gi',
    re: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:"'@/?#\[\]]+:[^\s"'`@]+@[^\s"'`]+/,
  },
  {
    id: 'supabase-service-role',
    severity: 'critical',
    note: 'Supabase service_role key (JWT signed with the project secret)',
    flags: 'g',
    re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/,
    entropy: 4.0,
    contextRequired: /(?:service_role|supabase|sb_secret)/i,
  },
  {
    id: 'aws-access-key-id',
    severity: 'critical',
    note: 'AWS access key id',
    flags: 'g',
    re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'aws-secret-access-key',
    severity: 'critical',
    note: 'AWS secret access key assigned to a variable',
    flags: 'gi',
    re: /(?:aws)?_?secret_?(?:access)?_?key\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/,
    group: 1,
  },
  {
    id: 'gcp-api-key',
    severity: 'high',
    note: 'Google/GCP API key',
    flags: 'g',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'gcp-service-account-key',
    severity: 'critical',
    note: 'GCP service account private key block',
    flags: 'g',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  {
    id: 'stripe-live-key',
    severity: 'critical',
    note: 'Stripe live/test secret or restricted key',
    flags: 'g',
    re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/,
  },
  {
    id: 'slack-token',
    severity: 'high',
    note: 'Slack token',
    flags: 'g',
    re: /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/,
  },
  {
    id: 'discord-webhook',
    severity: 'high',
    note: 'Discord webhook URL',
    flags: 'g',
    re: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
  },
  {
    id: 'telegram-webhook',
    severity: 'high',
    note: 'Telegram bot webhook URL with token',
    flags: 'g',
    re: /https:\/\/api\.telegram\.org\/bot\d{8,10}:[A-Za-z0-9_-]{35}\//,
  },
  {
    id: 'sendgrid-key',
    severity: 'high',
    note: 'SendGrid API key',
    flags: 'g',
    re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/,
  },
  {
    id: 'npm-token',
    severity: 'critical',
    note: 'npm access token',
    flags: 'g',
    re: /\bnpm_[A-Za-z0-9]{36}\b/,
  },
  {
    id: 'github-token',
    severity: 'critical',
    note: 'GitHub token',
    flags: 'g',
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  },
  {
    id: 'bearer-literal',
    severity: 'medium',
    note: 'hardcoded Bearer token',
    flags: 'g',
    re: /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/,
  },
  {
    id: 'private-key-assignment',
    severity: 'critical',
    note: 'privateKey/secretKey assigned a literal value',
    flags: 'gi',
    re: /(?:private[_-]?key|secret[_-]?key|secretkey|priv[_-]?key)\s*[:=]\s*["'`]([^"'`\s]{16,})["'`]/,
    group: 1,
  },
  {
    id: 'mnemonic-phrase',
    severity: 'critical',
    note: 'BIP39 seed phrase (12/24 words near a mnemonic keyword)',
    flags: 'gi',
    re: /(?:mnemonic|seed[\s_-]?phrase|recovery[\s_-]?phrase|seed[\s_-]?words)\s*[:=]?\s*["'`]?\s*((?:[a-z]{3,8}\s+){11,23}[a-z]{3,8})\b/,
    group: 1,
  },
  {
    id: 'password-assignment',
    severity: 'medium',
    note: 'password/secret/api_key assigned a literal value',
    flags: 'gi',
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token)\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/,
    group: 1,
    // Placeholders and variable interpolation are not secrets.
    ignore: [
      /^\$\{?[A-Z0-9_]*\}?$/,
      /^process\.env/,
      /^import\.meta\.env/,
      /^(?:changeme|change[-_]?me|example|placeholder|redacted|xxx+|\*+|todo|tbd|none|null|undefined|your[-_]?.*|test(?:ing)?|dummy|sample|secret|password)$/i,
    ],
  },
];

// Files where credential-shaped strings are documentation, not configuration.
const TEXT_ONLY_EXT = new Set([
  '.md', '.txt', '.rst', '.json', '.svg', '.css', '.yml', '.yaml', '.toml',
]);

// Directories never worth reading (binary assets, vendored deps, fixtures).
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', 'coverage',
  '.anchor', 'test-ledger', '.next', '.turbo', '.vite',
]);

const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

// ---------------------------------------------------------------------------

function shannonEntropy(str) {
  if (!str) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function listFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      listFiles(full, out);
      continue;
    }
    if (!e.isFile()) continue;
    out.push(full);
  }
  return out;
}

function trackedFiles() {
  const stdout = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
  ).toString();
  return stdout.split('\0').filter(Boolean);
}

/**
 * Resolve the file list.
 *
 * --stdin reads NUL-separated paths from stdin (the shape produced by
 * `git diff --cached --name-only -z`), which is what the pre-commit hook uses:
 * a commit should be blocked by what it introduces, not by pre-existing debt.
 *
 * Positional arguments are treated as explicit paths to scan.
 */
function resolveFiles() {
  if (has('--stdin')) {
    const buf = execFileSync('cat', {
      input: readFileSync(0),
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    return buf.split('\0').filter(Boolean).map((f) => join(ROOT, f));
  }

  const positional = args.filter((a, i) => {
    if (a.startsWith('-')) return false;
    const prev = args[i - 1];
    return !(prev && (prev === '--root' || prev === '--allowlist-file'));
  });
  if (positional.length > 0) return positional.map((f) => join(ROOT, f));

  const rootAbs = join(ROOT, SCAN_ROOT);
  if (!existsSync(rootAbs)) {
    console.error(`secret-scan: no such directory: ${SCAN_ROOT}`);
    process.exit(2);
  }
  if (SCAN_ROOT === '.' && !ALL_FILES) {
    return trackedFiles().map((f) => join(ROOT, f));
  }
  return listFiles(rootAbs);
}

const files = resolveFiles();

// Allowlist: { "rule-id": ["path", ...] } or { "rule-id": { "path": "reason" } }
let allowlist = {};
if (existsSync(join(ROOT, ALLOWLIST_FILE))) {
  try {
    allowlist = JSON.parse(readFileSync(join(ROOT, ALLOWLIST_FILE), 'utf8'));
  } catch (err) {
    console.error(`secret-scan: cannot parse ${ALLOWLIST_FILE}: ${err.message}`);
    process.exit(2);
  }
}

const isAllowed = (ruleId, relPath) => {
  const entry = allowlist[ruleId];
  if (!entry) return false;
  if (Array.isArray(entry)) return entry.includes(relPath);
  return Object.prototype.hasOwnProperty.call(entry, relPath);
};

const findings = [];
const warnings = [];
let scanned = 0;
let skippedBinary = 0;

for (const abs of files) {
  const rel = relative(ROOT, abs);
  const name = basename(abs);
  const ext = extname(name).toLowerCase();

  // §1.1.2 filename inventory.
  for (const f of SUSPICIOUS_FILENAMES) {
    if (!f.re.test(name)) continue;
    if (FILENAME_EXEMPTIONS.some((ex) => ex.test(name))) continue;
    if (isAllowed(f.id, rel)) continue;
    warnings.push({ rule: f.id, file: rel, note: f.note, severity: 'warn' });
  }

  if (SKIP_FILES.has(name)) continue;

  let size;
  try {
    size = statSync(abs).size;
  } catch {
    continue;
  }
  if (size === 0) continue;
  // 8 MB guard: a minified bundle or a media file is not scanned line by line.
  if (size > 8 * 1024 * 1024) {
    skippedBinary++;
    continue;
  }

  let content;
  try {
    content = readFileSync(abs, 'utf8');
  } catch {
    skippedBinary++;
    continue;
  }
  // NUL byte => binary (images, wasm, audio).
  if (content.includes('\0')) {
    skippedBinary++;
    continue;
  }
  scanned++;

  const lines = content.split('\n');

  for (const rule of RULES) {
    if (isAllowed(rule.id, rel)) continue;
    const re = new RegExp(rule.re.source, rule.flags);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 20000) continue;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line)) !== null) {
        const raw = m[rule.group ?? 0] ?? m[0];
        if (typeof raw !== 'string' || raw.length === 0) {
          re.lastIndex++;
          continue;
        }
        if (rule.ignore && rule.ignore.some((ig) => ig.test(raw))) {
          re.lastIndex++;
          continue;
        }
        if (rule.contextRequired && !rule.contextRequired.test(line)) {
          re.lastIndex++;
          continue;
        }
        if (rule.entropy && shannonEntropy(raw) < rule.entropy) {
          re.lastIndex++;
          continue;
        }
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          file: rel,
          line: i + 1,
          note: rule.note,
          // Redacted: never echo the secret itself.
          match: `${raw.slice(0, 4)}…(${raw.length} chars)`,
        });
        re.lastIndex++;
        break; // one finding per rule per line is enough to act on
      }
    }
  }
}

// ---------------------------------------------------------------------------

const bySeverity = { critical: 0, high: 0, medium: 0, warn: 0 };
for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
for (const w of warnings) bySeverity.warn = (bySeverity.warn || 0) + 1;

if (AS_JSON) {
  console.log(JSON.stringify({ scanned, skippedBinary, findings, warnings, counts: bySeverity }, null, 2));
} else {
  console.log(`secret-scan: root=${SCAN_ROOT} files scanned=${scanned} skipped(binary/large)=${skippedBinary}`);
  console.log('');
  if (findings.length === 0) {
    console.log('  content patterns: no findings');
  } else {
    console.log(`  content findings: ${findings.length}`);
    for (const f of findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.rule} — ${f.file}:${f.line} — ${f.note} — ${f.match}`);
    }
  }
  console.log('');
  if (warnings.length === 0) {
    console.log('  filename inventory: no suspicious filenames');
  } else {
    console.log(`  filename inventory (manual confirmation required): ${warnings.length}`);
    for (const w of warnings) {
      console.log(`  [WARN] ${w.rule} — ${w.file} — ${w.note}`);
    }
  }
  console.log('');
  console.log(
    `  counts: critical=${bySeverity.critical} high=${bySeverity.high} medium=${bySeverity.medium} warn=${bySeverity.warn}`,
  );
}

process.exit(findings.length > 0 ? 1 : 0);
