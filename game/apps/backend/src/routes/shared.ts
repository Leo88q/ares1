/** Общие хелперы ответов для роутеров. JSON не переносит bigint. */
import type { Response } from 'express';

/** bigint наружу уходит строками: потеря точности в суммах недопустима. */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [jsonSafe(key), jsonSafe(entry)]));
  }
  return value;
}

export function send(res: Response, status: number, payload: unknown): void {
  res.status(status).json(jsonSafe(payload));
}
