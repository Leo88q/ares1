/**
 * Конфигурация выдачи слотов (S7). Fail-closed: при включённом флаге всё необходимое
 * обязано быть задано, иначе эндпоинт не монтируется, а причина пишется в лог.
 *
 * Секреты (приватный ключ подписи) читаются из окружения оператора и никуда не
 * сохраняются. В репозитории и в логах их нет.
 */
import { loadSigningKey } from './record.js';
import type { KeyObject } from 'node:crypto';

export interface SlotsConfig {
  signingKey: KeyObject;
  keyId: string;
  /** Mint SKR. */
  skrMint: string;
  /** Владелец токен-аккаунта казначейства тиража. */
  treasuryOwner: string;
  /** Цена слота 7..12 в базовых единицах SKR (точное значение, без дробей). */
  priceUnits: bigint;
}

export type SlotsConfigResult =
  | { enabled: false; reason: 'flag-off' }
  | { enabled: false; reason: 'mainnet-not-approved' | 'misconfigured'; detail: string }
  | { enabled: true; config: SlotsConfig };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function resolveSlotsConfig(
  env: NodeJS.ProcessEnv,
  cluster: 'devnet' | 'mainnet-beta' | string,
): SlotsConfigResult {
  if (env.SLOTS_ENABLED !== 'true') return { enabled: false, reason: 'flag-off' };
  // Статус: mainnet — NO-GO (docs/ORGANISM_INTEGRATION.md §32.8). Слоты на mainnet не монтируются.
  if (cluster === 'mainnet-beta') {
    return { enabled: false, reason: 'mainnet-not-approved', detail: 'слоты не включаются на mainnet без GO владельца' };
  }
  const missing = ['SLOT_SIGNING_KEY_PEM', 'SLOT_KEY_ID', 'SKR_MINT', 'SLOT_TREASURY_OWNER', 'SLOT_PRICE_UNITS']
    .filter(name => !env[name]);
  if (missing.length) {
    return { enabled: false, reason: 'misconfigured', detail: `не заданы: ${missing.join(', ')}` };
  }
  if (!BASE58.test(env.SKR_MINT!) || !BASE58.test(env.SLOT_TREASURY_OWNER!)) {
    return { enabled: false, reason: 'misconfigured', detail: 'SKR_MINT и SLOT_TREASURY_OWNER должны быть адресами base58' };
  }
  if (!/^[a-z0-9._-]{1,40}$/.test(env.SLOT_KEY_ID!)) {
    return { enabled: false, reason: 'misconfigured', detail: 'SLOT_KEY_ID: только a-z, 0-9, . _ -' };
  }
  if (!/^[1-9][0-9]*$/.test(env.SLOT_PRICE_UNITS!)) {
    return { enabled: false, reason: 'misconfigured', detail: 'SLOT_PRICE_UNITS: положительное целое в базовых единицах' };
  }
  let signingKey: KeyObject;
  try {
    signingKey = loadSigningKey(env.SLOT_SIGNING_KEY_PEM!);
  } catch {
    return { enabled: false, reason: 'misconfigured', detail: 'SLOT_SIGNING_KEY_PEM: не ed25519 PKCS8 PEM' };
  }
  return {
    enabled: true,
    config: {
      signingKey,
      keyId: env.SLOT_KEY_ID!,
      skrMint: env.SKR_MINT!,
      treasuryOwner: env.SLOT_TREASURY_OWNER!,
      priceUnits: BigInt(env.SLOT_PRICE_UNITS!),
    },
  };
}
