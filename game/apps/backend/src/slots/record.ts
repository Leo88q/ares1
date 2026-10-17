/**
 * Подписанная запись слота (S7, docs/S7_SLOT_AUTHORITY_SPEC.md §2 и §5).
 *
 * Запись утверждает: «кошелёк W вправе занять слот N на поле F до времени T».
 * Подпись — ed25519 над строкой с доменным префиксом и канонической JSON.
 *
 * Модуль чистый: ключи передаются аргументами. Загрузка приватного ключа из
 * окружения оператора и хранение в секретах — вне репозитория, здесь их нет.
 * Никакой БД и сети.
 */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const SLOT_RECORD_VERSION = 1;
/** Доменный префикс: подпись записи слота не может быть принята за подпись другого сообщения. */
export const SLOT_SIGNING_DOMAIN = 'ares1-slot-record-v1\n';
/** Максимальный срок записи (решение S7 по вопросу 2): 1 час. */
export const SLOT_RECORD_MAX_TTL_SECONDS = 3600;
export const FREE_SLOTS = 6;
export const MAX_SLOT = 12;

export interface SlotRecord {
  v: number;
  field_id: string;
  slot: number;
  wallet: string;
  nonce: string;
  issued_at: number;
  expires_at: number;
  /** Подпись SKR-платежа; null только для бесплатных слотов 1..6. */
  payment_signature: string | null;
  key_id: string;
}

export type SlotRecordError =
  | 'BAD_VERSION'
  | 'BAD_FIELD'
  | 'BAD_SLOT'
  | 'BAD_WALLET'
  | 'BAD_NONCE'
  | 'BAD_TIME'
  | 'TTL_TOO_LONG'
  | 'PAYMENT_MISMATCH'
  | 'BAD_KEY_ID';

/** Каноническая JSON: ключи по алфавиту, undefined пропускаются. Совпадает по правилу со stableStringify из gameops. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, entry]) => `${JSON.stringify(k)}:${canonicalJson(entry)}`).join(',')}}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const KEY_ID = /^[a-z0-9._-]{1,40}$/;
const FIELD_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Проверка полей записи до подписи. Ошибка — это отказ выдать запись, а не предупреждение. */
export function validateSlotRecord(r: SlotRecord): SlotRecordError | null {
  if (r.v !== SLOT_RECORD_VERSION) return 'BAD_VERSION';
  if (!FIELD_ID.test(r.field_id)) return 'BAD_FIELD';
  if (!Number.isInteger(r.slot) || r.slot < 1 || r.slot > MAX_SLOT) return 'BAD_SLOT';
  if (!BASE58.test(r.wallet)) return 'BAD_WALLET';
  if (!UUID.test(r.nonce)) return 'BAD_NONCE';
  if (!KEY_ID.test(r.key_id)) return 'BAD_KEY_ID';
  if (!Number.isInteger(r.issued_at) || !Number.isInteger(r.expires_at)) return 'BAD_TIME';
  const ttl = r.expires_at - r.issued_at;
  if (ttl <= 0) return 'BAD_TIME';
  if (ttl > SLOT_RECORD_MAX_TTL_SECONDS) return 'TTL_TOO_LONG';
  // Бесплатные 1..6 — без платежа; платные 7..12 — с подписью платежа (как в БД, 0009_slot_grants).
  const paid = r.slot > FREE_SLOTS;
  if (paid) {
    if (r.payment_signature === null || !SIGNATURE.test(r.payment_signature)) return 'PAYMENT_MISMATCH';
  } else if (r.payment_signature !== null) {
    return 'PAYMENT_MISMATCH';
  }
  return null;
}

/** Байты, которые подписываются: доменный префикс + каноническая JSON записи. */
export function signingMessage(r: SlotRecord): Buffer {
  return Buffer.from(SLOT_SIGNING_DOMAIN + canonicalJson(r), 'utf8');
}

/** Загрузка приватного ключа из PEM (PKCS8). Ключ не сохраняется нигде, кроме памяти процесса. */
export function loadSigningKey(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('signing key must be ed25519');
  return key;
}

/** Подписать запись. Возвращает base64-подпись. Ошибочную запись не подписывает. */
export function signSlotRecord(r: SlotRecord, key: KeyObject): string {
  const err = validateSlotRecord(r);
  if (err) throw new RangeError(`slot record rejected: ${err}`);
  return sign(null, signingMessage(r), key).toString('base64');
}

export type SlotVerdict = { ok: true } | { ok: false; code: SlotRecordError | 'UNKNOWN_KEY' | 'BAD_SIGNATURE' | 'EXPIRED' };

/**
 * Проверка записи клиентом или аудитом. keyring: key_id → публичный ключ (ротация: несколько ключей).
 * Неизвестный key_id — отказ, даже если подпись где-то совпадает.
 */
export function verifySlotRecord(
  r: SlotRecord,
  signatureB64: string,
  keyring: ReadonlyMap<string, KeyObject>,
  nowSeconds: number,
): SlotVerdict {
  const err = validateSlotRecord(r);
  if (err) return { ok: false, code: err };
  const key = keyring.get(r.key_id);
  if (!key) return { ok: false, code: 'UNKNOWN_KEY' };
  let good = false;
  try {
    good = verify(null, signingMessage(r), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, code: 'BAD_SIGNATURE' };
  if (nowSeconds >= r.expires_at) return { ok: false, code: 'EXPIRED' };
  return { ok: true };
}

/** Публичный ключ из приватного — для публикации в конфигурации клиента. */
export function publicKeyOf(key: KeyObject): KeyObject {
  return createPublicKey(key);
}
