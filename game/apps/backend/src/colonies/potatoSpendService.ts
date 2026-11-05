// Квитанции колонийных трат POTATO: проверка транзакции и одна запись на подпись.
//
// Одна подпись засчитывается ровно один раз: повтор с тем же кошельком возвращает
// уже сохранённую квитанцию, а чужой кошелёк на ту же подпись получает отказ.
// Таблица game_ops.colony_potato_spends append-only (миграция 0017).

import type { Pool } from "pg";
import {
  assertSignatureShape,
  assertWalletShape,
  ColonySpendError,
  verifyColonySpendTransaction,
  type ColonySpendReceipt,
  type ParsedTransactionLike,
} from "./potatoSpend.js";

export interface ColonySpendRecordInput {
  signature: string;
  wallet: string;
}

export interface ColonySpendRecordResult {
  receipt: ColonySpendReceipt;
  reused: boolean;
}

export interface ColonySpendChain {
  /** Финализированная транзакция в формате, который понимает verifyColonySpendTransaction; null — не найдена. */
  fetchFinalizedTransaction(signature: string): Promise<ParsedTransactionLike | null>;
  programId(): string;
  potatoMint(): Promise<string>;
}

type ReceiptRow = {
  signature: string;
  owner_wallet: string;
  amount_micro: string;
  purpose: number;
  slot: string;
};

function rowToReceipt(row: ReceiptRow): ColonySpendReceipt {
  return {
    signature: row.signature,
    owner: row.owner_wallet,
    amountMicro: BigInt(row.amount_micro),
    purpose: row.purpose,
    slot: Number(row.slot),
  };
}

export class ColonyPotatoSpendService {
  constructor(
    private readonly pool: Pool,
    private readonly cluster: "devnet" | "mainnet-beta",
    private readonly chain: ColonySpendChain,
  ) {}

  async record(input: ColonySpendRecordInput): Promise<ColonySpendRecordResult> {
    assertSignatureShape(input.signature);
    assertWalletShape(input.wallet);

    const existing = await this.findBySignature(input.signature);
    if (existing) return this.reuse(existing, input.wallet);

    const tx = await this.chain.fetchFinalizedTransaction(input.signature);
    const receipt = verifyColonySpendTransaction(tx, input.signature, {
      programId: this.chain.programId(),
      potatoMint: await this.chain.potatoMint(),
      wallet: input.wallet,
    });

    // ON CONFLICT: гонка двух одинаковых запросов не создаёт двух квитанций.
    const inserted = await this.pool.query<ReceiptRow>(
      `INSERT INTO game_ops.colony_potato_spends
         (signature, owner_wallet, cluster, amount_micro, purpose, slot)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (signature) DO NOTHING
       RETURNING signature, owner_wallet, amount_micro::text, purpose, slot::text`,
      [receipt.signature, receipt.owner, this.cluster, receipt.amountMicro.toString(), receipt.purpose, receipt.slot],
    );
    if (inserted.rows[0]) return { receipt: rowToReceipt(inserted.rows[0]), reused: false };

    const raced = await this.findBySignature(input.signature);
    if (!raced) throw new ColonySpendError("NOT_FINALIZED", "Квитанция не записана, повторите запрос");
    return this.reuse(raced, input.wallet);
  }

  private async findBySignature(signature: string): Promise<ColonySpendReceipt & { wallet: string } | null> {
    const found = await this.pool.query<ReceiptRow>(
      `SELECT signature, owner_wallet, amount_micro::text, purpose, slot::text
         FROM game_ops.colony_potato_spends WHERE signature = $1`,
      [signature],
    );
    const row = found.rows[0];
    return row ? { ...rowToReceipt(row), wallet: row.owner_wallet } : null;
  }

  private reuse(existing: ColonySpendReceipt & { wallet: string }, wallet: string): ColonySpendRecordResult {
    if (existing.wallet !== wallet) {
      throw new ColonySpendError("SIGNATURE_OWNED", "Эта подпись уже засчитана другому кошельку");
    }
    const { wallet: _wallet, ...receipt } = existing;
    return { receipt, reused: true };
  }
}
