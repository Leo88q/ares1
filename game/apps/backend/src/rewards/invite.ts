/**
 * Приглашение на стартовый набор: единственный способ получить 250 POTATO
 * новому кошельку.
 *
 * Зачем. До этого эндпоинт `/api/rewards/starter` выдавал ровно цену Луга
 * **любому** валидному base58-адресу. Проверка «один раз на кошелёк» держится
 * на PDA `[reward, ata, nonce]`, а nonce детерминирован от адреса, — значит
 * Sybil-ферма из N сгенерированных ключей получала 250×N POTATO бесплатно,
 * без единой транзакции со своей стороны. Ончейн-квота грантов (25 % капа
 * эпохи) ограничивает ущерб сверху, но не делает выдачу честной: платящий
 * игрок и бот на 80 кошельков входят в игру одинаково.
 *
 * Как закрыто. Грант выдаётся только по коду, подписанному оператором:
 *
 *   v1.<base64url(payload)>.<base64url(HMAC-SHA256(secret, "v1."+payload))>
 *   payload = {"w":"<wallet>","e":<unix-время истечения>}
 *
 * Код привязан к кошельку и к сроку, поэтому:
 *   - чужой код не подходит (wallet-mismatch);
 *   - просроченный не подходит (expired);
 *   - без секрета оператора код не подделать (bad-signature).
 *
 * Хранилища нет: всё, что нужно для проверки, лежит в самом коде. Это
 * осознанно — таблица «кто уже получил приглашение» в памяти процесса терялась
 * бы при рестарте и расходилась бы между репликами, а персистентное хранилище
 * для этой задачи не оправдано. Повторную выдачу по тому же коду всё равно
 * остановит ончейн-PDA гранта: стартовый nonce детерминирован от адреса.
 *
 * Дейлик этот модуль не трогает: он требует не приглашения, а **активного
 * поля** на цепи (см. `fieldProbe.ts`) — то есть награду за возвращение
 * получает тот, кто уже играет, а не пустой кошелёк.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const INVITE_VERSION = 'v1';
/** Половина суток — оператор успевает передать код, бот не копит их пачками. */
export const DEFAULT_INVITE_TTL_SECONDS = 12 * 60 * 60;
/** Верхняя граница: код, живущий месяц, — это открытая дверь для перепродажи. */
export const MAX_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface InvitePayload {
  /** Кошелёк, которому выдан код (base58, как его пришлёт клиент). */
  wallet: string;
  /** Unix-время, после которого код недействителен. */
  expiresAt: number;
}

export type InviteFailure =
  | 'malformed'
  | 'bad-signature'
  | 'expired'
  | 'wallet-mismatch'
  | 'secret-missing';

export type InviteCheck = { ok: true; payload: InvitePayload } | { ok: false; reason: InviteFailure };

const base64url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64url = (text: string): Buffer | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
};

const sign = (payloadPart: string, secret: string): string =>
  base64url(createHmac('sha256', secret).update(`${INVITE_VERSION}.${payloadPart}`).digest());

/**
 * Собирает код приглашения. Секрет — только на сервере оператора; в бандл и в
 * git он не попадает.
 */
export function issueInvite(input: {
  wallet: string;
  nowSeconds: number;
  secret: string;
  ttlSeconds?: number;
}): string {
  if (!input.secret) throw new Error('invite: secret is required');
  if (!input.wallet) throw new Error('invite: wallet is required');
  const ttl = input.ttlSeconds ?? DEFAULT_INVITE_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('invite: ttl must be positive');
  if (ttl > MAX_INVITE_TTL_SECONDS) throw new Error('invite: ttl exceeds the maximum');
  const payload: InvitePayload = {
    wallet: input.wallet,
    expiresAt: Math.floor(input.nowSeconds + ttl),
  };
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${INVITE_VERSION}.${body}.${sign(body, input.secret)}`;
}

/**
 * Проверяет код против кошелька и текущего времени.
 *
 * Сравнение подписи — constant-time: `timingSafeEqual` на буферах равной длины,
 * иначе по времени ответа можно подбирать HMAC байт за байтом.
 */
export function verifyInvite(
  code: string,
  input: { wallet: string; nowSeconds: number; secret: string | null },
): InviteCheck {
  if (!input.secret) return { ok: false, reason: 'secret-missing' };
  const parts = typeof code === 'string' ? code.trim().split('.') : [];
  if (parts.length !== 3 || parts[0] !== INVITE_VERSION) return { ok: false, reason: 'malformed' };
  const [, body, signature] = parts as [string, string, string];
  const expected = sign(body, input.secret);
  if (expected.length !== signature.length) return { ok: false, reason: 'bad-signature' };
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return { ok: false, reason: 'bad-signature' };
  }
  const raw = fromBase64url(body);
  if (!raw) return { ok: false, reason: 'malformed' };
  let payload: InvitePayload;
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'malformed' };
    const candidate = parsed as Partial<InvitePayload>;
    if (typeof candidate.wallet !== 'string' || typeof candidate.expiresAt !== 'number') {
      return { ok: false, reason: 'malformed' };
    }
    if (!Number.isFinite(candidate.expiresAt)) return { ok: false, reason: 'malformed' };
    payload = { wallet: candidate.wallet, expiresAt: candidate.expiresAt };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  // Кошелёк сверяем ПОСЛЕ подписи: иначе клиент узнаёт, для кого код, не имея
  // на него прав.
  if (payload.wallet !== input.wallet) return { ok: false, reason: 'wallet-mismatch' };
  if (payload.expiresAt <= Math.floor(input.nowSeconds)) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
