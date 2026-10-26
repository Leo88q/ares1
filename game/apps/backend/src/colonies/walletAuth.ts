import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature } from 'node:crypto';

export interface WalletChallenge {
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
}

export interface WalletSession {
  wallet: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DEFAULT_CHALLENGE_TTL_MS = 5 * 60_000;
const DEFAULT_SESSION_TTL_SECONDS = 15 * 60;

function decodeBase58(value: string): Buffer {
  if (!value || value.length > 64 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) throw new Error('Invalid base58 value');
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(alphabet.indexOf(char));
  let hex = number.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = number === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  const leadingZeroes = value.match(/^1*/)?.[0].length ?? 0;
  return Buffer.concat([Buffer.alloc(leadingZeroes), body]);
}

function assertWallet(wallet: string): void {
  if (decodeBase58(wallet).length !== 32) throw new Error('Wallet must be a 32-byte Solana public key');
}

function normalizeOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('Invalid wallet-auth origin');
  }
  if (parsed.origin !== origin || (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost')) {
    throw new Error('Wallet-auth origin must be an HTTPS origin');
  }
  return parsed.origin;
}

export function createWalletChallenge(params: {
  wallet: string;
  origin: string;
  cluster: 'devnet' | 'mainnet-beta';
  now?: Date;
  ttlMs?: number;
}): WalletChallenge {
  assertWallet(params.wallet);
  const origin = normalizeOrigin(params.origin);
  const now = params.now ?? new Date();
  const ttl = params.ttlMs ?? DEFAULT_CHALLENGE_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < 30_000 || ttl > DEFAULT_CHALLENGE_TTL_MS) {
    throw new Error('Challenge TTL must be between 30 seconds and 5 minutes');
  }
  const expires = new Date(now.getTime() + ttl);
  const nonce = randomBytes(32).toString('base64url');
  const issuedAt = now.toISOString();
  const expiresAt = expires.toISOString();
  const message = [
    'ARES-1 wallet sign-in',
    `Domain: ${origin}`,
    `Wallet: ${params.wallet}`,
    `Cluster: ${params.cluster}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
    'Statement: Sign only to authenticate. This does not authorize a token transfer or transaction.',
  ].join('\n');
  return { nonce, message, issuedAt, expiresAt };
}

/** Persist only hashes, never the reusable signed challenge body or plaintext nonce. */
export function hashWalletChallenge(message: string): { messageHash: string; nonceHash: string } {
  if (message.length < 100 || message.length > 1200) throw new Error('Invalid wallet challenge message');
  const nonce = /^Nonce: ([A-Za-z0-9_-]{40,50})$/m.exec(message)?.[1];
  if (!nonce) throw new Error('Wallet challenge nonce missing');
  return {
    messageHash: createHash('sha256').update(message, 'utf8').digest('hex'),
    nonceHash: createHash('sha256').update(nonce, 'utf8').digest('hex'),
  };
}

export function verifyWalletChallenge(params: {
  wallet: string;
  origin: string;
  message: string;
  signatureBase64Url: string;
}): boolean {
  try {
    assertWallet(params.wallet);
    normalizeOrigin(params.origin);
    if (params.message.length < 100 || params.message.length > 1200) return false;
    if (!params.message.includes(`Domain: ${params.origin}\n`) || !params.message.includes(`Wallet: ${params.wallet}\n`)) return false;
    if (!params.message.includes('Statement: Sign only to authenticate.')) return false;
    const keyBytes = decodeBase58(params.wallet);
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, keyBytes]), format: 'der', type: 'spki' });
    const signature = Buffer.from(params.signatureBase64Url, 'base64url');
    if (signature.length !== 64) return false;
    return verifySignature(null, Buffer.from(params.message, 'utf8'), key, signature);
  } catch {
    return false;
  }
}

function sessionSecretBytes(secret: string): Buffer {
  const bytes = Buffer.from(secret, 'utf8');
  if (bytes.length < 32) throw new Error('COLONY_SESSION_SECRET must contain at least 32 UTF-8 bytes');
  return bytes;
}

export function issueWalletSession(params: {
  wallet: string;
  origin: string;
  secret: string;
  nowSeconds?: number;
  ttlSeconds?: number;
}): string {
  assertWallet(params.wallet);
  const origin = normalizeOrigin(params.origin);
  const issuedAt = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !Number.isSafeInteger(ttl) || ttl < 60 || ttl > DEFAULT_SESSION_TTL_SECONDS) {
    throw new Error('Invalid wallet session lifetime');
  }
  const payload: WalletSession = { wallet: params.wallet, origin, issuedAt, expiresAt: issuedAt + ttl };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', sessionSecretBytes(params.secret)).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyWalletSession(params: {
  token: string;
  origin: string;
  secret: string;
  nowSeconds?: number;
}): WalletSession | null {
  try {
    const [encoded, suppliedSignature, extra] = params.token.split('.');
    if (!encoded || !suppliedSignature || extra !== undefined) return null;
    const expected = createHmac('sha256', sessionSecretBytes(params.secret)).update(encoded).digest();
    const supplied = Buffer.from(suppliedSignature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as WalletSession;
    const origin = normalizeOrigin(params.origin);
    const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (payload.origin !== origin || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
      || payload.issuedAt > now + 30 || payload.expiresAt <= now || payload.expiresAt - payload.issuedAt > DEFAULT_SESSION_TTL_SECONDS) return null;
    assertWallet(payload.wallet);
    return payload;
  } catch {
    return null;
  }
}
