/**
 * Публичные фича-флаги для клиента.
 *
 * Отдельный эндпоинт, а не поле в `/api/config`: конфиг читается из цепи и
 * отдаёт 503, когда RPC недоступен, — а интерфейсу нужно знать, показывать ли
 * раздел «Колония», даже если цепь сейчас не отвечает. Секретов здесь нет:
 * все значения — те же launch gates, что и в коде.
 *
 * Важно: это НЕ разрешения. Клиент по этим флагам только скрывает разделы;
 * каждая операция проверяется на сервере своим гейтом (`COLONIES_ENABLED`,
 * `USER_PRESALE_PAYMENTS_ENABLED`, `REWARDS_RAIL_ENABLED`). Подделанный ответ
 * не открывает ни одного действия.
 */
import { Router } from "express";
import { COLONY_V1_RELEASE_READY, REWARDS_RAIL_ENABLED, USER_PRESALE_PAYMENTS_ENABLED } from "../launchGates.js";

export interface FeatureFlags {
  colonies: boolean;
  coloniesReleaseReady: boolean;
  rewardsRail: boolean;
  presalePayments: boolean;
}

export function featuresRouter(flags: FeatureFlags): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(flags);
  });
  return router;
}

export function defaultFeatureFlags(input: { coloniesEnabled: boolean }): FeatureFlags {
  return {
    colonies: input.coloniesEnabled,
    coloniesReleaseReady: COLONY_V1_RELEASE_READY,
    rewardsRail: REWARDS_RAIL_ENABLED,
    presalePayments: USER_PRESALE_PAYMENTS_ENABLED,
  };
}
