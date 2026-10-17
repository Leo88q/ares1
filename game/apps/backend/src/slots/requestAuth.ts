/**
 * Подтверждение владения кошельком для запроса слота.
 *
 * Без этой проверки любой мог бы попросить подписанную запись «кошелёк W владеет
 * слотом» для чужого адреса. Поэтому запрос подписывается ключом кошелька
 * (signMessage в Solana) вместе с меткой времени. Окно — ±5 минут.
 *
 * Это дополнение к S7, которого не было в спецификации: без него подписанная запись
 * ничего не доказывает. Решение владельца по этому дополнению — на ревью.
 */
import { createPublicKey, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

export const REQUEST_AUTH_DOMAIN = 'ares1-slot-request-v1';
export const REQUEST_AUTH_WINDOW_SECONDS = 300;

export interface SlotRequestFields {
  field_id: string;
  slot: number;
  wallet: string;
  payment_signature: string | null;
}

/** Строка, которую подписывает кошелёк. Порядок и формат фиксированы. */
export function requestAuthMessage(fields: SlotRequestFields, timestampSeconds: number): Buffer {
  return Buffer.from(
    [
      REQUEST_AUTH_DOMAIN,
      `field=${fields.field_id}`,
      `slot=${fields.slot}`,
      `wallet=${fields.wallet}`,
      `payment=${fields.payment_signature ?? '-'}`,
      `ts=${timestampSeconds}`,
    ].join('\n'),
    'utf8',
  );
}

// Префикс SPKI для ed25519: 302a300506032b6570032100 + 32 байта ключа.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export type RequestAuthResult = { ok: true } | { ok: false; code: 'AUTH_STALE' | 'AUTH_BAD_WALLET' | 'AUTH_BAD_SIGNATURE' };

export function verifyRequestAuth(
  fields: SlotRequestFields,
  timestampSeconds: number,
  signatureB64: string,
  nowSeconds: number,
): RequestAuthResult {
  if (Math.abs(nowSeconds - timestampSeconds) > REQUEST_AUTH_WINDOW_SECONDS) {
    return { ok: false, code: 'AUTH_STALE' };
  }
  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = new PublicKey(fields.wallet).toBytes();
  } catch {
    return { ok: false, code: 'AUTH_BAD_WALLET' };
  }
  if (pubkeyBytes.length !== 32) return { ok: false, code: 'AUTH_BAD_WALLET' };
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubkeyBytes)]),
    format: 'der',
    type: 'spki',
  });
  let good = false;
  try {
    good = verify(null, requestAuthMessage(fields, timestampSeconds), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    good = false;
  }
  return good ? { ok: true } : { ok: false, code: 'AUTH_BAD_SIGNATURE' };
}
