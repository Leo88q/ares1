/**
 * API выдачи слотов грядок (S7). Монтируется в index.ts только при SLOTS_ENABLED=true
 * и полной конфигурации (см. slots/config.ts). Иначе маршрута нет вовсе.
 *
 * POST /api/slots/grant
 *   тело: { field_id, slot, wallet, payment_signature | null, ts, sig }
 *   sig — base64-подпись кошельком строки requestAuthMessage (slots/requestAuth.ts).
 *   ответ 200: { record, signature } — подписанная запись (ed25519, ≤ 1 ч).
 *   ответ 4xx/5xx: { error: CODE } без внутренних деталей.
 */
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Connection } from '@solana/web3.js';
import type { Pool } from '../gameops/pool.js';
import { slotTransaction } from '../slots/store.js';
import { grantSlot, type GrantInput, type SlotAudit } from '../slots/service.js';
import { verifyRequestAuth } from '../slots/requestAuth.js';
import { signSlotRecord, type SlotRecord } from '../slots/record.js';
import type { SlotsConfig } from '../slots/config.js';
import { fetchTokenPaymentView } from '../presale/chain.js';
import { send } from './shared.js';

export interface SlotsRouteDeps {
  connection: Connection;
  config: SlotsConfig;
  /** Аудит: строка в журнал процесса. Без ключей и без тела запроса. По умолчанию — console. */
  log?: (entry: SlotAudit & { at: string }) => void;
}

const isString = (v: unknown): v is string => typeof v === 'string';

function parseBody(body: unknown): { input: GrantInput; ts: number; sig: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!isString(b.field_id) || !isString(b.wallet) || !isString(b.sig)) return null;
  if (typeof b.slot !== 'number' || typeof b.ts !== 'number' || !Number.isInteger(b.ts)) return null;
  if (b.payment_signature !== null && !isString(b.payment_signature)) return null;
  return {
    input: {
      field_id: b.field_id,
      slot: b.slot,
      wallet: b.wallet,
      payment_signature: b.payment_signature as string | null,
    },
    ts: b.ts,
    sig: b.sig,
  };
}

export function slotsRouter(pool: Pool, deps: SlotsRouteDeps): Router {
  const router = Router();
  const { config } = deps;
  const log = deps.log ?? (entry => console.log(JSON.stringify(entry)));

  router.post('/grant', async (req: Request, res: Response) => {
    const parsed = parseBody(req.body);
    if (!parsed) {
      log({ outcome: 'denied', action: 'slot.request', detail: { reason: 'BAD_REQUEST' }, at: new Date().toISOString() });
      send(res, 400, { error: 'BAD_REQUEST' });
      return;
    }
    const { input, ts, sig } = parsed;
    // Кошелёк должен подписать именно этот запрос: без подписи запись ничего не доказывает.
    const auth = verifyRequestAuth(
      { field_id: input.field_id, slot: input.slot, wallet: input.wallet, payment_signature: input.payment_signature },
      ts,
      sig,
      Math.floor(Date.now() / 1000),
    );
    if (!auth.ok) {
      log({
        outcome: 'denied',
        action: 'slot.auth',
        detail: { field_id: input.field_id, slot: input.slot, wallet: input.wallet, reason: auth.code },
        at: new Date().toISOString(),
      });
      send(res, 401, { error: auth.code });
      return;
    }
    try {
      const outcome = await grantSlot(input, {
        runInTransaction: slotTransaction(pool, 'slots-api'),
        fetchPayment: signature => fetchTokenPaymentView(deps.connection, signature),
        sign: (record: SlotRecord) => signSlotRecord(record, config.signingKey),
        keyId: config.keyId,
        skrMint: config.skrMint,
        treasuryOwner: config.treasuryOwner,
        priceUnits: config.priceUnits,
        now: () => Math.floor(Date.now() / 1000),
        randomNonce: () => randomUUID(),
        audit: async entry => log({ ...entry, at: new Date().toISOString() }),
      });
      if (!outcome.ok) {
        send(res, outcome.status, { error: outcome.code });
        return;
      }
      send(res, 200, { record: outcome.issued.record, signature: outcome.issued.signature, reissued: outcome.issued.reissued });
    } catch (error) {
      console.error('[slots] grant failed:', error instanceof Error ? error.name : 'unknown');
      send(res, 500, { error: 'INTERNAL' });
    }
  });

  return router;
}
