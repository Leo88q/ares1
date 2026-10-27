import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Регрессионный тест на пару (blockhash, lastValidBlockHeight).
 *
 * confirmTransaction трактует lastValidBlockHeight как срок жизни именно
 * переданного blockhash. Баг: высота перечитывалась вторым
 * getLatestBlockhash уже после sendTransaction — пара собиралась из двух
 * разных ответов RPC и подтверждение могло ложно истечь. sendVersionedTx
 * нельзя выполнить в юнит-тесте без живого RPC и ключа плательщика
 * (solana.ts инстанцирует их на импорте), поэтому инвариант закреплён на
 * исходнике: ровно один getLatestBlockhash, деструктурирующий обе
 * величины, и та же пара в confirmTransaction.
 */
const source = fs.readFileSync(fileURLToPath(new URL("../src/solana.ts", import.meta.url)), "utf8");

function functionBody(name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf("\nexport ", start + 10);
  return source.slice(start, next === -1 ? undefined : next);
}

test("sendVersionedTx: blockhash и lastValidBlockHeight — одна пара из одного getLatestBlockhash", () => {
  const body = functionBody("sendVersionedTx");
  const calls = body.match(/getLatestBlockhash\(/g) ?? [];
  assert.equal(calls.length, 1, "ровно один вызов getLatestBlockhash");
  assert.match(
    body,
    /const \{ blockhash, lastValidBlockHeight \} = await connection\.getLatestBlockhash\("confirmed"\)/,
    "обе величины деструктурированы из одного ответа",
  );
  assert.match(
    body,
    /confirmTransaction\(\{ signature: sig, blockhash, lastValidBlockHeight \}, "confirmed"\)/,
    "confirmTransaction получает ту же пару",
  );
  const sendIndex = body.indexOf("sendTransaction(");
  const fetchIndex = body.indexOf("getLatestBlockhash(");
  assert.ok(fetchIndex < sendIndex, "пара получена до отправки, а не после");
});
