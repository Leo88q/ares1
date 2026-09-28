/**
 * Мутационные тесты слоя БД: «сломали — поймали?»
 *
 * Тест оборачивает `scripts/db-mutate.ts` и требует, чтобы КАЖДАЯ внутренняя
 * мутация (подмена строки журнала, удаление строки, откат головы, вброс строки
 * в обход триггера, расширение прав, удаление guard-триггера, подмена суммы
 * интента) была обнаружена продуктовым детектором. Плюс отдельная проверка
 * внешнего якоря аудита: без него удаление строки аудита неотличимо от «события
 * не было» — это честно фиксируется, а не замалчивается.
 *
 * Запуск:
 *   GAME_OPS_TEST_URL=postgres://… yarn test:db
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { runMutations, writeAnchor } from '../../scripts/db-mutate.js';
import { verifyDatabase } from '../../scripts/db-verify.js';
import { ata, signature } from './helpers.js';

const url = process.env.GAME_OPS_TEST_URL ?? '';
const chainId = process.env.GAME_OPS_TEST_CHAIN ?? 'reward';
const writerRole = process.env.GAME_OPS_TEST_ROLE ?? 'game_ops_writer';
const enabled = Boolean(url);
const skip = enabled ? false : 'GAME_OPS_TEST_URL не задан: мутационные тесты требуют живой PostgreSQL';
const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Сид: мутациям нужны строки журнала; если стенд пустой — создаём свои. */
async function seedLedger(): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 2, application_name: 'ares1-test-seed' });
  try {
    const existing = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM game_ops.reward_ledger WHERE chain_id = $1', [chainId]);
    if (Number(existing.rows[0]?.count ?? '0') >= 5) return;
    const { appendBatch } = await import('../../apps/backend/src/gameops/ledger.js');
    const runId = `seed${Date.now().toString(36)}`;
    await appendBatch(pool, Array.from({ length: 10 }, (_, index) => ({
      recipientAta: ata(`seed:${runId}`),
      amountMicro: BigInt(500 + index),
      signature: signature(`seed:${runId}:${index}`),
      slot: BigInt(900_000_000 + index),
      blockTime: new Date('2026-09-27T00:00:00.000Z'),
      chainId,
    })), 'test:mutation-seed', chainId);
  } finally {
    await pool.end();
  }
}

test('мутации слоя БД: все внутренние дефекты обнаружены', { skip }, async () => {
  const anchorDir = mkdtempSync(path.join(tmpdir(), 'ares1-anchor-'));
  const anchorFile = path.join(anchorDir, 'audit-anchor.json');
  try {
    await seedLedger();
    // Внешний якорь аудита: состояние фиксируется ВНЕ БД (в реальном деплое —
    // защищённое хранилище/репозиторий инфраструктуры, здесь — временный файл).
    const client = new pg.Client({ connectionString: url, application_name: 'ares1-test-anchor' });
    await client.connect();
    const stats = await client.query<{ count: string; max_id: string | null }>(
      'SELECT count(*)::text AS count, max(id)::text AS max_id FROM game_ops.admin_audit',
    );
    await client.end();
    writeAnchor(anchorFile, Number(stats.rows[0]?.count ?? '0'), stats.rows[0]?.max_id ?? '0');

    const reports = await runMutations({ url, writerRole, chainId, anchorFile, logger: silentLogger });
    const internal = reports.filter(report => report.seam === 'internal');
    assert.ok(internal.length >= 6, `ожидалось ≥6 внутренних мутаций, получено ${internal.length}`);
    for (const report of internal) {
      assert.equal(report.detected, true, `мутация ${report.id} не поймана: ${report.detail}`);
    }
    const anchorProbe = reports.find(report => report.seam === 'external-anchor')!;
    assert.equal(anchorProbe.detected, true, `удаление аудита не поймано даже с якорем: ${anchorProbe.detail}`);
  } finally {
    rmSync(anchorDir, { recursive: true, force: true });
  }
});

test('мутации не портят базу: журнал сходится после прогона', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2, application_name: 'ares1-test-post-mutation' });
  try {
    const { verifyChainTail } = await import('../../apps/backend/src/gameops/ledger.js');
    const report = await verifyChainTail(pool, { chainId, limit: 5_000, full: true });
    assert.equal(report.ok, true, `после мутаций цепочка разошлась: ${report.reason} на ${report.brokenAt}`);
  } finally {
    await pool.end();
  }
});

test('приёмка db:verify проходит на рабочем стенде', { skip }, async () => {
  const result = await verifyDatabase({ url, writerRole, chainId, logger: silentLogger });
  const failed = result.checks.filter(check => !check.ok);
  assert.deepEqual(failed.map(check => check.id), [], `проваленные проверки: ${failed.map(check => `${check.id} (${check.detail})`).join('; ')}`);
});

test('приёмка ловит снятую защиту: расширенные права видны db:verify', { skip }, async () => {
  const client = new pg.Client({ connectionString: url, application_name: 'ares1-test-privilege' });
  await client.connect();
  try {
    // Права меняются зафиксированно (иначе отдельное соединение verify их не
    // увидит), затем обязательно возвращаются назад — тест не оставляет след.
    await client.query(`GRANT UPDATE ON game_ops.reward_ledger TO ${writerRole}`);
    const widened = await verifyDatabase({ url, writerRole, chainId, logger: silentLogger });
    const check = widened.checks.find(entry => entry.id === 'privileges.ledger_immutable')!;
    assert.equal(check.ok, false, 'приёмка обязана заметить у писателя право UPDATE на журнал');
  } finally {
    await client.query(`REVOKE UPDATE ON game_ops.reward_ledger FROM ${writerRole}`).catch(() => undefined);
    await client.end();
  }
  const restored = await verifyDatabase({ url, writerRole, chainId, logger: silentLogger });
  const privileges = restored.checks.find(check => check.id === 'privileges.ledger_immutable')!;
  assert.equal(privileges.ok, true, `права не восстановились: ${privileges.detail}`);
});
