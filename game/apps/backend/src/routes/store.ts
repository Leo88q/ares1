/**
 * Публичная витрина: что вообще можно купить и что это даёт.
 *
 * Отдельный от /api/presale роутер, потому что витрина обязана работать без
 * БД: каталог — это статические данные из `presale/catalog.ts`, а не тираж.
 * Тираж (цена, валюта, cap) живёт в game_ops и подставляется только когда он
 * открыт; до этого цена честно `null`, а не выдуманное число.
 *
 * `enabled` — тот же гейт, что у платежей: витрина не может выглядеть
 * покупаемой, пока `USER_PRESALE_PAYMENTS_ENABLED=false`.
 */
import { Router } from "express";
import { PACKS, packPotatoMicro } from "../presale/catalog.js";
import { FIELD_TYPE_NAMES } from "../presale/catalog.js";

export interface StoreRouterDeps {
  /** Могут ли заказы вообще принимать платежи (launch gate). */
  salesEnabled: boolean;
  /** Причина закрытия для клиента; без внутренних путей и имён хостов. */
  closedReason: string;
}

export interface StorePackView {
  id: string;
  titleRu: string;
  titleEn: string;
  fields: ReadonlyArray<{ type: number; count: number; name: string }>;
  potatoMicro: string;
  potato: string;
}

export function storePacks(): StorePackView[] {
  return PACKS.map((pack) => {
    const micro = packPotatoMicro(pack);
    return {
      id: pack.id,
      titleRu: pack.titleRu,
      titleEn: pack.titleEn,
      fields: pack.fields.map((field) => ({
        type: field.type,
        count: field.count,
        name: FIELD_TYPE_NAMES[field.type] ?? `type ${field.type}`,
      })),
      potatoMicro: micro.toString(),
      potato: (micro / 1_000_000n).toString(),
    };
  });
}

export function storeRouter(deps: StoreRouterDeps): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      enabled: deps.salesEnabled,
      reason: deps.salesEnabled ? null : deps.closedReason,
      currency: "POTATO",
      packs: storePacks(),
    });
  });
  return router;
}
