import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { loadConfig, safeConfig, manifest } from '../src/config.js';
import { config } from './helpers.js';

test('read-only capability: runtime dependency/import surface excludes game backend and signing APIs', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['bs58', 'pg', 'prom-client', 'zod']);
  const allowed = new Set(['bs58', 'pg', 'prom-client', 'zod', 'node:crypto', 'node:fs', 'node:http', 'node:timers/promises']);
  for (const name of readdirSync(new URL('../src', import.meta.url)).filter(n => n.endsWith('.ts'))) {
    const text = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
    const ast = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const spec = node.moduleSpecifier;
        if (spec && ts.isStringLiteral(spec)) assert(allowed.has(spec.text) || /^\.\/[\w-]+\.js$/.test(spec.text), `${name}: ${spec.text}`);
      }
      if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, 'no hidden dynamic import');
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.doesNotMatch(text, /\b(Keypair|Signer|epochRoller|anchorClient|createPrivateKey|createSign|sendRawTransaction|sendTransaction|requestAirdrop|eval|require)\b/, name);
    if (name !== 'artifacts.ts') assert.doesNotMatch(text, /\b(readFile|readFileSync|openSync)\b/, name);
  }
});
test('write guard rejects true and ambiguous values before HTTP/ingestion startup', () => {
  for (const value of ['true', 'TRUE', '1', 'yes', '']) {
    assert.throws(() => loadConfig({ WATCHTOWER_ENABLE_WRITES: value }), /WRITES_FORBIDDEN/);
  }
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/watchtower-exporter.ts'], {
    cwd: new URL('..', import.meta.url), timeout: 5000,
    env: { ...process.env, WATCHTOWER_ENABLE_WRITES: 'true', WATCHTOWER_EXPORTER_TOKEN: 'never-print-this-credential',
      WATCHTOWER_DATABASE_URL: 'postgres://never-connect.invalid/db', WATCHTOWER_RPC_URL: 'http://never-connect.invalid' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /WRITES_FORBIDDEN/);
  assert.doesNotMatch(result.stdout + result.stderr, /EXPORTER_STARTED|never-print|never-connect/);
});
test('config is fail-closed; safe response contains no private infrastructure or identity secret', () => {
  assert.throws(() => loadConfig({}), /INVALID_CONFIG/);
  assert.throws(() => loadConfig({ WATCHTOWER_EXPORTER_TOKEN: 'test'.repeat(10), WATCHTOWER_DATABASE_URL: 'postgres://unused.invalid/db', WATCHTOWER_PLAYER_HASH_SALT: 'forbidden' }), /INVALID_CONFIG/);
  assert.deepEqual(safeConfig(config()), { gameId: 'ares1', network: 'devnet', programConfigured: true,
    deploymentVerified: false, dataQuality: 'partial', writes: false });
  assert.equal(manifest.lastVerifiedAt, null);
});
