/**
 * Админ-API слоя game_ops (платежи, журнал, сверка, аудит, курсоры).
 *
 * Принципы:
 *   - всё изменяющее — только с `Authorization: Bearer $ADMIN_API_TOKEN`,
 *     сравнение токена постоянного времени (перебор по времени ответа невозможен);
 *   - отказ доступа тоже попадает в аудит (`outcome = denied`) — «кто пытался» не
 *     менее важно, чем «кто сделал»;
 *   - bigint наружу уходит строками: JSON не умеет 64-битные целые, и потеря
 *     точности в суммах недопустима;
 *   - ошибки наружу — стабильными кодами (GameOpsError), без текста драйвера.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { GameOpsError, safeDbError } from '../gameops/errors.js';
import type { GameOpsConfig } from '../gameops/env.js';
import type { Pool } from '../gameops/pool.js';
import { appendBatch, merkleAnchor, tail, verifyChainTail } from '../gameops/ledger.js';
import { createIntent, createIntentsBatch, expireStale, getIntent, listIntents, markConfirmed, markFailed, markSubmitted } from '../gameops/intents.js';
import { latestReconciliation, recordReconciliation, reconciliationHistory } from '../gameops/reconciliation.js';
import { advanceCursor, advanceCursorBy, ensureCursor, getCursor, listCursors } from '../gameops/cursors.js';
import { listAudit, recordAudit, recordDenied } from '../gameops/audit.js';
import { checkReadiness, httpStatusFor } from '../gameops/readiness.js';

/** JSON не переносит bigint: превращаем в строки, а не в «примерно такое» число. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, jsonSafe(entry)]));
  }
  return value;
}

function send(res: Response, status: number, payload: unknown): void {
  res.status(status).json(jsonSafe(payload));
}

function fail(res: Response, status: number, body: Record<string, unknown>): void {
  res.status(status).json(body);
}

/** Сравнение секретов постоянного времени: длина не утекает, содержимое тоже. */
export function tokenMatches(provided: string, expected: string): boolean {
  const left = createHash('sha256').update(provided).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function bearer(req: Request): string {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? '';
}

export function requireAdmin(pool: Pool, config: GameOpsConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const provided = bearer(req);
    if (provided && tokenMatches(provided, config.adminToken)) return next();
    // Отказ логируем в аудит, но не даём аудиту превратиться в вектор DoS:
    // ошибка записи не меняет ответ клиенту.
    void recordDenied(pool, {
      actor: req.ip ? `ip:${req.ip}` : 'unknown',
      action: 'admin.access',
      subject: 'game_ops_api',
      reason: provided ? 'bad_token' : 'missing_token',
      detail: { path: req.path, method: req.method },
      requestId: null,
    }).catch(() => undefined);
    fail(res, 401, { error: 'UNAUTHORIZED', message: 'Нужен заголовок Authorization: Bearer <token>' });
  };
}

function bigintField(value: unknown, name: string, options: { min?: bigint; max?: bigint } = {}): bigint {
  let parsed: bigint;
  if (typeof value === 'bigint') parsed = value;
  else if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new GameOpsError('VALIDATION', `${name} должен быть целым числом`);
    parsed = BigInt(value);
  } else if (typeof value === 'string' && /^-?\d{1,20}$/.test(value.trim())) {
    parsed = BigInt(value.trim());
  } else {
    throw new GameOpsError('VALIDATION', `${name} должен быть целым числом или десятичной строкой`);
  }
  if (options.min !== undefined && parsed < options.min) throw new GameOpsError('VALIDATION', `${name} меньше допустимого минимума`);
  if (options.max !== undefined && parsed > options.max) throw new GameOpsError('VALIDATION', `${name} больше допустимого максимума`);
  return parsed;
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new GameOpsError('VALIDATION', `${name} обязателен`);
  return value.trim();
}

/** Актор берётся из заголовка X-Actor (кто в команде), а не из тела запроса. */
function actorOf(req: Request): string {
  const actor = (req.header('x-actor') ?? '').trim();
  return actor.length >= 3 ? actor.slice(0, 120) : 'admin:api';
}

/**
 * Единая точка ответа: статус может зависеть от результата (readiness → 503,
 * проверка цепочки → 409). Важно: статус выставляется ОДИН раз, уже после
 * вычисления — иначе поздний `res.status(200)` затрёт ранний 503.
 */
function handle(res: Response, status: number | ((payload: unknown) => number), work: () => Promise<unknown>): void {
  // Promise.resolve().then(work): синхронная валидация в теле обработчика тоже
  // превращается в отказ 400, а не в «необработанное исключение» express (500).
  Promise.resolve()
    .then(work)
    .then(payload => send(res, typeof status === 'function' ? status(payload) : status, payload))
    .catch((error: unknown) => {
      if (error instanceof GameOpsError) {
        fail(res, error.status, { error: error.code, message: error.message, ...(error.detail ? { detail: error.detail } : {}) });
        return;
      }
      // Наружу — только безопасное описание: строка подключения с паролем не
      // должна попасть ни в лог, ни в ответ.
      console.error('[gameops] unhandled:', safeDbError(error));
      fail(res, 500, { error: 'UNEXPECTED', message: 'Внутренняя ошибка слоя данных' });
    });
}

export function gameOpsRouter(pool: Pool, config: GameOpsConfig): Router {
  const router = Router();
  const admin = requireAdmin(pool, config);

  router.get('/readiness', admin, (_req, res) => {
    handle(res, payload => httpStatusFor(payload as Awaited<ReturnType<typeof checkReadiness>>), () => checkReadiness(pool, config));
  });

  // ── Интенты выплат ────────────────────────────────────────────────────────
  router.post('/intents', admin, (req, res) => {
    handle(res, 201, () => createIntent(pool, {
      recipientAta: stringField(req.body?.recipientAta, 'recipientAta'),
      amountMicro: bigintField(req.body?.amountMicro, 'amountMicro', { min: 1n, max: 1_000_000_000n }),
      nonce: bigintField(req.body?.nonce, 'nonce', { min: 0n }),
      reason: stringField(req.body?.reason, 'reason'),
      ttlSeconds: req.body?.ttlSeconds === undefined ? undefined : Number(req.body.ttlSeconds),
      actor: actorOf(req),
    }));
  });

  router.post('/intents/batch', admin, (req, res) => {
    handle(res, 201, () => {
      const rows = Array.isArray(req.body?.intents) ? req.body.intents : null;
      if (!rows) throw new GameOpsError('VALIDATION', 'Ожидался массив intents');
      const actor = actorOf(req);
      return createIntentsBatch(pool, rows.map((row: Record<string, unknown>) => ({
        recipientAta: stringField(row.recipientAta, 'recipientAta'),
        amountMicro: bigintField(row.amountMicro, 'amountMicro', { min: 1n, max: 1_000_000_000n }),
        nonce: bigintField(row.nonce, 'nonce', { min: 0n }),
        reason: stringField(row.reason, 'reason'),
        ttlSeconds: row.ttlSeconds === undefined ? undefined : Number(row.ttlSeconds),
        actor,
      })), actor);
    });
  });

  router.get('/intents', admin, (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const limit = Number.parseInt(String(req.query.limit ?? '100'), 10);
    handle(res, 200, () => listIntents(pool, state, Number.isFinite(limit) ? limit : 100));
  });

  router.get('/intents/:id', admin, (req, res) => {
    handle(res, 200, async () => {
      const intent = await getIntent(pool, String(req.params.id));
      if (!intent) throw new GameOpsError('INTENT_NOT_FOUND', 'Интент не найден', undefined, 404);
      return intent;
    });
  });

  router.post('/intents/:id/submitted', admin, (req, res) => {
    handle(res, 200, () => markSubmitted(pool, {
      id: String(req.params.id),
      signature: stringField(req.body?.signature, 'signature'),
      actor: actorOf(req),
    }));
  });

  router.post('/intents/:id/confirmed', admin, (req, res) => {
    handle(res, 200, () => markConfirmed(pool, {
      id: String(req.params.id),
      signature: stringField(req.body?.signature, 'signature'),
      slot: bigintField(req.body?.slot, 'slot', { min: 0n }),
      actor: actorOf(req),
    }));
  });

  router.post('/intents/:id/failed', admin, (req, res) => {
    handle(res, 200, () => markFailed(pool, {
      id: String(req.params.id),
      failureCode: stringField(req.body?.failureCode, 'failureCode'),
      actor: actorOf(req),
    }));
  });

  router.post('/intents/expire', admin, (req, res) => {
    handle(res, 200, () => expireStale(pool, actorOf(req)));
  });

  // ── Журнал ────────────────────────────────────────────────────────────────
  router.post('/ledger/append', admin, (req, res) => {
    handle(res, 201, () => {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
      if (!rows) throw new GameOpsError('VALIDATION', 'Ожидался массив rows');
      return appendBatch(pool, rows.map((row: Record<string, unknown>) => ({
        recipientAta: stringField(row.recipientAta, 'recipientAta'),
        amountMicro: bigintField(row.amountMicro, 'amountMicro', { min: 1n }),
        signature: stringField(row.signature, 'signature'),
        slot: bigintField(row.slot, 'slot', { min: 0n }),
        blockTime: new Date(stringField(row.blockTime, 'blockTime')),
        intentId: row.intentId == null ? null : bigintField(row.intentId, 'intentId', { min: 1n }),
        chainId: typeof row.chainId === 'string' ? row.chainId : config.chainId,
      })), actorOf(req), config.chainId);
    });
  });

  router.get('/ledger/tail', admin, (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? '100'), 10);
    handle(res, 200, () => tail(pool, config.chainId, Number.isFinite(limit) ? limit : 100));
  });

  router.get('/ledger/verify', admin, (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? '1000'), 10);
    const full = req.query.full === '1' || req.query.full === 'true';
    handle(res, payload => ((payload as { ok: boolean }).ok ? 200 : 409), () =>
      verifyChainTail(pool, { chainId: config.chainId, limit: Number.isFinite(limit) ? limit : 1000, full }));
  });

  router.get('/ledger/anchor', admin, (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? '10000'), 10);
    handle(res, 200, () => merkleAnchor(pool, {
      chainId: config.chainId,
      limit: Number.isFinite(limit) ? limit : 10_000,
      toId: typeof req.query.toId === 'string' ? req.query.toId : undefined,
      actor: actorOf(req),
    }));
  });

  // ── Сверка ────────────────────────────────────────────────────────────────
  router.post('/reconciliation', admin, (req, res) => {
    handle(res, 201, () => recordReconciliation(pool, {
      streamId: stringField(req.body?.streamId, 'streamId'),
      finalizedSlot: bigintField(req.body?.finalizedSlot, 'finalizedSlot', { min: 0n }),
      epochId: bigintField(req.body?.epochId, 'epochId', { min: 0n }),
      fromSlot: bigintField(req.body?.fromSlot, 'fromSlot', { min: 0n }),
      grantedMicro: bigintField(req.body?.grantedMicro, 'grantedMicro', { min: 0n }),
      chainId: config.chainId,
      actor: actorOf(req),
    }));
  });

  router.get('/reconciliation', admin, (req, res) => {
    const streamId = typeof req.query.streamId === 'string' ? req.query.streamId : null;
    handle(res, 200, () => (streamId ? reconciliationHistory(pool, streamId) : latestReconciliation(pool)));
  });

  // ── Аудит ─────────────────────────────────────────────────────────────────
  router.get('/audit', admin, (req, res) => {
    handle(res, 200, () => listAudit(pool, {
      actor: typeof req.query.actor === 'string' ? req.query.actor : undefined,
      subject: typeof req.query.subject === 'string' ? req.query.subject : undefined,
      subjectId: typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined,
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
      outcome: req.query.outcome === 'ok' || req.query.outcome === 'denied' || req.query.outcome === 'error' ? req.query.outcome : undefined,
      since: typeof req.query.since === 'string' ? new Date(req.query.since) : undefined,
      limit: Number.parseInt(String(req.query.limit ?? '100'), 10) || 100,
    }));
  });

  router.post('/audit', admin, (req, res) => {
    handle(res, 201, async () => {
      const actor = actorOf(req);
      await recordAudit(pool, {
        actor,
        action: stringField(req.body?.action, 'action'),
        subject: stringField(req.body?.subject, 'subject'),
        outcome: req.body?.outcome === 'denied' || req.body?.outcome === 'error' ? req.body.outcome : 'ok',
        detail: req.body?.detail ?? null,
        subjectId: req.body?.subjectId == null ? null : bigintField(req.body.subjectId, 'subjectId', { min: 0n }),
      });
      return { recorded: true };
    });
  });

  // ── Курсоры ───────────────────────────────────────────────────────────────
  router.get('/cursors', admin, (_req, res) => handle(res, 200, () => listCursors(pool)));

  router.get('/cursors/:stream', admin, (req, res) => {
    handle(res, 200, async () => {
      const cursor = await getCursor(pool, String(req.params.stream));
      if (!cursor) throw new GameOpsError('CURSOR_NOT_FOUND', 'Курсор не найден', undefined, 404);
      return cursor;
    });
  });

  router.post('/cursors/:stream', admin, (req, res) => {
    handle(res, 201, () => ensureCursor(pool, String(req.params.stream), (req.body?.state as Record<string, unknown>) ?? {}, actorOf(req)));
  });

  router.post('/cursors/:stream/advance', admin, (req, res) => {
    handle(res, 200, async () => {
      const streamId = String(req.params.stream);
      const actor = actorOf(req);
      if (req.body?.expectedVersion !== undefined) {
        return advanceCursor(pool, {
          streamId,
          expectedVersion: bigintField(req.body.expectedVersion, 'expectedVersion', { min: 0n }),
          state: (req.body?.state as Record<string, unknown>) ?? {},
          actor,
        });
      }
      return advanceCursorBy(pool, { streamId, patch: (req.body?.patch as Record<string, unknown>) ?? {}, actor });
    });
  });

  return router;
}
