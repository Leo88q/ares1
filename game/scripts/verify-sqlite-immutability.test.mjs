import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Самопроверка приёмочного скрипта: на синтетической БД, повторяющей описанный
// слой (economy v2 append-only + admin_audit + память агента с HMAC-цепочкой +
// Merkle-лист), проверяем, что инструмент ДЕЙСТВИТЕЛЬНО ловит посаженные дыры,
// а на корректной схеме не даёт блокирующих находок. Без этого «зелёный»
// результат инструмента ничего не стоил бы.

const SCRIPT = path.join(import.meta.dirname, 'verify-sqlite-immutability.mjs');
const TEMPLATE = '{id}|{kind}|{payload}|{created_at}';
const KEY = 'k'.repeat(40);

function hmacOf(row) {
  return createHmac('sha256', KEY)
    .update(TEMPLATE.replace(/\{(\w+)\}/g, (_, key) => String(row[key] ?? '')))
    .digest('hex');
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Merkle-корень той же формы, что в инструменте: sha256 от сортированных пар. */
function root(leaves) {
  let level = [...leaves].sort();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(createHash('sha256').update(Buffer.from(left, 'hex')).update(Buffer.from(right, 'hex')).digest('hex'));
    }
    level = next;
  }
  return level[0];
}

function buildFixture({ holey }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sqlite-fixture-'));
  const dbPath = path.join(dir, 'backend.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE economy_v2_events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, amount INTEGER NOT NULL);
    CREATE TRIGGER economy_v2_events_no_update BEFORE UPDATE ON economy_v2_events
      BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    CREATE TRIGGER economy_v2_events_no_delete BEFORE DELETE ON economy_v2_events
      BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    CREATE TABLE economy_legacy_events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, amount INTEGER NOT NULL);
    CREATE TABLE wallets (id INTEGER PRIMARY KEY, address TEXT NOT NULL);
    CREATE TABLE admin_audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE agent_memory (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
      created_at TEXT NOT NULL, hmac TEXT NOT NULL, prev_hmac TEXT NOT NULL);
    CREATE TABLE epoch_leaves (id INTEGER PRIMARY KEY, leaf_hash TEXT NOT NULL);
  `);
  // economy_legacy_events: в эталоне обе защиты; в «дырявой» БД намеренно нет DELETE-защиты.
  db.exec(`
    CREATE TRIGGER economy_legacy_no_update BEFORE UPDATE ON economy_legacy_events
      BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    ${holey ? '' : `CREATE TRIGGER economy_legacy_no_delete BEFORE DELETE ON economy_legacy_events
      BEGIN SELECT RAISE(ABORT, 'append-only'); END;`}
  `);
  // Память агента: в эталоне обе защиты; в «дырявой» БД защиты сняты (так делает
  // атакующий, у которого есть запись в файл — это и должна показать проверка).
  if (!holey) {
    db.exec(`
      CREATE TRIGGER agent_memory_no_update BEFORE UPDATE ON agent_memory
        BEGIN SELECT RAISE(ABORT, 'append-only'); END;
      CREATE TRIGGER agent_memory_no_delete BEFORE DELETE ON agent_memory
        BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    `);
  }
  // admin_audit: в эталоне аудируются INSERT/UPDATE/DELETE по wallets; в «дырявой» нет UPDATE/DELETE.
  db.exec(`
    CREATE TRIGGER wallets_audit AFTER INSERT ON wallets
      BEGIN INSERT INTO admin_audit(actor, action, created_at) VALUES ('system', 'wallets.insert', datetime('now')); END;
    ${holey ? '' : `CREATE TRIGGER wallets_audit_update AFTER UPDATE ON wallets
      BEGIN INSERT INTO admin_audit(actor, action, created_at) VALUES ('system', 'wallets.update', datetime('now')); END;
    CREATE TRIGGER wallets_audit_delete AFTER DELETE ON wallets
      BEGIN INSERT INTO admin_audit(actor, action, created_at) VALUES ('system', 'wallets.delete', datetime('now')); END;`}
  `);
  db.prepare('INSERT INTO economy_v2_events(kind, amount) VALUES (?, ?)').run('harvest', 10);
  db.prepare('INSERT INTO economy_legacy_events(kind, amount) VALUES (?, ?)').run('legacy', 5);
  db.prepare('INSERT INTO wallets(address) VALUES (?)').run('wallet-1');

  const rows = [
    { id: 1, kind: 'note', payload: 'первая запись', created_at: '2026-09-27T00:00:00Z' },
    { id: 2, kind: 'note', payload: 'вторая запись', created_at: '2026-09-27T00:01:00Z' },
  ];
  let previous = '';
  for (const row of rows) {
    // В «дырявой» БД строка 1 подписана чужим HMAC, у строки 2 разорвана цепочка.
    const hmac = holey && row.id === 1 ? 'f'.repeat(64) : hmacOf(row);
    const prevHmac = holey && row.id === 2 ? 'dead'.repeat(16) : previous;
    db.prepare('INSERT INTO agent_memory(id, kind, payload, created_at, hmac, prev_hmac) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.kind, row.payload, row.created_at, hmac, prevHmac);
    previous = hmac;
  }

  const leaves = [sha256Hex('лист дня:1'), sha256Hex('лист дня:2')];
  for (const [index, leaf] of leaves.entries()) {
    db.prepare('INSERT INTO epoch_leaves(id, leaf_hash) VALUES (?, ?)').run(index + 1, leaf);
  }
  db.close();
  chmodSync(dbPath, 0o600);

  const configPath = path.join(dir, 'checks.json');
  writeFileSync(configPath, JSON.stringify({
    appendOnly: ['economy_v2_events', 'economy_legacy_events', 'agent_memory'],
    audit: { table: 'admin_audit', subjects: ['wallets'] },
    hmac: [{ table: 'agent_memory', column: 'hmac', keyEnv: 'AGENT_MEMORY_HMAC_KEY', template: TEMPLATE,
      chain: { column: 'prev_hmac', orderBy: 'id', genesis: '' } }],
    merkle: { table: 'epoch_leaves', template: '{leaf_hash}', root: holey ? 'f'.repeat(64) : root(leaves) },
  }, null, 1));
  return { dbPath, configPath };
}

function runVerifier(fixture) {
  const result = spawnSync('node', [SCRIPT, '--db', fixture.dbPath, '--config', fixture.configPath, '--json'],
    { encoding: 'utf8', env: { ...process.env, AGENT_MEMORY_HMAC_KEY: KEY } });
  assert(result.stdout, `нет вывода; stderr=${result.stderr}`);
  return { status: result.status, report: JSON.parse(result.stdout) };
}

const codes = report => report.findings.map(f => f.code);

test('эталонная схема: HMAC-цепочка и Merkle сходятся, блокирующих находок нет', () => {
  const { status, report } = runVerifier(buildFixture({ holey: false }));
  assert.deepEqual(codes(report).filter(c => ['CRITICAL', 'HIGH'].includes(report.findings.find(f => f.code === c).severity)), []);
  assert.equal(report.summary.critical, 0);
  assert.equal(report.summary.high, 0);
  assert.equal(report.hmac[0].mismatches, 0);
  assert.equal(report.hmac[0].chained, 2);
  assert.equal(report.merkle.expectedRoot, report.merkle.computedRoot);
  assert.equal(status, 0);
});

test('посаженные дыры находятся: нет DELETE-триггера, нет аудита, подмена HMAC, разрыв цепочки, чужой Merkle-корень', () => {
  const { status, report } = runVerifier(buildFixture({ holey: true }));
  const found = codes(report);
  for (const expected of ['MISSING_DELETE_GUARD', 'MISSING_UPDATE_GUARD', 'AUDIT_TRIGGER_MISSING', 'HMAC_MISMATCH', 'HMAC_CHAIN_BROKEN', 'MERKLE_ROOT_MISMATCH']) {
    assert(found.includes(expected), `не найдено: ${expected}; найдено: ${found.join(', ')}`);
  }
  assert.equal(report.summary.critical >= 3, true);
  assert.equal(status, 1);
});

test('исходный файл БД не изменяется: пробы идут по копии', () => {
  const fixture = buildFixture({ holey: false });
  const before = new DatabaseSync(fixture.dbPath, { readOnly: true });
  const beforeRows = before.prepare('SELECT count(*) AS n FROM agent_memory').get().n;
  const beforePayload = before.prepare('SELECT payload FROM agent_memory WHERE id = 1').get().payload;
  before.close();
  runVerifier(fixture);
  const after = new DatabaseSync(fixture.dbPath, { readOnly: true });
  assert.equal(after.prepare('SELECT count(*) AS n FROM agent_memory').get().n, beforeRows);
  assert.equal(after.prepare('SELECT payload FROM agent_memory WHERE id = 1').get().payload, beforePayload);
  assert.equal(after.prepare("SELECT count(*) AS n FROM economy_v2_events").get().n, 1);
  after.close();
});
