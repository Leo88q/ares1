#!/usr/bin/env node
// Narrow, reproducible source inventory. NOT a Rust/Anchor AST audit.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function inspect(source, location = 'game/programs/solana_potato/src/lib.rs') {
  const findings = [];
  for (const [index, line] of source.split('\n').entries()) {
    // Count tokens even inside comments: false positives must be manually triaged.
    for (const match of line.matchAll(/\binit_if_needed\b/g)) {
      findings.push({ rule_id: 'SW016-source-inventory', severity: 'review',
        location: { path: location, line: index + 1, column: match.index + 1 },
        message: 'init_if_needed token: review re-initialization, ownership and PDA constraints',
        help: 'Prefer init for one-shot state. If idempotency is required, verify existing-account invariants and test both branches.' });
    }
  }
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = 'game/programs/solana_potato/src/lib.rs';
  const source = readFileSync(path.join(root, file), 'utf8');
  const findings = inspect(source, file);
  const report = {
    status: 'partial_source_inventory_not_security_audit', scope: file,
    files_scanned: 1, files_parsed: 0, parse_failures: [], findings,
    zero_findings_verified: false,
    scanner: 'literal SW016 token inventory (includes comments; not AST or vulnerability proof)',
    required_checks_unverified: ['SW002', 'SW013', 'SW009', 'SW010', 'SW024', 'SW008', 'SW027'],
  };
  const dest = path.join(root, 'reports');
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, 'ares1-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`SW016 source inventory: ${findings.length} occurrences; 1 file read; 0 files parsed. NOT a security audit.`);
}
