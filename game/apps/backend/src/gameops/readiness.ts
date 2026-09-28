/**
 * Готовность слоя game_ops: fail-closed.
 *
 * Смысл проверки — не «процесс жив», а «можно ли доверять данным». Пять условий:
 *   1) соединение с БД;
 *   2) применены ВСЕ миграции ожидаемой версии (не «хоть какие-то»);
 *   3) цепочка журнала сходится (хвост: содержимое, связность, голова);
 *   4) последняя сверка по каждому потоку имеет drift = 0;
 *   5) сверка не старше `reconciliationMaxAgeMinutes` (устаревшие данные — это
 *      отсутствие доказательства, а не доказательство отсутствия расхождения).
 *
 * Любой `fail` → сервис отвечает 503 и НЕ печёт эпоху: лучше остановка выдачи,
 * чем награды по разошедшимся данным.
 */
import { driftSummary, latestReconciliation } from './reconciliation.js';
import { verifyChainTail } from './ledger.js';
import { GameOpsError, safeDbError } from './errors.js';
import { ping, schemaState, type Pool } from './pool.js';
import type { GameOpsConfig } from './env.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface ReadinessCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
  generatedAt: string;
}

export function httpStatusFor(report: ReadinessReport): number {
  return report.ready ? 200 : 503;
}

function errorDetail(error: unknown): string {
  if (error instanceof GameOpsError) return `${error.code}: ${error.message}`;
  return safeDbError(error);
}

export async function checkReadiness(pool: Pool, config: GameOpsConfig, now = new Date()): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];

  // 1. Соединение
  const alive = await ping(pool);
  checks.push({ name: 'database', status: alive ? 'ok' : 'fail', detail: alive ? 'соединение установлено' : 'БД недоступна' });
  if (!alive) {
    return finish(checks, now);
  }

  // 2. Версия схемы: ожидаем полный набор 1..expectedSchemaVersion
  try {
    const state = await schemaState(pool);
    const missing = Array.from({ length: config.expectedSchemaVersion }, (_, index) => index + 1).filter(version => !state.applied.includes(version));
    checks.push({
      name: 'schema',
      status: missing.length === 0 ? 'ok' : 'fail',
      detail: missing.length === 0
        ? `версия ${config.expectedSchemaVersion} применена (${state.applied.length} файлов)`
        : `не применены миграции: ${missing.join(', ')} (есть: ${state.applied.join(', ') || '—'})`,
    });
    if (missing.length) return finish(checks, now);
  } catch (error) {
    checks.push({ name: 'schema', status: 'fail', detail: errorDetail(error) });
    return finish(checks, now);
  }

  // 3. Цепочка журнала: хвост + голова (быстро, ограничено 500 строками)
  try {
    const chain = await verifyChainTail(pool, { chainId: config.chainId, limit: 500 });
    checks.push({
      name: 'ledger_chain',
      status: chain.ok ? 'ok' : 'fail',
      detail: chain.ok
        ? `проверено ${chain.checked} строк (${chain.mode}), голова сходится`
        : `нарушение ${chain.reason ?? 'unknown'} на строке ${chain.brokenAt ?? '?'}`,
    });
  } catch (error) {
    checks.push({ name: 'ledger_chain', status: 'fail', detail: errorDetail(error) });
  }

  // 4. Расхождения сверки
  try {
    const drift = await driftSummary(pool);
    checks.push({
      name: 'reconciliation_drift',
      status: drift.streams === 0 ? 'ok' : 'fail',
      detail: drift.streams === 0
        ? 'расхождений нет'
        : `потоки с расхождением: ${drift.driftingStreams.join(', ')} (суммарно ${drift.totalDriftMicro})`,
    });
  } catch (error) {
    checks.push({ name: 'reconciliation_drift', status: 'fail', detail: errorDetail(error) });
  }

  // 5. Свежесть сверки
  try {
    const latest = await latestReconciliation(pool);
    if (!latest.length) {
      // Пустой журнал — это нормальное состояние нового стенда, но «доказанной
      // сходимости» ещё нет: warn, а не ok, чтобы не выдавать отсутствие данных
      // за подтверждение.
      checks.push({ name: 'reconciliation_freshness', status: 'warn', detail: 'сверок ещё не было' });
    } else {
      const oldest = latest.reduce((acc, row) => (new Date(row.checked_at) < new Date(acc.checked_at) ? row : acc), latest[0]!);
      const ageMinutes = (now.getTime() - new Date(oldest.checked_at).getTime()) / 60_000;
      const stale = ageMinutes > config.reconciliationMaxAgeMinutes;
      checks.push({
        name: 'reconciliation_freshness',
        status: stale ? 'fail' : 'ok',
        detail: `последняя сверка ${oldest.stream_id}: ${ageMinutes.toFixed(1)} мин назад (предел ${config.reconciliationMaxAgeMinutes} мин)`,
      });
    }
  } catch (error) {
    checks.push({ name: 'reconciliation_freshness', status: 'fail', detail: errorDetail(error) });
  }

  return finish(checks, now);
}

function finish(checks: ReadinessCheck[], now: Date): ReadinessReport {
  return {
    ready: checks.every(check => check.status !== 'fail'),
    checks,
    generatedAt: now.toISOString(),
  };
}

/** Для тестов и скриптов: бросить ошибку с кодом READINESS_FAILED. */
export function assertReady(report: ReadinessReport): void {
  if (report.ready) return;
  const failed = report.checks.filter(check => check.status === 'fail').map(check => `${check.name}: ${check.detail}`);
  throw new GameOpsError('READINESS_FAILED', `Слой game_ops не готов: ${failed.join('; ')}`, undefined, 503);
}
