/**
 * Ошибки слоя game_ops.
 *
 * Правило: наружу и в логи уходят только стабильные коды, никогда — текст
 * исключения БД (в нём могут быть connection string с паролем, детали запросов
 * и значения строк). Все коды сопоставлены с ограничениями схемы, чтобы
 * инцидент можно было разобрать без дампа таблиц.
 */
export type GameOpsErrorCode =
  | 'NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'VALIDATION'
  | 'DB_UNAVAILABLE'
  | 'MIGRATIONS_MISSING'
  | 'DUPLICATE_INTENT'
  | 'INTENT_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'CHAIN_MISMATCH'
  | 'CHAIN_BROKEN'
  | 'CURSOR_NOT_FOUND'
  | 'CURSOR_CONFLICT'
  | 'RECONCILIATION_DRIFT'
  | 'READINESS_FAILED'
  | 'UNEXPECTED';

export class GameOpsError extends Error {
  constructor(
    readonly code: GameOpsErrorCode,
    message: string,
    readonly detail?: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'GameOpsError';
  }
}

/** Сообщения, которые БД поднимает через RAISE EXCEPTION (см. 0002_immutability.sql). */
const PG_RAISE_CODES: Record<string, { code: GameOpsErrorCode; status: number }> = {
  APPEND_ONLY_UPDATE: { code: 'VALIDATION', status: 409 },
  APPEND_ONLY_DELETE: { code: 'VALIDATION', status: 409 },
  LEDGER_CHAIN_MISMATCH: { code: 'CHAIN_MISMATCH', status: 409 },
  LEDGER_SINGLE_CHAIN_PER_BATCH_REQUIRED: { code: 'VALIDATION', status: 400 },
  INTENT_IMMUTABLE_FIELD: { code: 'VALIDATION', status: 409 },
  INTENT_INVALID_TRANSITION: { code: 'INVALID_TRANSITION', status: 409 },
  INTENT_SIGNATURE_IMMUTABLE: { code: 'VALIDATION', status: 409 },
  INTENT_SIGNATURE_REQUIRES_SUBMITTED: { code: 'VALIDATION', status: 400 },
  INTENT_SIGNATURE_REQUIRED: { code: 'VALIDATION', status: 400 },
  INTENT_FAILURE_CODE_REQUIRED: { code: 'VALIDATION', status: 400 },
  CURSOR_VERSION_CONFLICT: { code: 'CURSOR_CONFLICT', status: 409 },
  CURSOR_STREAM_ID_IMMUTABLE: { code: 'VALIDATION', status: 409 },
};

interface PgLikeError {
  code?: string;
  constraint?: string;
  message?: string;
}

/** Преобразует ошибку драйвера в стабильный GameOpsError, не раскрывая деталей. */
export function mapDbError(error: unknown): GameOpsError {
  const pg = (error ?? {}) as PgLikeError;
  // 23505 unique_violation
  if (pg.code === '23505') {
    switch (pg.constraint) {
      case 'reward_intents_recipient_nonce_key':
        return new GameOpsError('DUPLICATE_INTENT', 'Выплата с таким nonce уже существует', undefined, 409);
      case 'reward_intents_signature_key':
        return new GameOpsError('DUPLICATE_INTENT', 'Эта подпись уже привязана к другому интенту', undefined, 409);
      case 'reward_ledger_signature_recipient_key':
        return new GameOpsError('DUPLICATE_INTENT', 'Это событие уже есть в журнале', undefined, 409);
      default:
        return new GameOpsError('VALIDATION', 'Нарушено ограничение уникальности', `constraint=${pg.constraint ?? 'unknown'}`, 409);
    }
  }
  // 23514 check_violation, 23503 foreign_key_violation, 22003 numeric overflow
  if (pg.code === '23514' || pg.code === '23503' || pg.code === '22003' || pg.code === '22P02') {
    return new GameOpsError('VALIDATION', 'Значение нарушает ограничения схемы', undefined, 400);
  }
  // 42P01 undefined_table — обычно «миграции не применены»
  if (pg.code === '42P01' || pg.code === '3F000') {
    return new GameOpsError('MIGRATIONS_MISSING', 'Схема game_ops не инициализирована', undefined, 503);
  }
  // 42501 insufficient_privilege — попытка сделать то, что запрещено правами
  if (pg.code === '42501') {
    return new GameOpsError('VALIDATION', 'Операция запрещена правами БД (append-only)', undefined, 403);
  }
  // 57014 statement_timeout, 08006/08003 connection errors
  if (pg.code === '57014') return new GameOpsError('DB_UNAVAILABLE', 'Запрос превысил таймаут', undefined, 503);
  if (pg.code === '08006' || pg.code === '08003' || pg.code === '08001' || pg.code === 'ECONNREFUSED') {
    return new GameOpsError('DB_UNAVAILABLE', 'База недоступна', undefined, 503);
  }
  // P0001 — RAISE EXCEPTION из триггеров: код в тексте сообщения
  if (pg.code === 'P0001') {
    const raised = /^([A-Z0-9_]+)/.exec(pg.message ?? '')?.[1] ?? '';
    const mapped = PG_RAISE_CODES[raised];
    if (mapped) return new GameOpsError(mapped.code, `Операция отклонена: ${raised}`, undefined, mapped.status);
    return new GameOpsError('VALIDATION', 'Операция отклонена правилом БД', undefined, 409);
  }
  return new GameOpsError('UNEXPECTED', 'Внутренняя ошибка слоя данных', undefined, 500);
}

/** Безопасное описание ошибки для логов: без URL, паролей и значений строк. */
export function safeDbError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/((?:password|token|secret|api[-_]?key)\s*[=:]\s*)[^\s&,;]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}
