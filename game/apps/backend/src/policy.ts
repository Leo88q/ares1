import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  anchorDiscriminator,
  decodeEpoch,
  decodeGameConfig,
  EpochAccount,
  GameConfig,
} from "./anchorRaw.js";

/**
 * Независимый policy-слой для ЕДИНСТВЕННОГО автоматического подписанта проекта
 * (permissionless крон `roll_epoch`) — аудит 2026-09-28, пункты чек-листа
 * инцидентов 102 / 103 / 108 / 114 / 127.
 *
 * Прецеденты 2026 года:
 *  - KelpDAO (п. 103): офчейн-подписант читал состояние цепи из отравленного
 *    источника (op-geth в кластере атакующего), а мониторинг — из честного.
 *    Ответ здесь: РЕШЕНИЕ О ПОДПИСИ принимается только по снапшоту, который
 *    сходится минимум у двух независимых RPC-провайдеров, и по коммитменту
 *    `finalized`, а не `confirmed`/`processed`.
 *  - jaredfromsubway.eth (п. 108) и SwapNet/Aperture (п. 114): бот подписал
 *    инструкции, подложенные контрагентом. Ответ здесь: жёсткий allowlist
 *    программ И discriminator'ов инструкций, проверяемый в самой точке
 *    подписи (`sendVersionedTx`), независимо от того, какой код собрал
 *    транзакцию.
 *  - Bitget (п. 127): компрометация approval-бэкенда. Полная защита —
 *    отдельный policy-движок вне инициирующего бэкенда (см.
 *    MAINNET_LAUNCH_GATE.md G-7); этот модуль — первый эшелон того же класса:
 *    политики живут ЗДЕСЬ, а не в коде, который инициирует транзакцию.
 *
 * Все проверки fail-closed: любое сомнение = отказ от подписи + алерт.
 */

/** Программы, которые крон-подписант имеет право вызывать. Всё остальное — отказ. */
export function payerAllowedPrograms(gameProgramId: PublicKey): PublicKey[] {
  return [gameProgramId, SystemProgram.programId, ComputeBudgetProgram.programId];
}

/**
 * Инструкции собственной программы, которые крон имеет право отправлять.
 * `roll_epoch` / `init_epoch` — permissionless, подписант здесь только платит
 * ренту и комиссию (assertDedicatedPayer следит, что это НЕ authority).
 */
export const PAYER_ALLOWED_GAME_INSTRUCTIONS = ["roll_epoch", "init_epoch"] as const;

/** hex-дискриминаторы разрешённых инструкций (первый u64 sha256(namespace:name)). */
export function payerAllowedDiscriminators(): Set<string> {
  return new Set(
    PAYER_ALLOWED_GAME_INSTRUCTIONS.map(name =>
      anchorDiscriminator("global", name).toString("hex"),
    ),
  );
}

/** System-program instruction types, безопасные для этого подписанта: transfer = 2. */
export const PAYER_ALLOWED_SYSTEM_TYPES = new Set([2]);

/**
 * Проверка инструкций ПЕРЕД подписью. Вызывается из sendVersionedTx — то есть
 * срабатывает независимо от того, какой модуль собрал транзакцию.
 * @throws Error с префиксом PAYER_POLICY — воспринимать как инцидент, не как баг.
 */
export function assertPayerInstructionsAllowed(
  ixs: readonly TransactionInstruction[],
  gameProgramId: PublicKey,
): void {
  if (ixs.length === 0) throw new Error("PAYER_POLICY: empty instruction list");
  const allowedPrograms = payerAllowedPrograms(gameProgramId);
  const allowedDiscriminators = payerAllowedDiscriminators();
  for (const ix of ixs) {
    if (!allowedPrograms.some(p => p.equals(ix.programId))) {
      throw new Error(
        `PAYER_POLICY: instruction targets non-allowlisted program ${ix.programId.toBase58()}`,
      );
    }
    if (ix.programId.equals(gameProgramId)) {
      const disc = Buffer.from(ix.data.subarray(0, 8)).toString("hex");
      if (!allowedDiscriminators.has(disc)) {
        throw new Error(`PAYER_POLICY: game instruction ${disc} is not in the payer allowlist`);
      }
    }
    if (ix.programId.equals(SystemProgram.programId)) {
      const type = ix.data.length > 0 ? ix.data[0] : -1;
      if (!PAYER_ALLOWED_SYSTEM_TYPES.has(type)) {
        // Durable nonce (типы 4–7, 12) для этого подписанта запрещён на уровне
        // политики: подпись по nonce не истекает — прецедент Drift (п. 82).
        throw new Error(`PAYER_POLICY: system instruction type ${type} is not allowed`);
      }
    }
  }
}

/** Снапшот данных, на которых принимается решение о подписи. */
export interface SigningSnapshot {
  config: GameConfig;
  epoch: EpochAccount;
  slot: number;
}

/**
 * Читает config + epoch по PDAs с коммитментом `finalized` (п. 103: решение о
 * выплате/переходе эпохи — только по финализированному состоянию).
 * @throws если аккаунтов нет или владелец не программа (подмена owner).
 */
export async function fetchSigningSnapshot(
  connection: Connection,
  programId: PublicKey,
): Promise<SigningSnapshot> {
  const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
  const [configInfo, slot] = await Promise.all([
    connection.getAccountInfo(configPda, "finalized"),
    connection.getSlot("finalized"),
  ]);
  if (!configInfo) throw new Error("PAYER_POLICY: config account not found");
  if (!configInfo.owner.equals(programId)) {
    throw new Error("PAYER_POLICY: config account has unexpected owner");
  }
  const config = decodeGameConfig(Buffer.from(configInfo.data));
  const epochIdBuf = Buffer.alloc(8);
  epochIdBuf.writeBigUInt64LE(config.epochId);
  const epochAccount = PublicKey.findProgramAddressSync(
    [Buffer.from("epoch"), epochIdBuf],
    programId,
  )[0];
  const epochInfo = await connection.getAccountInfo(epochAccount, "finalized");
  if (!epochInfo) throw new Error("PAYER_POLICY: epoch account not found");
  if (!epochInfo.owner.equals(programId)) {
    throw new Error("PAYER_POLICY: epoch account has unexpected owner");
  }
  const epoch = decodeEpoch(Buffer.from(epochInfo.data));
  return { config, epoch, slot };
}

/**
 * Чистая сверка двух снапшотов (unit-тестируется без RPC).
 * Ключевые для решения поля: epochId, startTime, mintCap, minted.
 * Расхождение ЛЮБОГО = отравленный источник (п. 103) → подпись отменяется.
 */
export function compareSnapshots(
  primary: SigningSnapshot,
  secondary: SigningSnapshot,
): string[] {
  const mismatches: string[] = [];
  if (primary.config.epochId !== secondary.config.epochId) {
    mismatches.push(`config.epochId ${primary.config.epochId} != ${secondary.config.epochId}`);
  }
  if (primary.epoch.id !== secondary.epoch.id) {
    mismatches.push(`epoch.id ${primary.epoch.id} != ${secondary.epoch.id}`);
  }
  if (primary.epoch.startTime !== secondary.epoch.startTime) {
    mismatches.push(`epoch.startTime ${primary.epoch.startTime} != ${secondary.epoch.startTime}`);
  }
  if (primary.epoch.mintCapMicro !== secondary.epoch.mintCapMicro) {
    mismatches.push(`epoch.mintCapMicro ${primary.epoch.mintCapMicro} != ${secondary.epoch.mintCapMicro}`);
  }
  if (primary.epoch.mintedMicro !== secondary.epoch.mintedMicro) {
    mismatches.push(`epoch.mintedMicro ${primary.epoch.mintedMicro} != ${secondary.epoch.mintedMicro}`);
  }
  return mismatches;
}

export class DataSourceMismatchError extends Error {
  constructor(public mismatches: string[]) {
    super(`PAYER_POLICY: data sources disagree — ${mismatches.join("; ")}`);
    this.name = "DataSourceMismatchError";
  }
}

/**
 * Сверяет снапшот основного источника со вторым независимым RPC (п. 103).
 * secondary = null + requireSecondary → fail-closed (прод-требование).
 */
export function verifySnapshotConsistency(
  primary: SigningSnapshot,
  secondary: SigningSnapshot | null,
  requireSecondary: boolean,
): void {
  if (!secondary) {
    if (requireSecondary) {
      throw new Error(
        "PAYER_POLICY: RPC_URL_SECONDARY is required for signing decisions in this environment",
      );
    }
    return;
  }
  const mismatches = compareSnapshots(primary, secondary);
  if (mismatches.length > 0) throw new DataSourceMismatchError(mismatches);
}
