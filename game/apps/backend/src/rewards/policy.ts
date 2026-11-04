/**
 * Политика ключа-подписанта рельсы наград.
 *
 * Это отдельный ключ, отличный и от authority программы, и от payer-крона:
 *   - authority подписывает админ-операции (тимлоки, выводы казны, миграции);
 *   - payer платит только за roll_epoch/init_epoch;
 *   - reward_signer может ровно одно — `grant_reward_once` (+ создание ATA
 *     получателя, без которого инструкция не найдёт token account).
 *
 * Смысл разделения: компрометация ключа рельсы ограничена суточной квотой
 * грантов и не даёт ни вывести казну, ни переписать конфиг.
 */
import { PublicKey, SystemProgram, ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { anchorDiscriminator } from "../anchorRaw.js";

/** SPL Associated Token Account program. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** `create_idempotent` = 1; `create` = 0. Разрешаем только идемпотентную форму. */
export const ATA_CREATE_IDEMPOTENT = 1;

/** Единственная инструкция игры, которую может подписать этот ключ. */
export const REWARD_ALLOWED_GAME_INSTRUCTIONS = ["grant_reward_once"] as const;

export function rewardAllowedDiscriminators(): Set<string> {
  return new Set(
    REWARD_ALLOWED_GAME_INSTRUCTIONS.map(name =>
      anchorDiscriminator("global", name).toString("hex"),
    ),
  );
}

/**
 * @throws Error с префиксом REWARD_POLICY — это инцидент, а не ошибка ввода.
 */
export function assertRewardInstructionsAllowed(
  ixs: readonly TransactionInstruction[],
  gameProgramId: PublicKey,
): void {
  if (ixs.length === 0) throw new Error("REWARD_POLICY: empty instruction list");
  const allowed = rewardAllowedDiscriminators();
  for (const ix of ixs) {
    if (ix.programId.equals(gameProgramId)) {
      const disc = Buffer.from(ix.data.subarray(0, 8)).toString("hex");
      if (!allowed.has(disc)) {
        throw new Error(`REWARD_POLICY: game instruction ${disc} is not in the reward allowlist`);
      }
      continue;
    }
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const type = ix.data.length > 0 ? ix.data[0] : -1;
      if (type !== ATA_CREATE_IDEMPOTENT) {
        throw new Error(`REWARD_POLICY: ATA instruction ${type} is not allowed`);
      }
      continue;
    }
    if (ix.programId.equals(ComputeBudgetProgram.programId) || ix.programId.equals(SystemProgram.programId)) {
      // ComputeBudget добавляет наш собственный отправитель, а System нужен
      // только как внутренний CPI программы ATA — прямых transfer здесь нет.
      if (ix.programId.equals(SystemProgram.programId)) {
        throw new Error("REWARD_POLICY: direct system instructions are not allowed");
      }
      continue;
    }
    throw new Error(`REWARD_POLICY: instruction targets non-allowlisted program ${ix.programId.toBase58()}`);
  }
}

/**
 * Ключ рельсы не должен совпадать с authority программы или с payer-кроном.
 * Проверка вызывается на старте и при каждой выдаче — расхождение считается
 * инцидентом конфигурации, а не «мелкой опечаткой в .env».
 */
export function assertDedicatedRewardSigner(
  rewardSigner: PublicKey,
  config: { authority: PublicKey; rewardSigner: PublicKey },
  payer: PublicKey,
): void {
  if (rewardSigner.equals(config.authority)) {
    throw new Error("REWARD_POLICY: reward signer must not be the program authority");
  }
  if (rewardSigner.equals(payer)) {
    throw new Error("REWARD_POLICY: reward signer must be a dedicated key, not the epoch payer");
  }
  if (!rewardSigner.equals(config.rewardSigner)) {
    throw new Error("REWARD_POLICY: signer is not the on-chain reward_signer for this program");
  }
}
