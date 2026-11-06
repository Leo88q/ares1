// POST /api/colony-spend: принимает подпись колонийной траты и отвечает квитанцией.
// Монтируется только при COLONY_POTATO_SPEND_ENABLED=true (по умолчанию выключено).

import { Router, type Request, type Response } from "express";
import { ColonySpendError } from "./potatoSpend.js";
import type { ColonyPotatoSpendService } from "./potatoSpendService.js";

const STATUS_BY_CODE: Partial<Record<ColonySpendError["code"], number>> = {
  NOT_FINALIZED: 409,
  SIGNATURE_OWNED: 409,
  INVALID_SIGNATURE: 400,
  INVALID_WALLET: 400,
};

export function colonyPotatoSpendRouter(service: ColonyPotatoSpendService): Router {
  const router = Router();
  router.post("/", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { signature?: unknown; wallet?: unknown };
    if (typeof body.signature !== "string" || typeof body.wallet !== "string") {
      res.status(400).json({ ok: false, code: "INVALID_REQUEST", message: "Нужны поля signature и wallet" });
      return;
    }
    try {
      const { receipt, reused } = await service.record({ signature: body.signature, wallet: body.wallet });
      res.status(reused ? 200 : 201).json({
        ok: true,
        reused,
        receipt: {
          signature: receipt.signature,
          owner: receipt.owner,
          amountMicro: receipt.amountMicro.toString(),
          purpose: receipt.purpose,
          slot: receipt.slot,
        },
      });
    } catch (error) {
      if (error instanceof ColonySpendError) {
        res.status(STATUS_BY_CODE[error.code] ?? 422).json({ ok: false, code: error.code, message: error.message });
        return;
      }
      res.status(500).json({ ok: false, code: "INTERNAL", message: "Не удалось записать квитанцию" });
    }
  });
  return router;
}
