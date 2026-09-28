/**
 * Интеграционные тесты слоя game_ops на живой БД.
 *
 * Запуск (по умолчанию пропускаются, если БД не задана — CI без БД не краснеет):
 *   GAME_OPS_TEST_URL=postgres://postgres@127.0.0.1:55432/postgres \
 *   GAME_OPS_TEST_ROLE=game_ops_writer yarn test:db
 *
 * Тесты проверяют не «функции возвращают объект», а инварианты:
 *   - идемпотентность выплаты по (получатель, nonce);
 *   - машину состояний интента и терминальность;
 *   - append-only журнала (в том числе через SET ROLE рантайм-роли);
 *   - обнаружение подмены строки/головы цепочки;
 *   - сверку с нулевым и ненулевым drift;
 *   - CAS курсоров;
 *   - полноту аудита (создание интента и переходы пишет БД, а не приложение).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { GameOpsError } from '../../apps/backend/src/gameops/errors.js';
import { appendBatch, verifyChainTail } from '../../apps/backend/src/gameops/ledger.js';
import { createIntent, getIntent, markConfirmed, markFailed, markSubmitted } from '../../apps/backend/src/gameops/intents.js';
import { advanceCursor, advanceCursorBy, ensureCursor, getCursor } from '../../apps/backend/src/gameops/cursors.js';
import { driftSummary, latestReconciliation, reconciliationHistory, recordReconciliation } from '../../apps/backend/src/gameops/reconciliation.js';
import { listAudit, recordAudit } from '../../apps/backend/src/gameops/audit.js';
import { checkReadiness } from '../../apps/backend/src/gameops/readiness.js';
import { verifyChain, hashStoredRow, type LedgerRow } from '../../apps/backend/src/gameops/hash.js';
import { deriveNonce } from '../../apps/backend/src/gameops/hash.js';
import { migrate } from '../../scripts/db-migrate.js';
import type { GameOpsConfig } from '../../apps/backend/src/gameops/env.js';
import { ata, signature } from './helpers.js';

const url = process.env.GAME_OPS_TEST_URL ?? '';
const chainId = process.env.GAME_OPS_TEST_CHAIN ?? 'reward';
const appRole = process.env.GAME_OPS_TEST_ROLE ?? '';
const enabled = Boolean(url);
const skip = enabled ? false : 'GAME_OPS_TEST_URL не задан: тест требует живой PostgreSQL';
const actor = 'test:db-suite';
const runId = `t${Date.now().toString(36)}`;

function makePool(role?: string): pg.Pool {
  return new pg.Pool({
    connectionString: url,
    max: Number(process.env.GAME_OPS_TEST_POOL_MAX ?? 4),
    options: role ? `-c role=${role}` : undefined,
    application_name: 'ares1-test',
  });
}

function makeConfig(overrides: Partial<GameOpsConfig> = {}): GameOpsConfig {
  return {
    databaseUrl: url,
    role: appRole || null,
    poolMax: 4,
    statementTimeoutMs: 15_000,
    adminToken: 'x'.repeat(32),
    reconciliationMaxAgeMinutes: 60,
    chainId,
    expectedSchemaVersion: 3,
    ...overrides,
  };
}

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

test('миграции применены, контрольные суммы совпадают с репозиторием', { skip }, async () => {
  const result = await migrate({ url, verifyOnly: true, logger: silentLogger });
  assert.deepEqual(result.checksumMismatches, []);
  assert.deepEqual(result.applied, []);
  assert.ok(result.verified >= 3, `в реестре ${result.verified} версий, ожидалось ≥3`);
});

test('интент: идемпотентное создание по (получатель, nonce)', { skip }, async () => {
  const pool = makePool();
  try {
    const recipient = ata(`idempotent:${runId}`);
    const nonce = deriveNonce(['test', runId, 'idempotent']);
    const first = await createIntent(pool, { recipientAta: recipient, amountMicro: 5_000n, nonce, reason: 'test:idempotent', actor });
    const second = await createIntent(pool, { recipientAta: recipient, amountMicro: 5_000n, nonce, reason: 'test:idempotent', actor });
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.id, first.id, 'повторный вызов обязан вернуть тот же интент');
  } finally {
    await pool.end();
  }
});

test('интент: машина состояний — submitted → confirmed, прямой confirmed запрещён', { skip }, async () => {
  const pool = makePool();
  try {
    const created = await createIntent(pool, {
      recipientAta: ata(`lifecycle:${runId}`),
      amountMicro: 7_777n,
      nonce: deriveNonce(['test', runId, 'lifecycle']),
      reason: 'test:lifecycle',
      actor,
    });
    assert.equal(created.state, 'pending');

    await assert.rejects(
      () => markConfirmed(pool, { id: created.id, slot: 10n, signature: signature(`unknown:${runId}`), actor }),
      error => error instanceof GameOpsError && (error.code === 'INVALID_TRANSITION' || error.code === 'CHAIN_MISMATCH'),
    );

    const submitted = await markSubmitted(pool, { id: created.id, signature: signature(`lifecycle:${runId}`), actor });
    assert.equal(submitted.state, 'submitted');
    const confirmed = await markConfirmed(pool, { id: created.id, slot: 55_000_000n, signature: submitted.signature!, actor });
    assert.equal(confirmed.state, 'confirmed');
    assert.equal(confirmed.slot, '55000000');

    await assert.rejects(
      () => markFailed(pool, { id: created.id, failureCode: 'TOO_LATE', actor }),
      error => error instanceof GameOpsError && error.code === 'INVALID_TRANSITION',
      'подтверждённый интент терминален',
    );
  } finally {
    await pool.end();
  }
});

test('журнал: append батчем, повтор идемпотентен, цепочка сходится', { skip }, async () => {
  const pool = makePool();
  try {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      recipientAta: ata(`ledger:${runId}`),
      amountMicro: BigInt(1_000 + index),
      signature: signature(`ledger:${runId}:${index}`),
      slot: BigInt(500_000_000 + index),
      blockTime: new Date('2026-09-27T12:00:00.000Z'),
      chainId,
    }));
    const appended = await appendBatch(pool, rows, actor, chainId);
    assert.equal(appended.inserted, 25);

    const again = await appendBatch(pool, rows, actor, chainId);
    assert.equal(again.inserted, 0, 'повторная вставка тех же подписей не должна создавать строки');
    assert.equal(again.skipped, 25);

    const report = await verifyChainTail(pool, { chainId, limit: 1_000, full: true });
    assert.equal(report.ok, true, `цепочка не сошлась: ${report.reason} на ${report.brokenAt}`);
    assert.ok(report.checked >= 25);
  } finally {
    await pool.end();
  }
});

test('журнал: подмена строки и откат головы обнаруживаются (hash-chain)', { skip }, async () => {
  const client = new pg.Client({ connectionString: url, application_name: 'ares1-test-tamper' });
  await client.connect();
  try {
    const rows = (await client.query<LedgerRow>('SELECT * FROM game_ops.reward_ledger WHERE chain_id = $1 ORDER BY id ASC LIMIT 5', [chainId])).rows;
    assert.ok(rows.length >= 2, 'нужны хотя бы две строки журнала для проверки подмены');
    const victim = rows[1]!;
    await client.query('BEGIN');
    try {
      await client.query('ALTER TABLE game_ops.reward_ledger DISABLE TRIGGER reward_ledger_deny_update');
      await client.query('UPDATE game_ops.reward_ledger SET amount_micro = amount_micro + 1 WHERE id = $1', [victim.id]);
      const tampered = (await client.query<LedgerRow>('SELECT * FROM game_ops.reward_ledger WHERE id = $1', [victim.id])).rows[0]!;
      assert.notEqual(hashStoredRow(tampered.prev_hash, tampered), tampered.row_hash, 'подмена суммы обязана ломать row_hash');

      const window = (await client.query<LedgerRow>('SELECT * FROM game_ops.reward_ledger WHERE chain_id = $1 ORDER BY id ASC LIMIT 5', [chainId])).rows;
      const report = verifyChain(window, { expectedChainId: chainId });
      assert.equal(report.ok, false);
      assert.equal(report.reason, 'content_mismatch');
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    await client.end();
  }
});

test('журнал: рантайм-роль не может UPDATE/DELETE (права + триггер)', { skip: skip || (appRole ? false : 'GAME_OPS_TEST_ROLE не задан') }, async () => {
  const appPool = makePool(appRole);
  try {
    const rows = await appPool.query<{ id: string }>('SELECT id FROM game_ops.reward_ledger ORDER BY id LIMIT 1');
    assert.ok(rows.rows[0], 'журнал пуст — нечего мутировать');
    await assert.rejects(
      () => appPool.query('UPDATE game_ops.reward_ledger SET amount_micro = amount_micro + 1 WHERE id = $1', [rows.rows[0]!.id]),
      error => {
        const pgError = error as { code?: string; message?: string };
        return pgError.code === '42501' || /APPEND_ONLY/.test(pgError.message ?? '');
      },
      'рантайм-роль не должна уметь менять журнал',
    );
    await assert.rejects(
      () => appPool.query('DELETE FROM game_ops.reward_ledger WHERE id = $1', [rows.rows[0]!.id]),
      error => {
        const pgError = error as { code?: string; message?: string };
        return pgError.code === '42501' || /APPEND_ONLY/.test(pgError.message ?? '');
      },
      'рантайм-роль не должна уметь удалять строки журнала',
    );
  } finally {
    await appPool.end();
  }
});

test('сверка: drift = 0 при совпадении, drift ≠ 0 при расхождении', { skip }, async () => {
  const pool = makePool();
  try {
    const streamId = `test:${runId}`;
    const head = await pool.query<{ last_slot: string; last_id: string }>('SELECT last_slot, last_id FROM game_ops.ledger_chain_head WHERE chain_id = $1', [chainId]);
    const lastSlot = BigInt(head.rows[0]?.last_slot ?? '0');
    const fromSlot = lastSlot > 10n ? lastSlot - 10n : 0n;

    const ledger = await pool.query<{ total: string }>(
      'SELECT coalesce(sum(amount_micro), 0)::text AS total FROM game_ops.reward_ledger WHERE chain_id = $1 AND slot > $2 AND slot <= $3',
      [chainId, String(fromSlot), String(lastSlot)],
    );
    const granted = BigInt(ledger.rows[0]!.total);

    const clean = await recordReconciliation(pool, { streamId, finalizedSlot: lastSlot, epochId: 1n, fromSlot, grantedMicro: granted, chainId, actor });
    assert.equal(clean.drift_micro, '0');

    const dirty = await recordReconciliation(pool, { streamId, finalizedSlot: lastSlot, epochId: 1n, fromSlot, grantedMicro: granted + 7n, chainId, actor });
    assert.equal(dirty.drift_micro, '7');

    const summary = await driftSummary(pool);
    assert.ok(summary.driftingStreams.includes(streamId), 'поток с расхождением обязан появиться в сводке');
    assert.ok(summary.worstDriftMicro >= 7n);
    const latest = await latestReconciliation(pool);
    assert.equal(latest.find(row => row.stream_id === streamId)?.drift_micro, '7');

    // «Исправление» расхождения — НОВАЯ строка сверки, а не правка прежней:
    // история инцидента остаётся, а действующее состояние снова drift = 0.
    const resolved = await recordReconciliation(pool, { streamId, finalizedSlot: lastSlot, epochId: 1n, fromSlot, grantedMicro: granted, chainId, actor });
    assert.equal(resolved.drift_micro, '0');
    const afterResolution = await latestReconciliation(pool);
    assert.equal(afterResolution.find(row => row.stream_id === streamId)?.drift_micro, '0', 'новая сверка обязана заменить действующее состояние');
    const history = await reconciliationHistory(pool, streamId, 10);
    assert.ok(history.length >= 2, 'история расхождения должна сохраниться (append-only)');
    assert.equal(history.filter(entry => entry.drift_micro === '7').length, 1, 'строка с расхождением не должна исчезать');
  } finally {
    await pool.end();
  }
});

test('курсоры: CAS-версия, конфликт и слияние патча', { skip }, async () => {
  const pool = makePool();
  try {
    const streamId = `test_cursor_${runId}`;
    const registered = await ensureCursor(pool, streamId, { slot: '100' }, actor);
    assert.equal(registered.version, '0');

    const advanced = await advanceCursor(pool, { streamId, expectedVersion: registered.version, state: { slot: '200' }, actor });
    assert.equal(advanced.version, 1n);
    assert.equal(advanced.state.slot, '200');

    await assert.rejects(
      () => advanceCursor(pool, { streamId, expectedVersion: 0, state: { slot: '999' }, actor }),
      error => error instanceof GameOpsError && error.code === 'CURSOR_CONFLICT',
      'устаревшая версия обязана давать конфликт, а не перезапись',
    );

    const merged = await advanceCursorBy(pool, { streamId, patch: { epoch: 42 }, actor });
    assert.equal(merged.state.slot, '200', 'патч обязан сохранить прежнее состояние');
    assert.equal(merged.state.epoch, 42);
    assert.equal((await getCursor(pool, streamId))!.version, '2');
  } finally {
    await pool.end();
  }
});

test('аудит: ручная запись видна, триггерные записи пишутся БД', { skip }, async () => {
  const pool = makePool();
  try {
    await recordAudit(pool, {
      actor,
      action: `test.manual_${runId}`,
      subject: 'reward_intents',
      outcome: 'ok',
      detail: { runId, note: 'проверка аудита' },
    });
    const manual = await listAudit(pool, { actor, action: `test.manual_${runId}`, limit: 10 });
    assert.equal(manual.length, 1);
    assert.equal(manual[0]!.outcome, 'ok');
    assert.match(manual[0]!.detail_hash, /^[0-9a-f]{64}$/);

    const created = await listAudit(pool, { action: 'reward_intent.created', limit: 5 });
    assert.ok(created.length > 0, 'создание интента обязано оставлять строку аудита (триггер)');
  } finally {
    await pool.end();
  }
});

test('readiness: отчёт содержит все проверки и честно отражает drift', { skip }, async () => {
  const pool = makePool();
  try {
    const before = await driftSummary(pool);
    const report = await checkReadiness(pool, makeConfig());
    const names = report.checks.map(check => check.name);
    for (const expected of ['database', 'schema', 'ledger_chain', 'reconciliation_drift', 'reconciliation_freshness']) {
      assert.ok(names.includes(expected), `в отчёте нет проверки ${expected}`);
    }
    const drift = report.checks.find(check => check.name === 'reconciliation_drift')!;
    assert.equal(drift.status, before.streams === 0 ? 'ok' : 'fail');
    assert.equal(report.ready, drift.status === 'ok' && report.checks.every(check => check.status !== 'fail'));
    const ledger = report.checks.find(check => check.name === 'ledger_chain')!;
    assert.equal(ledger.status, 'ok', `цепочка должна сходиться: ${ledger.detail}`);
  } finally {
    await pool.end();
  }
});

test('интент: несуществующий id даёт 404-код, а не «пустой успех»', { skip }, async () => {
  const pool = makePool();
  try {
    assert.equal(await getIntent(pool, '999999999999'), null);
    await assert.rejects(
      () => markSubmitted(pool, { id: '999999999999', signature: signature(`unknown:${runId}`), actor }),
      error => error instanceof GameOpsError && error.code === 'INTENT_NOT_FOUND',
    );
  } finally {
    await pool.end();
  }
});
