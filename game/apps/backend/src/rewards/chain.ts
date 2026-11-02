/**
 * Ончейн-часть авто-доставки: адреса и чтение факта «грант уже существует».
 *
 * Здесь нет решений — только перевод между видами данных:
 *   - ATA интента → владелец (кошелёк игрока), потому что в reward_intents
 *     хранится адрес токен-аккаунта, а `grant_reward_once` подписывается за
 *     владельца ATA;
 *   - PDA `[b"reward", ata, nonce]` → история подписей, чтобы восстановить
 *     подпись гранта, отправленного до падения процесса.
 *
 * Разбор parsed-аккаунта вынесен в чистую функцию: RPC-ответ — это слабо
 * типизированный JSON, и ошибка в нём не должна требовать стенда для проверки.
 */
import type { Connection, PublicKey } from "@solana/web3.js";
import { PublicKey as Pubkey } from "@solana/web3.js";
import { u64LE } from "../anchorRaw.js";

/** PDA клейма ровно как в программе: seeds = [b"reward", ata, nonce_le]. */
export function claimPda(programId: PublicKey, ata: PublicKey, nonce: bigint): PublicKey {
  return Pubkey.findProgramAddressSync(
    [Buffer.from("reward"), ata.toBuffer(), u64LE(nonce)],
    programId,
  )[0];
}

interface ParsedTokenAccount {
  data?: {
    parsed?: {
      info?: { owner?: unknown; mint?: unknown };
    };
  };
}

/**
 * Владелец SPL-аккаунта из `getParsedAccountInfo`. Возвращает base58 или null,
 * если форма ответа не та: молча «угадать» адрес здесь дороже, чем пропустить
 * интент до следующего такта.
 */
export function parseAtaOwner(account: unknown): string | null {
  const parsed = (account as ParsedTokenAccount | null)?.data?.parsed?.info;
  const owner = parsed?.owner;
  if (typeof owner !== "string") return null;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner) ? owner : null;
}

export async function resolveAtaOwner(connection: Connection, ata: PublicKey): Promise<PublicKey> {
  const info = await connection.getParsedAccountInfo(ata, "confirmed");
  const owner = parseAtaOwner(info.value);
  if (!owner) throw new Error(`REWARD_RAIL: ATA ${ata.toBase58()} has no readable owner`);
  return new Pubkey(owner);
}

export interface ExistingGrant {
  signature: string;
  slot?: bigint;
}

/**
 * Подпись транзакции, создавшей PDA гранта. `getSignaturesForAddress`
 * возвращает и слот — он нужен `markConfirmed`, потому что подтверждение
 * фиксируется вместе со слотом.
 */
export async function findExistingGrant(connection: Connection, pda: PublicKey): Promise<ExistingGrant | null> {
  const history = await connection.getSignaturesForAddress(pda, { limit: 1 }, "confirmed");
  const first = history[0];
  if (!first || first.err) return null;
  return { signature: first.signature, slot: BigInt(first.slot) };
}
