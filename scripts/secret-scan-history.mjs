#!/usr/bin/env node
/**
 * Git-history secret scanner (checklist §1.2.1).
 *
 * Complements scripts/secret-scan.mjs (working tree) and the pinned gitleaks
 * (game/scripts/scan-secrets.sh history). This one needs no external binary: it
 * walks every object reachable from --all (all branches, tags; add
 * --include-stash for the stash reflog) and applies the same content rules to
 * each blob.
 *
 * Anything ever committed must be treated as compromised, even if it was
 * deleted later — deleting a file does not remove it from history.
 *
 * Usage:
 *   node scripts/secret-scan-history.mjs [--json] [--include-stash] [--max-bytes N]
 *
 * Exit codes: 0 = clean, 1 = findings, 2 = usage/prerequisite error.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const INCLUDE_STASH = args.includes('--include-stash');
const ALLOWLIST_FILE = '.secret-scan-allowlist.json';
const MAX_BYTES = Number(args[args.indexOf('--max-bytes') + 1]) || 2 * 1024 * 1024;

const sh = (cmd, opts = {}) =>
  execFileSync(cmd, { cwd: ROOT, shell: '/bin/bash', maxBuffer: 256 * 1024 * 1024, ...opts }).toString();

// ---------------------------------------------------------------------------
// Rules mirror secret-scan.mjs. Kept as plain data so the two scanners cannot
// silently drift in coverage; the tree scanner remains the source of truth for
// working-copy gates.
// ---------------------------------------------------------------------------
const RULES = [
  { id: 'solana-keypair-array', severity: 'critical', note: 'Solana keypair (64-number array)', re: /\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/g },
  { id: 'evm-private-key', severity: 'critical', note: 'EVM private key', re: /0x[a-fA-F0-9]{64}\b/gi },
  { id: 'telegram-bot-token', severity: 'critical', note: 'Telegram bot token', re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
  { id: 'gcp-service-account-key', severity: 'critical', note: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'stripe-live-key', severity: 'critical', note: 'Stripe secret key', re: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/g },
  { id: 'aws-access-key-id', severity: 'critical', note: 'AWS access key id', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', severity: 'critical', note: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { id: 'npm-token', severity: 'critical', note: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'slack-token', severity: 'high', note: 'Slack token', re: /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/g },
  { id: 'discord-webhook', severity: 'high', note: 'Discord webhook', re: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g },
  { id: 'sendgrid-key', severity: 'high', note: 'SendGrid key', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { id: 'helius-key-in-url', severity: 'high', note: 'Helius RPC URL with key', re: /https:\/\/(?:mainnet|devnet|rpc)\.helius-rpc\.com\/\?api-key=[^\s"'`)]+/gi },
  { id: 'rpc-url-credential', severity: 'high', note: 'RPC URL with api-key/token param', re: /https?:\/\/[^\s"'`)]*\?(?:[^#\s"'`)]*&)?(?:api[-_]?key|token|access[-_]?token|key)=([^\s"'`&)]{8,})/gi, group: 1 },
  { id: 'db-connection-string', severity: 'high', note: 'database connection string with credentials', re: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:"'@/?#\[\]]+:[^\s"'`@]+@[^\s"'`]+/gi },
  { id: 'private-key-assignment', severity: 'critical', note: 'privateKey/secretKey literal', re: /(?:private[_-]?key|secret[_-]?key|secretkey)\s*[:=]\s*["'`]([^"'`\s]{16,})["'`]/gi, group: 1 },
  { id: 'mnemonic-phrase', severity: 'critical', note: 'BIP39 seed phrase', re: /(?:mnemonic|seed[\s_-]?phrase|recovery[\s_-]?phrase)\s*[:=]?\s*["'`]?\s*((?:[a-z]{3,8}\s+){11,23}[a-z]{3,8})\b/gi, group: 1 },
  {
    id: 'password-assignment',
    severity: 'medium',
    note: 'password/api_key literal',
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token)\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/gi,
    group: 1,
    ignore: [/^\$\{?[A-Z0-9_]*\}?$/, /^process\.env/, /^import\.meta\.env/,
      /^(?:changeme|change[-_]?me|example|placeholder|redacted|xxx+|\*+|todo|tbd|none|null|undefined|your[-_]?.*|test(?:ing)?|dummy|sample|secret|password)$/i],
  },
];

const shannonEntropy = (str) => {
  if (!str) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) { const p = n / str.length; h -= p * Math.log2(p); }
  return h;
};

// base58 87-88 with an entropy floor, to avoid flagging tx signatures and
// public keys that happen to be the same length.
const B58 = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{87,88}(?![1-9A-HJ-NP-Za-km-z])/g;

function main() {
  if (sh('git rev-parse --is-shallow-repository').trim() === 'true') {
    console.error('secret-scan-history: shallow clone. Run: git fetch --unshallow origin');
    process.exit(2);
  }

  let allowlist = {};
  if (existsSync(join(ROOT, ALLOWLIST_FILE))) {
    allowlist = JSON.parse(readFileSync(join(ROOT, ALLOWLIST_FILE), 'utf8'));
  }
  const isAllowed = (ruleId, p) => {
    const e = allowlist[ruleId];
    if (!e) return false;
    return Array.isArray(e) ? e.includes(p) : Object.prototype.hasOwnProperty.call(e, p);
  };

  // object id -> path (last path seen; a blob may appear under several names)
  const objects = sh(`git rev-list --objects --all${INCLUDE_STASH ? ' --reflog' : ''}`)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const sp = l.indexOf(' ');
      return sp === -1 ? [l, ''] : [l.slice(0, sp), l.slice(sp + 1)];
    });

  // Also map blobs to the commit(s) that introduced them for the report.
  const findings = [];
  const seen = new Set();
  let blobs = 0;

  for (const [oid, path] of objects) {
    if (seen.has(oid)) continue;
    seen.add(oid);
    let type;
    try {
      type = sh(`git cat-file -t ${oid}`).trim();
    } catch {
      continue;
    }
    if (type !== 'blob') continue;

    let size;
    try {
      size = Number(sh(`git cat-file -s ${oid}`).trim());
    } catch {
      continue;
    }
    if (size === 0 || size > MAX_BYTES) continue;

    let content;
    try {
      content = sh(`git cat-file -p ${oid}`, { encoding: 'latin1' });
    } catch {
      continue;
    }
    if (content.includes('\0')) continue;
    blobs++;

    const lines = content.split('\n');
    const record = (rule, lineNo, raw) => {
      findings.push({
        rule: rule.id ?? rule,
        severity: rule.severity ?? 'high',
        path: path || '(unknown path)',
        blob: oid.slice(0, 12),
        line: lineNo,
        note: rule.note ?? rule,
        match: `${raw.slice(0, 4)}…(${raw.length} chars)`,
      });
    };

    for (const rule of RULES) {
      for (let i = 0; i < lines.length; i++) {
        if (isAllowed(rule.id, path)) break;
        const line = lines[i];
        if (line.length > 20000) continue;
        const re = new RegExp(rule.re.source, rule.re.flags);
        let m;
        while ((m = re.exec(line)) !== null) {
          const raw = m[rule.group ?? 0] ?? m[0];
          if (typeof raw === 'string' && raw.length > 0) {
            if (!(rule.ignore && rule.ignore.some((ig) => ig.test(raw)))) {
              record(rule, i + 1, raw);
            }
          }
          re.lastIndex++;
          break;
        }
      }
    }

    // base58 heuristic (entropy-gated)
    for (let i = 0; i < lines.length; i++) {
      if (isAllowed('solana-base58-secret', path)) break;
      const line = lines[i];
      if (line.length > 20000) continue;
      const re = new RegExp(B58.source, B58.flags);
      let m;
      while ((m = re.exec(line)) !== null) {
        const raw = m[0];
        if (shannonEntropy(raw) >= 3.6) {
          record({ id: 'solana-base58-secret', severity: 'critical', note: 'base58 87-88 chars (keypair or tx signature — inspect)' }, i + 1, raw);
        }
        re.lastIndex++;
        break;
      }
    }
  }

  // One line per (rule, path) keeps the report actionable; the blob/line of the
  // first occurrence is kept as the pointer.
  const deduped = [];
  const key = new Set();
  for (const f of findings) {
    const k = `${f.rule}|${f.path}`;
    if (key.has(k)) continue;
    key.add(k);
    deduped.push(f);
  }

  const counts = { critical: 0, high: 0, medium: 0 };
  for (const f of deduped) counts[f.severity] = (counts[f.severity] || 0) + 1;

  if (AS_JSON) {
    console.log(JSON.stringify({ commits: sh('git rev-list --all --count').trim(), blobs, findings: deduped, counts }, null, 2));
  } else {
    console.log(`secret-scan-history: commits=${sh('git rev-list --all --count').trim()} blobs scanned=${blobs}`);
    console.log('');
    if (deduped.length === 0) {
      console.log('  history: no findings');
    } else {
      console.log(`  history findings: ${deduped.length} (one row per rule+path)`);
      for (const f of deduped) {
        console.log(`  [${f.severity.toUpperCase()}] ${f.rule} — ${f.path}:${f.line} (blob ${f.blob}) — ${f.note} — ${f.match}`);
      }
    }
    console.log('');
    console.log(`  counts: critical=${counts.critical} high=${counts.high} medium=${counts.medium}`);
  }

  process.exit(deduped.length > 0 ? 1 : 0);
}

main();
