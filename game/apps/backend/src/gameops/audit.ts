/**
 * Аудит административных действий: «кто в команде, что сделал и почему».
 *
 * Цепь фиксирует «что» (AuthorityProposed, PausedToggled…), но не «кто» и не
 * «почему». Эта таблица закрывает разрыв: каждой выплате/паузе/смене параметров
 * соответствует строка с актором и дайджестом деталей.
 *
 * Детали не пишутся в открытом виде: в БД попадает sha256 канонического JSON.
 * Это осознанный компромисс — секреты и персональные данные не должны лежать
 * в аудит-таблице, но при расследовании по дайджесту можно доказать, что
 * предъявленный оператором JSON — именно тот, что был сохранён.
 */
import { createHash } from 'node:crypto';
import { GameOpsError } from './errors.js';
import { query } from './pool.js';
import type { Pool } from './pool.js';

export const AUDIT_OUTCOMES = ['ok', 'denied', 'error'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  subject: string;
  subject_id: string | null;
  outcome: AuditOutcome;
  detail_hash: string;
  request_id: string | null;
  created_at: string;
}

const ACTION_RE = /^[a-z][a-z0-9_.]{2,60}$/;
const SUBJECT_RE = /^[a-z][a-z0-9_]{2,40}$/;

export function hashAuditDetail(detail: unknown): string {
  const canonical = typeof detail === 'string' ? detail : stableStringify(detail);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Детерминированная сериализация: ключи сортируются, поэтому один и тот же
 * объект всегда даёт один дайджест (иначе доказательство «это тот же JSON»
 * разваливалось бы на порядке ключей).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

export interface RecordAuditInput {
  actor: string;
  action: string;
  subject: string;
  outcome: AuditOutcome;
  detail?: unknown;
  subjectId?: bigint | number | string | null;
  requestId?: string | null;
}

/**
 * Прямая запись в аудит — только для случаев, когда действие НЕ покрыто
 * триггером (например, ручное решение оператора или отказ доступа). Записи о
 * выплатах и курсорах делает БД сама: приложение не может их «забыть».
 */
export async function recordAudit(pool: Pool, input: RecordAuditInput): Promise<void> {
  if (!ACTION_RE.test(input.action)) throw new GameOpsError('VALIDATION', `action не соответствует шаблону: ${input.action}`);
  if (!SUBJECT_RE.test(input.subject)) throw new GameOpsError('VALIDATION', `subject не соответствует шаблону: ${input.subject}`);
  if (!AUDIT_OUTCOMES.includes(input.outcome)) throw new GameOpsError('VALIDATION', `outcome должен быть одним из ${AUDIT_OUTCOMES.join(', ')}`);
  if (input.actor.trim().length < 3) throw new GameOpsError('VALIDATION', 'actor обязателен');
  if (input.requestId && !/^[A-Za-z0-9._:-]{8,64}$/.test(input.requestId)) {
    throw new GameOpsError('VALIDATION', 'requestId должен быть 8..64 символов A-Za-z0-9._:-');
  }
  await query(
    pool,
    `INSERT INTO game_ops.admin_audit (actor, action, subject, subject_id, outcome, detail_hash, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.actor.trim().slice(0, 120),
      input.action,
      input.subject,
      input.subjectId == null ? null : String(input.subjectId),
      input.outcome,
      hashAuditDetail(input.detail ?? null),
      input.requestId ?? null,
    ],
  );
}

/** Аудит действия с отказом: фиксируется даже то, что НЕ было разрешено. */
export async function recordDenied(pool: Pool, input: Omit<RecordAuditInput, 'outcome'> & { reason: string }): Promise<void> {
  await recordAudit(pool, { ...input, outcome: 'denied', detail: { ...(typeof input.detail === 'object' && input.detail ? input.detail : {}), reason: input.reason } });
}

export interface AuditQuery {
  actor?: string;
  subject?: string;
  subjectId?: string | bigint;
  action?: string;
  outcome?: AuditOutcome;
  since?: Date;
  until?: Date;
  limit?: number;
}

export async function listAudit(pool: Pool, filter: AuditQuery = {}): Promise<AuditEntry[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('$?', `$${params.length}`));
  };
  if (filter.actor) push('actor = $?', filter.actor);
  if (filter.subject) push('subject = $?', filter.subject);
  if (filter.subjectId != null) push('subject_id = $?', String(filter.subjectId));
  if (filter.action) push('action = $?', filter.action);
  if (filter.outcome) push('outcome = $?', filter.outcome);
  if (filter.since) push('created_at >= $?', filter.since);
  if (filter.until) push('created_at < $?', filter.until);
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1_000);
  params.push(limit);
  const sql = `SELECT * FROM game_ops.admin_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT $${params.length}`;
  return query<AuditEntry>(pool, sql, params);
}

/**
 * «След» одного интента: и аудит по subject_id, и переход интента. Это то, что
 * запрашивают при разборе инцидента — вся история решения, а не последняя строка.
 */
export async function intentTrail(pool: Pool, intentId: string | bigint): Promise<AuditEntry[]> {
  await query(pool, 'SELECT 1 FROM game_ops.reward_intents WHERE id = $1', [String(intentId)]).catch(() => []);
  return query<AuditEntry>(
    pool,
    `SELECT * FROM game_ops.admin_audit
     WHERE (subject = 'reward_intents' AND subject_id = $1)
        OR (subject = 'reward_ledger' AND subject_id = $1)
     ORDER BY id ASC`,
    [String(intentId)],
  );
}
