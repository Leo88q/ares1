// Загрузка финализированной транзакции для проверки колонийной траты.
// Переводит ответ web3.js в минимальную форму из potatoSpend.ts (строки вместо PublicKey).

import type { Connection } from "@solana/web3.js";
import type { ParsedTransactionLike, TokenBalance } from "./potatoSpend.js";

export async function parseTransactionForSpend(connection: Connection, signature: string): Promise<ParsedTransactionLike | null> {
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) return null;

  const toBalances = (list: ReadonlyArray<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }> | null | undefined): TokenBalance[] =>
    (list ?? []).map(entry => ({
      accountIndex: entry.accountIndex,
      mint: entry.mint,
      owner: entry.owner,
      uiTokenAmount: { amount: entry.uiTokenAmount.amount },
    }));

  return {
    slot: tx.slot,
    meta: tx.meta
      ? {
          err: tx.meta.err,
          preTokenBalances: toBalances(tx.meta.preTokenBalances),
          postTokenBalances: toBalances(tx.meta.postTokenBalances),
        }
      : null,
    transaction: {
      message: {
        accountKeys: tx.transaction.message.accountKeys.map(key => ({ pubkey: key.pubkey.toBase58(), signer: key.signer })),
        instructions: tx.transaction.message.instructions.map(ix => {
          if ("data" in ix) {
            return { programId: ix.programId.toBase58(), accounts: ix.accounts.map(a => a.toBase58()), data: ix.data };
          }
          return { programId: ix.programId.toBase58(), program: ix.program, parsed: ix.parsed };
        }),
      },
    },
  };
}
