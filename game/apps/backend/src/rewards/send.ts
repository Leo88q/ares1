/**
 * Отправка одного гранта с отдельного ключа `reward_signer`.
 *
 * Отличия от sendVersionedTx (крона):
 *   - платит и подписывает другой ключ (REWARD_KEYPAIR_JSON), а не payer;
 *   - политика инструкций своя (только grant_reward_once + идемпотентная ATA);
 *   - перед подписью сверяется ончейн-конфиг: ключ обязан быть тем самым
 *     reward_signer, иначе транзакция упадёт Unauthorized уже после оплаты.
 *
 * Транзакция симулируется перед отправкой тем же способом, что и у крона:
 * падение симуляции означает баг, а не «повезёт со второй попытки».
 */
import fs from "node:fs";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { assertDedicatedRewardSigner, assertRewardInstructionsAllowed } from "./policy.js";
import { anchorDiscriminator, i64LE, u64LE } from "../anchorRaw.js";

export interface RewardSignerConfig {
  /** Secret key: путь к JSON-файлу solana-keygen либо inline JSON-массив. */
  secret: string;
}

/**
 * Загрузка ключа. Пустая строка = рельса выключена (это нормальное состояние
 * до запуска, а не ошибка конфигурации).
 */
export function loadRewardKeypair(secret: string | undefined): Keypair | null {
  const value = secret?.trim();
  if (!value) return null;
  const raw = value.startsWith("[") ? value : fs.readFileSync(value.replace(/^~/, process.env.HOME || ""), "utf-8");
  const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
  return Keypair.fromSecretKey(bytes);
}

export interface GrantInput {
  connection: Connection;
  signer: Keypair;
  programId: PublicKey;
  config: PublicKey;
  epoch: PublicKey;
  potatoMint: PublicKey;
  /** Кошелёк получателя; его ATA создаётся идемпотентно при необходимости. */
  wallet: PublicKey;
  amountMicro: bigint;
  nonce: bigint;
  expiresAt: bigint;
}

export interface GrantRailContext {
  /** Декодированный ончейн-конфиг — нужен для проверки ключа и адресов. */
  gameConfig: { authority: PublicKey; rewardSigner: PublicKey; paused: boolean };
  payer: PublicKey;
}

/** Собирает инструкции гранта, не подписывая ничего. */
export function buildGrantInstructions(
  input: Omit<GrantInput, "connection" | "signer">,
  signer: PublicKey,
): TransactionInstruction[] {
  const userAta = getAssociatedTokenAddressSync(input.potatoMint, input.wallet, false);
  const createAta = createAssociatedTokenAccountIdempotentInstruction(
    signer,
    userAta,
    input.wallet,
    input.potatoMint,
  );
  const claimPda = PublicKey.findProgramAddressSync(
    [Buffer.from("reward"), userAta.toBuffer(), u64LE(input.nonce)],
    input.programId,
  )[0];
  const data = Buffer.concat([
    anchorDiscriminator("global", "grant_reward_once"),
    u64LE(input.nonce),
    u64LE(input.amountMicro),
    i64LE(input.expiresAt),
  ]);
  const grant = new TransactionInstruction({
    programId: input.programId,
    data,
    keys: [
      { pubkey: input.config, isSigner: false, isWritable: true },
      { pubkey: input.epoch, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: input.potatoMint, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: claimPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
    ],
  });
  return [createAta, grant];
}

/** Симуляция + отправка. Возвращает подпись транзакции. */
export async function sendGrant(
  input: GrantInput,
  context: GrantRailContext,
): Promise<string> {
  assertDedicatedRewardSigner(input.signer.publicKey, context.gameConfig, context.payer);
  if (context.gameConfig.paused) throw new Error("REWARD_RAIL: game is paused");

  const ixs = buildGrantInstructions(input, input.signer.publicKey);
  assertRewardInstructionsAllowed(ixs, input.programId);

  const priorityIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    ...ixs,
  ];
  const { blockhash, lastValidBlockHeight } = await input.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: input.signer.publicKey,
    recentBlockhash: blockhash,
    instructions: priorityIxs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([input.signer]);

  const simulation = await input.connection.simulateTransaction(tx, { sigVerify: false });
  if (simulation.value.err) {
    const logs = (simulation.value.logs ?? []).join("\n");
    throw new Error(`REWARD_RAIL: simulation failed: ${JSON.stringify(simulation.value.err)} — ${logs.slice(0, 500)}`);
  }
  const signature = await input.connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
  const confirmation = await input.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err) throw new Error(`REWARD_RAIL: transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
}
