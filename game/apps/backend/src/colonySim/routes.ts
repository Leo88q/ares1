// HTTP-слой серверной симуляции колонии: GET /state и POST /actions.
// Кошелёк берётся только из сессии (requireSession), не из тела запроса.
import { Router, type Request, type Response } from "express";
import { requireSession, sessionOf, type ColonySessionGuardOptions } from "../colonies/routes.js";
import { ColonySimService, SimRejection } from "./service.js";

export interface ColonySimRouterOptions extends ColonySessionGuardOptions {
  service: ColonySimService;
  /** Для журнала ошибок: внутренние исключения не уходят клиенту. */
  onInternalError?: (err: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendError(res: Response, err: unknown, options: ColonySimRouterOptions): void {
  if (err instanceof SimRejection) {
    res.status(err.status).json({ ok: false, code: err.code, ...(err.view ? { view: err.view } : {}) });
    return;
  }
  options.onInternalError?.(err);
  res.status(500).json({ ok: false, code: "INTERNAL" });
}

export function colonySimRouter(options: ColonySimRouterOptions): Router {
  const router = Router();
  router.use(requireSession(options));

  router.get("/state", async (_req: Request, res: Response) => {
    try {
      const view = await options.service.get(sessionOf(res).wallet);
      res.json({ ok: true, view });
    } catch (err) {
      sendError(res, err, options);
    }
  });

  router.post("/actions", async (req: Request, res: Response) => {
    if (!isRecord(req.body)) {
      res.status(400).json({ ok: false, code: "INVALID_REQUEST" });
      return;
    }
    const body = req.body;
    try {
      const result = await options.service.act({
        wallet: sessionOf(res).wallet,
        requestId: typeof body.requestId === "string" ? body.requestId : "",
        expectedSequence: body.expectedSequence as number,
        action: body.action,
        spendSignature: body.spendSignature === undefined ? undefined : (body.spendSignature as string),
      });
      if (result.ok) {
        res.json({ ok: true, reused: result.reused, view: result.view });
        return;
      }
      res.status(result.status).json({ ok: false, code: result.code, ...(result.view ? { view: result.view } : {}) });
    } catch (err) {
      sendError(res, err, options);
    }
  });

  return router;
}
