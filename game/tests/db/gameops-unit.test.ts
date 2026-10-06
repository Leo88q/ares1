/**
 * Юнит-тесты слоя game_ops без БД: контракты, от которых зависит всё остальное.
 *
 * Здесь проверяется то, что нельзя проверить «на глаз»: канонизация строки
 * журнала (её изменение ломает совместимость со старыми цепочками), поведение
 * verifyChain на подмене/разрыве/несовпадении головы, детерминизм Merkle-корня
 * и непостоянство nonce, а также целостность самих файлов миграций (порядок,
 * контрольные суммы, наличие ключевых запретов).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalLedgerRow, computeRowHash, GENESIS_HASH, hashStoredRow, merkleRoot, verifyChain, deriveNonce, type LedgerRow } from '../../apps/backend/src/gameops/hash.js';
import { GameOpsError, mapDbError, safeDbError } from '../../apps/backend/src/gameops/errors.js';
import { loadGameOpsConfig } from '../../apps/backend/src/gameops/env.js';
import { stableStringify, hashAuditDetail } from '../../apps/backend/src/gameops/audit.js';
import { loadMigrations } from '../../scripts/db-common.js';

const blockTime = new Date('2026-09-28T00:00:00.000Z');

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: '1',
    chain_id: 'reward',
    recipient_ata: 'RecipientAta111111111111111111111111111111',
    amount_micro: '1000',
    signature: 'Sig'.repeat(22) + 'x',
    slot: '42',
    block_time: blockTime,
    intent_id: null,
    prev_hash: GENESIS_HASH,
    row_hash: '',
    ...overrides,
  };
}

function linked(rows: LedgerRow[]): LedgerRow[] {
  let prev = GENESIS_HASH;
  return rows.map((entry, index) => {
    const base = { ...entry, id: String(index + 1), prev_hash: prev };
    const hash = hashStoredRow(prev, base);
    prev = hash;
    return { ...base, row_hash: hash };
  });
}

test('canonicalLedgerRow: порядок и форма полей фиксированы', () => {
  const canonical = canonicalLedgerRow({
    chainId: 'reward',
    recipientAta: 'Ata',
    amountMicro: 1000n,
    signature: 'Sig',
    slot: 42n,
    blockTime,
    intentId: 7n,
  });
  assert.equal(canonical, 'reward|Ata|1000|Sig|42|2026-09-28T00:00:00.000Z|7');
});

test('canonicalLedgerRow: пустой intent_id — пустая строка, а не "null"', () => {
  const withNull = canonicalLedgerRow({ chainId: 'reward', recipientAta: 'Ata', amountMicro: 1n, signature: 'S', slot: 1n, blockTime, intentId: null });
  assert.ok(withNull.endsWith('|'), `ожидался пустой хвост, получено: ${withNull}`);
});

test('computeRowHash: хэш зависит от prev_hash (изменение головы двигает всю цепочку)', () => {
  const payload = { chainId: 'reward', recipientAta: 'Ata', amountMicro: 1n, signature: 'S', slot: 1n, blockTime, intentId: null };
  const first = computeRowHash(GENESIS_HASH, payload);
  const second = computeRowHash(computeRowHash(GENESIS_HASH, payload), payload);
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('verifyChain: валидная цепочка проходит, голова и row_count сверяются', () => {
  const rows = linked([row(), row({ amount_micro: '2000' }), row({ slot: '43' })]);
  const head = { lastHash: rows[2]!.row_hash, lastId: 3n, rowCount: 3n };
  assert.deepEqual(verifyChain(rows, { expectedChainId: 'reward', head, full: true }), { ok: true, checked: 3 });
});

test('verifyChain: подмена содержимого ловится (content_mismatch)', () => {
  const rows = linked([row(), row()]);
  rows[1] = { ...rows[1]!, amount_micro: '999999' };
  const report = verifyChain(rows, { expectedChainId: 'reward' });
  assert.equal(report.ok, false);
  assert.equal(report.reason, 'content_mismatch');
  assert.equal(report.brokenAt, '2');
});

test('verifyChain: удаление строки ловится (link_broken)', () => {
  const rows = linked([row(), row({ amount_micro: '2' }), row({ amount_micro: '3' })]);
  const withoutMiddle = [rows[0]!, rows[2]!];
  const report = verifyChain(withoutMiddle, { expectedChainId: 'reward' });
  assert.equal(report.ok, false);
  assert.equal(report.reason, 'link_broken');
});

test('verifyChain: откат головы ловится (head_mismatch, row_count_mismatch)', () => {
  const rows = linked([row(), row()]);
  const staleHead = { lastHash: GENESIS_HASH, lastId: 0n, rowCount: 0n };
  const report = verifyChain(rows, { expectedChainId: 'reward', head: staleHead, full: true });
  assert.equal(report.ok, false);
  assert.equal(report.reason, 'head_mismatch');
});

test('verifyChain: хвост проверяется от якоря окна (tail-режим)', () => {
  const rows = linked([row(), row(), row()]);
  const window = [rows[1]!, rows[2]!];
  assert.equal(verifyChain(window, { expectedChainId: 'reward', startPrevHash: rows[0]!.row_hash }).ok, true);
  const forged = [{ ...window[0]!, prev_hash: GENESIS_HASH }, window[1]!];
  assert.equal(verifyChain(forged, { expectedChainId: 'reward', startPrevHash: rows[0]!.row_hash }).ok, false);
});

test('verifyChain: чужая цепочка в окне не проходит', () => {
  const rows = linked([row({ chain_id: 'other' })]);
  const report = verifyChain(rows, { expectedChainId: 'reward' });
  assert.equal(report.ok, false);
  assert.equal(report.reason, 'content_mismatch');
});

test('merkleRoot: детерминирован, зависит от листьев, пустой набор — sha256("")', () => {
  const leaves = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
  assert.equal(merkleRoot(leaves), merkleRoot([...leaves].reverse()));
  assert.notEqual(merkleRoot(leaves), merkleRoot([leaves[0]!, leaves[1]!]));
  assert.equal(merkleRoot([]), createHash('sha256').update('').digest('hex'));
});

test('deriveNonce: детерминирован по событию и различает события', () => {
  assert.equal(deriveNonce(['epoch', 41, 'ata']), deriveNonce(['epoch', 41, 'ata']));
  assert.notEqual(deriveNonce(['epoch', 41, 'ata']), deriveNonce(['epoch', 42, 'ata']));
  assert.ok(deriveNonce(['x']) <= 0x7fffffffffffffffn);
});

test('mapDbError: коды триггеров превращаются в стабильные ошибки', () => {
  const mapped = mapDbError({ code: 'P0001', message: 'LEDGER_CHAIN_MISMATCH: цепочка не сходится' });
  assert.equal(mapped.code, 'CHAIN_MISMATCH');
  assert.equal(mapped.status, 409);
  assert.equal(mapDbError({ code: '42P01' }).code, 'MIGRATIONS_MISSING');
  assert.equal(mapDbError({ code: '42501' }).status, 403);
  assert.equal(mapDbError({ code: '23505', constraint: 'reward_intents_recipient_nonce_key' }).code, 'DUPLICATE_INTENT');
  // Неизвестная ошибка не должна раскрывать текст драйвера.
  assert.equal(mapDbError(new Error('password=hunter2 in connection')).message, 'Внутренняя ошибка слоя данных');
});

test('safeDbError: URL и секреты вырезаются из логов', () => {
  const message = safeDbError(new Error('connect postgres://user:secret@db:5432/ares1 password=abc token: xyz'));
  assert.ok(!message.includes('secret'), message);
  assert.ok(!message.includes('abc'), message);
  assert.ok(message.includes('[REDACTED'));
});

test('loadGameOpsConfig: без URL слой выключен, с URL — требует токен ≥32', () => {
  assert.equal(loadGameOpsConfig({}), null);
  assert.throws(() => loadGameOpsConfig({ GAME_OPS_DATABASE_URL: 'postgres://localhost/ares1' }), /ADMIN_API_TOKEN/);
  const config = loadGameOpsConfig({
    GAME_OPS_DATABASE_URL: 'postgres://localhost/ares1',
    ADMIN_API_TOKEN: 'a'.repeat(32),
    GAME_OPS_DB_ROLE: 'game_ops_writer',
  });
  assert.equal(config?.expectedSchemaVersion, 6);
  assert.equal(config?.role, 'game_ops_writer');
  assert.throws(() => loadGameOpsConfig({
    GAME_OPS_DATABASE_URL: 'postgres://localhost/ares1',
    ADMIN_API_TOKEN: 'a'.repeat(32),
    GAME_OPS_DB_ROLE: 'Bad Role!',
  }), /GAME_OPS_DB_ROLE/);
});

test('stableStringify/hashAuditDetail: дайджест не зависит от порядка ключей', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  assert.equal(hashAuditDetail({ a: 1, b: 2 }), hashAuditDetail({ b: 2, a: 1 }));
  assert.notEqual(hashAuditDetail({ a: 1 }), hashAuditDetail({ a: 2 }));
  assert.match(hashAuditDetail({}), /^[0-9a-f]{64}$/);
});

test('GameOpsError: код и HTTP-статус не теряются', () => {
  const error = new GameOpsError('CHAIN_MISMATCH', 'разрыв', 'деталь', 409);
  assert.equal(error.code, 'CHAIN_MISMATCH');
  assert.equal(error.status, 409);
  assert.equal(error.detail, 'деталь');
});

test('миграции: порядок, уникальность версий, ключевые запреты на месте', () => {
  const files = loadMigrations();
  assert.ok(files.length >= 3, `ожидалось ≥3 файлов, найдено ${files.length}`);
  assert.deepEqual(files.map(file => file.version), [...files.map(file => file.version)].sort((a, b) => a - b));
  assert.equal(new Set(files.map(file => file.version)).size, files.length);
  for (const file of files) assert.match(file.checksum, /^[0-9a-f]{64}$/);

  const immutability = files.find(file => file.fileName.includes('immutability'))!;
  for (const guard of ['deny_mutation', 'ledger_validate_batch', 'reward_intents_guard', 'CURSOR_VERSION_CONFLICT']) {
    assert.ok(immutability.sql.includes(guard), `в ${immutability.fileName} нет ${guard}`);
  }
  const roles = files.find(file => file.fileName.includes('roles'))!;
  for (const grant of ['game_ops_writer', 'game_ops_reader', 'GRANT UPDATE (state, signature, slot, failure_code', 'REVOKE UPDATE, DELETE ON game_ops.reward_ledger']) {
    assert.ok(roles.sql.includes(grant), `в ${roles.fileName} нет «${grant}»`);
  }
  const schema = files.find(file => file.fileName.startsWith('0001'))!;
  for (const table of ['reward_intents', 'reward_ledger', 'ledger_chain_head', 'admin_audit', 'chain_reconciliation', 'service_cursors']) {
    assert.ok(schema.sql.includes(`game_ops.${table}`), `в схеме нет ${table}`);
  }
});
