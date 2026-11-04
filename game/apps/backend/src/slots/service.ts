/**
 * Выдача слотов грядок (S7, docs/S7_SLOT_AUTHORITY_SPEC.md §3–§5, §8).
 *
 * Правила:
 *   • бесплатные слоты 1..6 — без платежа; первый занявший владеет;
 *   • платные слоты 7..12 — ровно один платёж SKR на слот, проверенный на цепи (finalized);
 *   • один платёж — один слот; повтор того же владельца перевыпускает запись, чужой — отказ;
 *   • платёж принят, а слот занят — ничего не выдаётся, случай уходит в ручную очередь (аудит);
 *   • каждая выдача — новая запись со своим nonce и сроком ≤ 1 ч (slot_record_issuances).
 *
 * Сервис не знает ни про HTTP, ни про конкретную БД или RPC: всё внешнее передаётся через deps.
 * Это позволяет покрыть правила тестами без сети и без PostgreSQL.
 */
import { createHash } from 'node:crypto';
import { GameOpsError } from '../gameops/errors.js';
import {
  FREE_SLOTS,
  MAX_SLOT,
  SLOT_RECORD_MAX_TTL_SECONDS,
  SLOT_RECORD_VERSION,
  canonicalJson,
  validateSlotRecord,
  type SlotRecord,
} from './record.js';
import { verifySlotPayment, type SlotPaymentSnapshot } from './payment.js';
import type { SlotStore, StoredGrant } from './store.js';

/** Платёж не старше этого срока (сек.). Прокси для «не раньше момента заказа»: отдельной таблицы заказов слотов нет. */
export const PAYMENT_MAX_AGE_SECONDS = 3600;

const FIELD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export interface GrantInput {
  field_id: string;
  slot: number;
  /** Кошелёк, уже подтвердивший владение подписью запроса (requestAuth). */
  wallet: string;
  payment_signature: string | null;
}

export interface SlotAudit {
  outcome: 'ok' | 'denied' | 'error';
  action: string;
  detail: Record<string, unknown>;
}

export interface SlotServiceDeps {
  runInTransaction: <T>(fn: (store: SlotStore) => Promise<T>) => Promise<T>;
  fetchPayment: (signature: string) => Promise<SlotPaymentSnapshot | null>;
  sign: (record: SlotRecord) => string;
  keyId: string;
  skrMint: string;
  treasuryOwner: string;
  priceUnits: bigint;
  /** Текущее время, unix-секунды. */
  now: () => number;
  randomNonce: () => string;
  audit: (entry: SlotAudit) => Promise<void>;
  /**
   * Валидный платёж при занятом слоте: записать разбор в durable-очередь.
   * Раньше случай оставался только в stdout-аудите — процесс перезапустили,
   * и денежный след исчез. Ошибка записи не должна подменять ответ покупателю,
   * поэтому она логируется, а не выбрасывается (решение фиксируется в аудите).
   */
  recordReview: (input: {
    paymentSignature: string;
    fieldId: string;
    slot: number;
    wallet: string;
    mint: string;
    amountUnits: bigint;
  }) => Promise<void>;
}

export interface IssuedRecord {
  record: SlotRecord;
  signature: string;
  grant_id: number;
  reissued: boolean;
}

export type GrantOutcome =
  | { ok: true; issued: IssuedRecord }
  | { ok: false; status: 400 | 402 | 409 | 500; code: string };

const denied = (status: 400 | 402 | 409, code: string): GrantOutcome => ({ ok: false, status, code });

export function validateGrantInput(input: GrantInput): { status: 400; code: string } | null {
  if (!FIELD_ID.test(input.field_id)) return { status: 400, code: 'BAD_FIELD' };
  if (!Number.isInteger(input.slot) || input.slot < 1 || input.slot > MAX_SLOT) return { status: 400, code: 'BAD_SLOT' };
  if (!BASE58.test(input.wallet)) return { status: 400, code: 'BAD_WALLET' };
  if (input.slot <= FREE_SLOTS) {
    if (input.payment_signature !== null) return { status: 400, code: 'PAYMENT_NOT_ALLOWED' };
  } else {
    if (input.payment_signature === null) return { status: 400, code: 'PAYMENT_REQUIRED' };
    if (!SIGNATURE.test(input.payment_signature)) return { status: 400, code: 'BAD_PAYMENT_SIGNATURE' };
  }
  return null;
}

/** Выдача записи для уже существующего владения: новый nonce, новый срок, та же строка владения. */
async function issue(
  store: SlotStore,
  grant: StoredGrant,
  deps: SlotServiceDeps,
  reissued: boolean,
): Promise<GrantOutcome> {
  const issuedAt = deps.now();
  const expiresAt = issuedAt + SLOT_RECORD_MAX_TTL_SECONDS;
  const record: SlotRecord = {
    v: SLOT_RECORD_VERSION,
    field_id: grant.field_id,
    slot: grant.slot,
    wallet: grant.wallet,
    nonce: deps.randomNonce(),
    issued_at: issuedAt,
    expires_at: expiresAt,
    payment_signature: grant.payment_signature,
    key_id: deps.keyId,
  };
  const invalid = validateSlotRecord(record);
  if (invalid) return { ok: false, status: 500, code: `INTERNAL_${invalid}` };
  const signature = deps.sign(record);
  await store.insertIssuance({
    grant_id: grant.id,
    nonce: record.nonce,
    key_id: deps.keyId,
    record_hash: createHash('sha256').update(canonicalJson(record)).digest('hex'),
    issued_at: new Date(issuedAt * 1000),
    expires_at: new Date(expiresAt * 1000),
  });
  return { ok: true, issued: { record, signature, grant_id: grant.id, reissued } };
}

/** Платёж уже привязан к слоту: тот же владелец и тот же слот — перевыпуск, иначе отказ. */
async function reuseByPayment(
  store: SlotStore,
  prior: StoredGrant,
  input: GrantInput,
  deps: SlotServiceDeps,
): Promise<GrantOutcome> {
  if (prior.field_id === input.field_id && prior.slot === input.slot && prior.wallet === input.wallet) {
    return issue(store, prior, deps, true);
  }
  return denied(409, 'PAYMENT_ALREADY_USED');
}

async function grantFree(input: GrantInput, deps: SlotServiceDeps): Promise<GrantOutcome> {
  return deps.runInTransaction(async store => {
    const existing = await store.findGrantBySlot(input.field_id, input.slot);
    if (existing) {
      if (existing.wallet !== input.wallet) return denied(409, 'SLOT_TAKEN');
      return issue(store, existing, deps, true);
    }
    const grant = await store.insertGrant({
      field_id: input.field_id,
      slot: input.slot,
      wallet: input.wallet,
      payment_signature: null,
      amount_units: 0n,
    });
    return issue(store, grant, deps, false);
  });
}

async function grantPaid(input: GrantInput, deps: SlotServiceDeps): Promise<GrantOutcome> {
  const signature = input.payment_signature!;

  // 1) Платёж уже использован: перевыпуск тому же владельцу или отказ. Цепь не спрашиваем.
  const prior = await deps.runInTransaction(store => store.findGrantByPayment(signature));
  if (prior) {
    return deps.runInTransaction(store => reuseByPayment(store, prior, input, deps));
  }

  // 2) Проверка платежа на цепи. Сомнительный платёж не засчитывается.
  const snapshot = await deps.fetchPayment(signature);
  if (!snapshot) return denied(402, 'PAYMENT_NOT_FOUND');
  const verdict = verifySlotPayment(snapshot, {
    mint: deps.skrMint,
    treasuryOwner: deps.treasuryOwner,
    payerWallet: input.wallet,
    expectedUnits: deps.priceUnits,
    minBlockTime: BigInt(deps.now() - PAYMENT_MAX_AGE_SECONDS),
    requiredConfirmation: 'finalized',
  });
  if (!verdict.ok) return denied(402, `PAYMENT_${verdict.code}`);

  // 3) Транзакция: повторная проверка платежа и слота, вставка владения, выдача записи.
  //    Занятый слот здесь — маркер 'review' (не исключение): withTransaction переводит чужие ошибки в mapDbError.
  let outcome: GrantOutcome | 'review';
  try {
    outcome = await deps.runInTransaction(async (store): Promise<GrantOutcome | 'review'> => {
      const again = await store.findGrantByPayment(signature);
      if (again) return reuseByPayment(store, again, input, deps);
      const taken = await store.findGrantBySlot(input.field_id, input.slot);
      if (taken) return 'review';
      const grant = await store.insertGrant({
        field_id: input.field_id,
        slot: input.slot,
        wallet: input.wallet,
        payment_signature: signature,
        amount_units: deps.priceUnits,
      });
      return issue(store, grant, deps, false);
    });
  } catch (error) {
    if (error instanceof GameOpsError && error.code === 'SLOT_TAKEN') {
      outcome = 'review';
    } else if (error instanceof GameOpsError && error.code === 'PAYMENT_ALREADY_USED') {
      return denied(409, 'PAYMENT_ALREADY_USED');
    } else {
      throw error;
    }
  }
  if (outcome === 'review') {
    // Платёж действительный, слот занят: ничего не выдаём. Случай — в ручную
    // очередь (таблица slot_payment_reviews), а не только в лог процесса.
    await recordReviewDurably(deps, input, signature);
    await deps.audit({
      outcome: 'denied',
      action: 'slot.payment.review',
      detail: { field_id: input.field_id, slot: input.slot, wallet: input.wallet, payment_signature: signature, reason: 'SLOT_TAKEN_AFTER_VALID_PAYMENT' },
    });
    return denied(409, 'SLOT_TAKEN');
  }
  return outcome;
}

/**
 * Durable-запись разбора. Сбой записи не должен превращаться в 500 у
 * покупателя: платёж уже списан, и лучший ответ — «слот занят» + запись в
 * аудит о том, что очередь не записалась (это инцидент, а не отказ клиенту).
 */
async function recordReviewDurably(deps: SlotServiceDeps, input: GrantInput, signature: string): Promise<void> {
  try {
    await deps.recordReview({
      paymentSignature: signature,
      fieldId: input.field_id,
      slot: input.slot,
      wallet: input.wallet,
      mint: deps.skrMint,
      amountUnits: deps.priceUnits,
    });
  } catch (error) {
    await deps.audit({
      outcome: 'error',
      action: 'slot.payment.review.enqueue_failed',
      detail: {
        field_id: input.field_id,
        slot: input.slot,
        wallet: input.wallet,
        payment_signature: signature,
        error: error instanceof Error ? error.name : 'unknown',
      },
    });
  }
}

/** Точка входа. Аудит пишется на каждый исход. */
export async function grantSlot(input: GrantInput, deps: SlotServiceDeps): Promise<GrantOutcome> {
  const detail = { field_id: input.field_id, slot: input.slot, wallet: input.wallet, payment_signature: input.payment_signature };
  const invalid = validateGrantInput(input);
  if (invalid) {
    await deps.audit({ outcome: 'denied', action: 'slot.grant', detail: { ...detail, reason: invalid.code } });
    return { ok: false, ...invalid };
  }
  let result: GrantOutcome;
  try {
    result = input.slot <= FREE_SLOTS ? await grantFree(input, deps) : await grantPaid(input, deps);
  } catch (error) {
    if (error instanceof GameOpsError && error.code === 'SLOT_TAKEN') {
      result = denied(409, 'SLOT_TAKEN');
    } else {
      await deps.audit({ outcome: 'error', action: 'slot.grant', detail: { ...detail, reason: 'INTERNAL' } });
      return { ok: false, status: 500, code: 'INTERNAL' };
    }
  }
  if (result.ok) {
    await deps.audit({
      outcome: 'ok',
      action: result.issued.reissued ? 'slot.reissue' : 'slot.grant',
      detail: { ...detail, grant_id: result.issued.grant_id, nonce: result.issued.record.nonce, key_id: deps.keyId },
    });
  } else {
    await deps.audit({ outcome: 'denied', action: 'slot.grant', detail: { ...detail, reason: result.code } });
  }
  return result;
}
