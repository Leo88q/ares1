import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  base58Decode,
  COLONY_SPEND_DISCRIMINATOR,
  ColonySpendError,
  decodeColonySpendData,
  verifyColonySpendTransaction,
  type ParsedTransactionLike,
} from "../src/colonies/potatoSpend.js";
import { ColonyPotatoSpendService } from "../src/colonies/potatoSpendService.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = value * 256n + BigInt(b);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

const PROGRAM = base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const MINT = base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 50));
const WALLET = base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 90));
const OTHER = base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 130));
const USER_ATA = base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 170));
const CONFIG = base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 10));
const TOKEN_PROGRAM = base58Encode(Uint8Array.from({ length: 32 }, (_, i) => i + 210));
const SIGNATURE = base58Encode(Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) % 256));
const SIGNATURE_B = base58Encode(Uint8Array.from({ length: 64 }, (_, i) => (i * 11 + 5) % 256));

function spendData(amountMicro: bigint, purpose: number): Uint8Array {
  const out = new Uint8Array(17);
  out.set(COLONY_SPEND_DISCRIMINATOR, 0);
  new DataView(out.buffer).setBigUint64(8, amountMicro, true);
  out[16] = purpose;
  return out;
}

function encodedSpend(amountMicro: bigint, purpose: number): string {
  return base58Encode(spendData(amountMicro, purpose));
}

const AMOUNT = 250_000_000n; // 250 POTATO

function goodTx(overrides: Partial<ParsedTransactionLike> & { amount?: bigint; purpose?: number; postAmount?: string } = {}): ParsedTransactionLike {
  const amount = overrides.amount ?? AMOUNT;
  const purpose = overrides.purpose ?? 1;
  const accountKeys = [
    { pubkey: MINT, signer: false },
    { pubkey: USER_ATA, signer: false },
    { pubkey: CONFIG, signer: false },
    { pubkey: WALLET, signer: true },
    { pubkey: TOKEN_PROGRAM, signer: false },
  ];
  const ix = { programId: PROGRAM, accounts: [MINT, USER_ATA, CONFIG, WALLET, TOKEN_PROGRAM], data: encodedSpend(amount, purpose) };
  const before = 1_000_000_000n;
  return {
    slot: 424242,
    meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 1, mint: MINT, owner: WALLET, uiTokenAmount: { amount: before.toString() } }],
      postTokenBalances: [{ accountIndex: 1, mint: MINT, owner: WALLET, uiTokenAmount: { amount: (overrides.postAmount ?? (before - amount).toString()) } }],
    },
    transaction: { message: { accountKeys, instructions: [ix] } },
    ...(overrides.transaction ? { transaction: overrides.transaction } : {}),
  };
}

const EXPECT = { programId: PROGRAM, potatoMint: MINT, wallet: WALLET };

test("base58 decodes the same bytes it encodes, including leading zeros", () => {
  const bytes = Uint8Array.from([0, 0, 1, 2, 250, 255]);
  assert.deepEqual(Array.from(base58Decode(base58Encode(bytes))), Array.from(bytes));
  assert.throws(() => base58Decode("0OIl"), /invalid base58/);
});

test("colony_spend data decodes amount and purpose; other data is rejected", () => {
  assert.deepEqual(decodeColonySpendData(spendData(AMOUNT, 2)), { amountMicro: AMOUNT, purpose: 2 });
  const wrongDiscriminator = spendData(AMOUNT, 2);
  wrongDiscriminator[0] ^= 0xff;
  assert.equal(decodeColonySpendData(wrongDiscriminator), null);
  assert.equal(decodeColonySpendData(new Uint8Array(16)), null);
  // Дискриминатор должен быть именно sha256("global:colony_spend"), а не случайный набор байт.
  const expected = createHash("sha256").update("global:colony_spend").digest().subarray(0, 8);
  assert.deepEqual(Array.from(COLONY_SPEND_DISCRIMINATOR), Array.from(expected));
});

test("an honest burn of the declared amount is accepted and returns a receipt", () => {
  const receipt = verifyColonySpendTransaction(goodTx(), SIGNATURE, EXPECT);
  assert.deepEqual(receipt, { signature: SIGNATURE, owner: WALLET, amountMicro: AMOUNT, purpose: 1, slot: 424242 });
});

function expectCode(run: () => unknown, code: string): void {
  assert.throws(run, (error: unknown) => error instanceof ColonySpendError && error.code === code, `expected ${code}`);
}

test("missing or unfinalized transaction is NOT_FINALIZED", () => {
  expectCode(() => verifyColonySpendTransaction(null, SIGNATURE, EXPECT), "NOT_FINALIZED");
});

test("failed transaction is rejected even if the instruction is present", () => {
  const tx = goodTx();
  tx.meta = { ...tx.meta!, err: { InstructionError: [0, { Custom: 1 }] } };
  expectCode(() => verifyColonySpendTransaction(tx, SIGNATURE, EXPECT), "TX_FAILED");
});

test("a transaction without colony_spend from this program is NOT_COLONY_SPEND", () => {
  const tx = goodTx();
  tx.transaction.message.instructions = [{ programId: OTHER, accounts: [MINT], data: encodedSpend(AMOUNT, 1) }];
  expectCode(() => verifyColonySpendTransaction(tx, SIGNATURE, EXPECT), "NOT_COLONY_SPEND");
});

test("two colony_spend instructions in one transaction are ambiguous and count for nothing", () => {
  const tx = goodTx();
  const ix = tx.transaction.message.instructions[0];
  tx.transaction.message.instructions = [ix, { ...ix }];
  expectCode(() => verifyColonySpendTransaction(tx, SIGNATURE, EXPECT), "AMBIGUOUS_INSTRUCTION");
});

test("a burn from a different mint is rejected", () => {
  const tx = goodTx();
  tx.transaction.message.instructions[0].accounts[0] = OTHER;
  expectCode(() => verifyColonySpendTransaction(tx, SIGNATURE, EXPECT), "MINT_MISMATCH");
});

test("a spend paid by another wallet is rejected", () => {
  const tx = goodTx();
  tx.transaction.message.instructions[0].accounts[3] = OTHER;
  expectCode(() => verifyColonySpendTransaction(tx, SIGNATURE, EXPECT), "OWNER_MISMATCH");
});

test("the owner must actually sign the transaction", () => {
  const tx = goodTx();
  tx.transaction.message.accountKeys[3].signer = false;
  expectCode(() => verifyColonySpendTransaction(tx, SIGNATURE, EXPECT), "OWNER_NOT_SIGNER");
});

test("the balance must drop by exactly the declared amount", () => {
  // Заявлено 250 POTATO, на самом деле сожжено 100: квитанции быть не должно.
  const tx = goodTx({ postAmount: (1_000_000_000n - 100_000_000n).toString() });
  expectCode(() => verifyColonySpendTransaction(tx, SIGNATURE, EXPECT), "BURN_MISMATCH");
});

test("amount and purpose are bounded by the on-chain rules", () => {
  expectCode(() => verifyColonySpendTransaction(goodTx({ amount: 0n }), SIGNATURE, EXPECT), "INVALID_ARGUMENTS");
  expectCode(() => verifyColonySpendTransaction(goodTx({ amount: 10_000_000_001n }), SIGNATURE, EXPECT), "INVALID_ARGUMENTS");
  expectCode(() => verifyColonySpendTransaction(goodTx({ purpose: 4 }), SIGNATURE, EXPECT), "INVALID_ARGUMENTS");
  expectCode(() => verifyColonySpendTransaction(goodTx({ purpose: 0 }), SIGNATURE, EXPECT), "INVALID_ARGUMENTS");
});

test("wrong account count is MALFORMED_ACCOUNTS", () => {
  const tx = goodTx();
  tx.transaction.message.instructions[0].accounts = [MINT, USER_ATA, CONFIG, WALLET];
  expectCode(() => verifyColonySpendTransaction(tx, SIGNATURE, EXPECT), "MALFORMED_ACCOUNTS");
});

// ── Сервис записи: фейковый пул с одной таблицей в памяти ──

type Row = { signature: string; owner_wallet: string; amount_micro: string; purpose: number; slot: string };

function fakePool(rows: Row[] = []) {
  const calls: string[] = [];
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      calls.push(sql.trim().split(/\s+/)[0]);
      if (sql.includes("SELECT signature")) {
        const found = rows.filter(r => r.signature === params[0]);
        return { rows: found };
      }
      if (sql.includes("INSERT INTO game_ops.colony_potato_spends")) {
        const row: Row = { signature: String(params[0]), owner_wallet: String(params[1]), amount_micro: String(params[3]), purpose: Number(params[4]), slot: String(params[5]) };
        if (rows.some(r => r.signature === row.signature)) return { rows: [] };
        rows.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return { pool, calls, rows };
}

function service(pool: ReturnType<typeof fakePool>["pool"], tx: ParsedTransactionLike | null) {
  return new ColonyPotatoSpendService(pool as never, "devnet", {
    fetchFinalizedTransaction: async () => tx,
    programId: () => PROGRAM,
    potatoMint: async () => MINT,
  });
}

test("a verified spend is recorded once; repeat with the same wallet returns the same receipt", async () => {
  const store = fakePool();
  const svc = service(store.pool, goodTx());
  const first = await svc.record({ signature: SIGNATURE, wallet: WALLET });
  assert.equal(first.reused, false);
  assert.equal(first.receipt.amountMicro, AMOUNT);
  assert.equal(store.rows.length, 1);

  const second = await svc.record({ signature: SIGNATURE, wallet: WALLET });
  assert.equal(second.reused, true);
  assert.equal(store.rows.length, 1, "repeat must not create a second receipt");
});

test("another wallet cannot claim an already recorded signature", async () => {
  const store = fakePool();
  await service(store.pool, goodTx()).record({ signature: SIGNATURE, wallet: WALLET });
  await assert.rejects(
    service(store.pool, goodTx()).record({ signature: SIGNATURE, wallet: OTHER }),
    (error: unknown) => error instanceof ColonySpendError && error.code === "SIGNATURE_OWNED",
  );
});

test("unfinalized transactions are not recorded", async () => {
  const store = fakePool();
  await assert.rejects(
    service(store.pool, null).record({ signature: SIGNATURE_B, wallet: WALLET }),
    (error: unknown) => error instanceof ColonySpendError && error.code === "NOT_FINALIZED",
  );
  assert.equal(store.rows.length, 0);
});

test("malformed signature and wallet are rejected before any RPC or DB work", async () => {
  const store = fakePool();
  await assert.rejects(service(store.pool, goodTx()).record({ signature: "abc", wallet: WALLET }), (e: unknown) => e instanceof ColonySpendError && e.code === "INVALID_SIGNATURE");
  await assert.rejects(service(store.pool, goodTx()).record({ signature: SIGNATURE, wallet: "short" }), (e: unknown) => e instanceof ColonySpendError && e.code === "INVALID_WALLET");
  assert.equal(store.calls.length, 0);
});
