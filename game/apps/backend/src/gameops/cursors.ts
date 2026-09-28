/**
 * Курсоры сервисов: единственная изменяемая таблица слоя, и та — только через
 * CAS по version. Курсор отвечает на вопрос «до какого места мы прочитали цепь»,
 * поэтому его «откат назад» опасен: он приведёт к повторной обработке событий, а
 * «прыжок вперёд» — к молчаливой потере наград. Отсюда правило: version всегда
 * old + 1 (проверяет триггер `service_cursors_cas`), а каждое движение курсора
 * попадает в аудит.
 */
import { GameOpsError } from './errors.js';
import { query, withTransaction, type Pool } from './pool.js';

export interface CursorRow {
  stream_id: string;
  version: string;
  state: Record<string, unknown>;
  updated_at: string;
}

const STREAM_RE = /^[a-z0-9:_-]{3,80}$/;

export async function getCursor(pool: Pool, streamId: string): Promise<CursorRow | null> {
  if (!STREAM_RE.test(streamId)) throw new GameOpsError('VALIDATION', `stream_id не соответствует шаблону: ${streamId}`);
  const rows = await query<CursorRow>(pool, 'SELECT * FROM game_ops.service_cursors WHERE stream_id = $1', [streamId]);
  return rows[0] ?? null;
}

export async function listCursors(pool: Pool): Promise<CursorRow[]> {
  return query<CursorRow>(pool, 'SELECT * FROM game_ops.service_cursors ORDER BY stream_id');
}

/** Регистрация потока: идемпотентна, повторный вызов возвращает существующий курсор. */
export async function ensureCursor(pool: Pool, streamId: string, initialState: Record<string, unknown>, actor: string): Promise<CursorRow> {
  if (!STREAM_RE.test(streamId)) throw new GameOpsError('VALIDATION', `stream_id не соответствует шаблону: ${streamId}`);
  return withTransaction(pool, actor, async client => {
    const inserted = await client.query<CursorRow>(
      `INSERT INTO game_ops.service_cursors (stream_id, version, state) VALUES ($1, 0, $2::jsonb)
       ON CONFLICT (stream_id) DO NOTHING RETURNING *`,
      [streamId, JSON.stringify(initialState)],
    );
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = await client.query<CursorRow>('SELECT * FROM game_ops.service_cursors WHERE stream_id = $1', [streamId]);
    return existing.rows[0]!;
  });
}

export interface AdvanceResult {
  streamId: string;
  version: bigint;
  state: Record<string, unknown>;
}

/**
 * Продвижение курсора с ожидаемой версией.
 *
 * `expectedVersion` обязателен: без него два процесса (или два прогона) могли бы
 * «перепрыгнуть» друг друга и потерять события. Несовпадение версии = честная
 * ошибка CURSOR_VERSION_CONFLICT (409), а не перезапись.
 */
export async function advanceCursor(
  pool: Pool,
  input: { streamId: string; expectedVersion: bigint | number | string; state: Record<string, unknown>; actor: string },
): Promise<AdvanceResult> {
  if (!STREAM_RE.test(input.streamId)) throw new GameOpsError('VALIDATION', `stream_id не соответствует шаблону: ${input.streamId}`);
  const expected = BigInt(input.expectedVersion);
  return withTransaction(pool, input.actor, async client => {
    const updated = await client.query<CursorRow>(
      `UPDATE game_ops.service_cursors
       SET version = version + 1, state = $3::jsonb
       WHERE stream_id = $1 AND version = $2
       RETURNING *`,
      [input.streamId, expected.toString(), JSON.stringify(input.state)],
    );
    if (updated.rows[0]) {
      const row = updated.rows[0];
      return { streamId: row.stream_id, version: BigInt(row.version), state: row.state };
    }
    const current = await client.query<CursorRow>('SELECT * FROM game_ops.service_cursors WHERE stream_id = $1', [input.streamId]);
    if (!current.rows[0]) throw new GameOpsError('CURSOR_NOT_FOUND', `Курсор ${input.streamId} не зарегистрирован`, undefined, 404);
    throw new GameOpsError(
      'CURSOR_CONFLICT',
      `Курсор ${input.streamId}: ожидалась версия ${expected}, текущая ${current.rows[0].version} — другой писатель уже продвинул поток`,
      undefined,
      409,
    );
  });
}

/** Сдвиг «вперёд» от текущего состояния (частый случай индексатора событий). */
export async function advanceCursorBy(
  pool: Pool,
  input: { streamId: string; patch: Record<string, unknown>; actor: string; maxRetries?: number },
): Promise<AdvanceResult> {
  const retries = Math.min(Math.max(input.maxRetries ?? 3, 1), 10);
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const current = await getCursor(pool, input.streamId);
    if (!current) throw new GameOpsError('CURSOR_NOT_FOUND', `Курсор ${input.streamId} не зарегистрирован`, undefined, 404);
    try {
      return await advanceCursor(pool, {
        streamId: input.streamId,
        expectedVersion: current.version,
        state: { ...current.state, ...input.patch },
        actor: input.actor,
      });
    } catch (error) {
      lastError = error;
      if (!(error instanceof GameOpsError) || error.code !== 'CURSOR_CONFLICT') throw error;
    }
  }
  throw lastError;
}
