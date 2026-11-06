// Сжатие JSON-ответов серверной симуляции (gzip) на встроенном zlib, без новых зависимостей.
// Применяется только к маршрутам /api/colony-sim: полное состояние колонии до ~370 КБ в год
// сжимается в разы, а остальные маршруты остаются без изменений.
// Если клиент не принимает gzip, ответ уходит как обычно (Vary: Accept-Encoding сохраняется).
import { gzipSync } from "node:zlib";
import type { NextFunction, Request, Response } from "express";

const ACCEPTS_GZIP = /(^|,)\s*gzip\s*(;[^,]*)?(,|$)/i;

export function gzipJsonResponses() {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.vary("Accept-Encoding");
    const accept = String(req.headers["accept-encoding"] ?? "");
    if (!ACCEPTS_GZIP.test(accept)) {
      next();
      return;
    }
    res.json = ((body: unknown) => {
      const zipped = gzipSync(Buffer.from(JSON.stringify(body), "utf8"));
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(zipped.length));
      res.end(zipped);
      return res;
    }) as Response["json"];
    next();
  };
}
