// Серверная симуляция колонии: сеанс, журнал, идемпотентность, оплата квитанцией colony_spend.
// БД — PGlite с реальными миграциями game_ops (как tests/db). Тесты не ходят в сеть.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CATALOG } from "@ares/colony-engine/colony/simulation";
import { findPlacement } from "@ares/colony-engine/colony/layout";
import { placementHitsNetwork } from "@ares/colony-engine/colony/networks";
import type { ColonyState, ModuleKind } from "@ares/colony-engine/colony/simulation";

// Как в клиенте (ColonyScreen): место не должно пересекать сеть.
const place = (state: ColonyState, kind: ModuleKind) => findPlacement(state.modules, kind, at => placementHitsNetwork(state, kind, at));
import { ColonySimService, type SimDatabase, type SimQueryable } from "../src/colonySim/service.js";

const migrationsDir = fileURLToPath(new URL("../../../migrations/game_ops/", import.meta.url));
const W1 = "W".repeat(40);
const W2 = "V".repeat(40);
const sig = (n: number) => "3".repeat(80) + "A".repeat(n) + "B";
const UUIDS = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);

async function openDb(): Promise<{ db: PGlite; adapter: SimDatabase }> {
  const db = await PGlite.create();
  for (const file of (await readdir(migrationsDir)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    await db.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  const toQ = (q: { query: PGlite["query"] }): SimQueryable => ({ query: ((text: string, values?: unknown[]) => q.query(text, values)) as SimQueryable["query"] });
  const adapter: SimDatabase = {
    ...toQ(db),
    transaction: <T>(fn: (tx: SimQueryable) => Promise<T>) => db.transaction(tx => fn(toQ(tx))),
  };
  return { db, adapter };
}

async function receipt(db: PGlite, signature: string, wallet: string, cr: number, purpose: number, cluster = "devnet") {
  await db.query(
    `INSERT INTO game_ops.colony_potato_spends (signature, owner_wallet, cluster, amount_micro, purpose, slot) VALUES ($1, $2, $3, $4, $5, 100)`,
    [signature, wallet, cluster, String(cr * 1_000_000), purpose],
  );
}

test("get создаёт стартовую колонию, advance пишет журнал, повтор requestId не применяет дважды", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false });
  const v0 = await svc.get(W1);
  assert.equal(v0.sequence, 0);
  assert.equal(v0.state.day, 0);

  const a = await svc.act({ wallet: W1, requestId: UUIDS[0]!, expectedSequence: 0, action: { type: "advance", days: 7 } });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  assert.equal(a.reused, false);
  assert.equal(a.view.sequence, 1);
  assert.equal(a.view.state.day, 7);

  const again = await svc.act({ wallet: W1, requestId: UUIDS[0]!, expectedSequence: 0, action: { type: "advance", days: 7 } });
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.equal(again.reused, true);
    assert.equal(again.view.sequence, 1, "повтор не должен двигать время");
  }
  const journal = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM game_ops.colony_sim_actions WHERE owner_wallet = $1", [W1]);
  assert.equal(journal.rows[0]?.n, 1);
  await db.close();
});

test("тот же requestId с другим действием — 409 REQUEST_CONFLICT", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false });
  await svc.act({ wallet: W1, requestId: UUIDS[1]!, expectedSequence: 0, action: { type: "advance", days: 1 } });
  const r = await svc.act({ wallet: W1, requestId: UUIDS[1]!, expectedSequence: 0, action: { type: "advance", days: 2 } });
  assert.deepEqual([r.ok, r.ok ? "" : r.code], [false, "REQUEST_CONFLICT"]);
  await db.close();
});

test("устаревший expectedSequence — 409 STALE_SEQUENCE с актуальным состоянием", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false });
  await svc.act({ wallet: W1, requestId: UUIDS[2]!, expectedSequence: 0, action: { type: "advance", days: 1 } });
  const r = await svc.act({ wallet: W1, requestId: UUIDS[3]!, expectedSequence: 0, action: { type: "advance", days: 1 } });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "STALE_SEQUENCE");
    assert.equal(r.status, 409);
    assert.equal(r.view?.sequence, 1);
  }
  await db.close();
});

test("NO_EFFECT: действие без эффекта отклоняется и не пишет журнал", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false });
  const r = await svc.act({ wallet: W1, requestId: UUIDS[4]!, expectedSequence: 0, action: { type: "move", moduleId: "nope", at: { x: 1, z: 1, rotation: 0 } } });
  assert.deepEqual([r.ok, r.ok ? "" : r.code, r.ok ? 0 : r.status], [false, "NO_EFFECT", 422]);
  const v = await svc.get(W1);
  assert.equal(v.sequence, 0);
  await db.close();
});

test("некорректный ввод: 400, состояние не меняется", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false });
  const bad = [
    await svc.act({ wallet: W1, requestId: "not-a-uuid", expectedSequence: 0, action: { type: "repair" } }),
    await svc.act({ wallet: W1, requestId: UUIDS[5]!, expectedSequence: -1, action: { type: "repair" } }),
    await svc.act({ wallet: W1, requestId: UUIDS[5]!, expectedSequence: 0, action: { type: "advance", days: 99 } }),
    await svc.act({ wallet: W1, requestId: UUIDS[5]!, expectedSequence: 0, action: { type: "repair" }, spendSignature: "short" }),
  ];
  for (const r of bad) assert.deepEqual([r.ok, r.ok ? 0 : r.status], [false, 400]);
  await db.close();
});

test("оплата: без квитанции стройка — 402; квитанция списывается один раз", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: true });
  await svc.act({ wallet: W1, requestId: UUIDS[6]!, expectedSequence: 0, action: { type: "advance", days: 1 } });
  const view = await svc.get(W1);
  const kind = "greenhouse" as const;
  const at = place(view.state, kind);
  assert.ok(at, "должно найтись место под теплицу");
  const build = { type: "build", kind, at };
  const cost = CATALOG[kind].credits;

  const noReceipt = await svc.act({ wallet: W1, requestId: UUIDS[7]!, expectedSequence: 1, action: build });
  assert.deepEqual([noReceipt.ok, noReceipt.ok ? "" : noReceipt.code], [false, "RECEIPT_REQUIRED"]);

  await receipt(db, sig(1), W1, cost, 1);
  const paid = await svc.act({ wallet: W1, requestId: UUIDS[8]!, expectedSequence: 1, action: build, spendSignature: sig(1) });
  assert.equal(paid.ok, true);
  if (paid.ok) assert.equal(paid.view.sequence, 2);

  // Та же квитанция на второе действие: RECEIPT_USED, и вторая стройка не применяется.
  const at2 = place((await svc.get(W1)).state, kind);
  const reuse = await svc.act({ wallet: W1, requestId: UUIDS[9]!, expectedSequence: 2, action: { type: "build", kind, at: at2 }, spendSignature: sig(1) });
  assert.deepEqual([reuse.ok, reuse.ok ? "" : reuse.code], [false, "RECEIPT_USED"]);
  assert.equal((await svc.get(W1)).sequence, 2);
  await db.close();
});

test("оплата: чужой кошелёк, другое назначение, другая сумма и кластер — 422 RECEIPT_MISMATCH", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: true });
  await svc.act({ wallet: W1, requestId: UUIDS[10]!, expectedSequence: 0, action: { type: "advance", days: 1 } });
  const at = place((await svc.get(W1)).state, "greenhouse")!;
  const cost = CATALOG.greenhouse.credits;
  const build = { type: "build", kind: "greenhouse", at };

  await receipt(db, sig(2), W2, cost, 1); // чужой кошелёк
  await receipt(db, sig(3), W1, cost, 2); // ремонт вместо стройки
  await receipt(db, sig(4), W1, cost + 1, 1); // сумма не та
  await receipt(db, sig(5), W1, cost, 1, "mainnet-beta"); // другой кластер
  for (const [n, s] of [[11, sig(2)], [12, sig(3)], [13, sig(4)], [14, sig(5)]] as const) {
    const r = await svc.act({ wallet: W1, requestId: UUIDS[n]!, expectedSequence: 1, action: build, spendSignature: s });
    assert.deepEqual([r.ok, r.ok ? "" : r.code], [false, "RECEIPT_MISMATCH"], `квитанция ${s.slice(-3)}`);
  }
  assert.equal((await svc.get(W1)).sequence, 1);
  await db.close();
});

test("оплата: подписи нет в журнале квитанций — 422 RECEIPT_NOT_FOUND", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: true });
  await svc.act({ wallet: W1, requestId: UUIDS[15]!, expectedSequence: 0, action: { type: "advance", days: 1 } });
  const at = place((await svc.get(W1)).state, "greenhouse")!;
  const r = await svc.act({ wallet: W1, requestId: UUIDS[16]!, expectedSequence: 1, action: { type: "build", kind: "greenhouse", at }, spendSignature: sig(9) });
  assert.deepEqual([r.ok, r.ok ? "" : r.code], [false, "RECEIPT_NOT_FOUND"]);
  await db.close();
});

test("снимок и журнал: новый сервис восстанавливает тот же сеанс побайтно", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false, snapshotEvery: 3 });
  let seq = 0;
  const steps: unknown[] = [
    { type: "advance", days: 7 }, { type: "supplies" }, { type: "advance", days: 7 }, { type: "deliver" },
    { type: "advance", days: 7 }, { type: "repair" }, { type: "advance", days: 7 },
  ];
  for (const action of steps) {
    const r = await svc.act({ wallet: W1, requestId: UUIDS[20 + seq]!, expectedSequence: seq, action });
    if (r.ok) seq = r.view.sequence;
  }
  const row = await db.query<{ snapshot_sequence: number; sequence: number }>(
    "SELECT snapshot_sequence::int, sequence::int FROM game_ops.colony_sim_sessions WHERE owner_wallet = $1", [W1]);
  assert.ok(row.rows[0]!.snapshot_sequence > 0, "снимок должен обновляться");
  const before = await svc.get(W1);
  const fresh = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false, snapshotEvery: 3 });
  const after = await fresh.get(W1);
  assert.equal(after.stateHash, before.stateHash);
  assert.equal(after.sequence, seq);
  await db.close();
});

test("подмена хеша в сеансе ловится при загрузке: 503 REPLAY_HASH_MISMATCH", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false });
  await svc.act({ wallet: W1, requestId: UUIDS[40]!, expectedSequence: 0, action: { type: "advance", days: 2 } });
  await db.query("UPDATE game_ops.colony_sim_sessions SET state_hash = $2 WHERE owner_wallet = $1", [W1, "a".repeat(64)]);
  await assert.rejects(svc.get(W1), (e: unknown) => (e as { code?: string }).code === "REPLAY_HASH_MISMATCH");
  await db.close();
});

test("журнал append-only: UPDATE и DELETE запрещены триггерами", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false });
  await svc.act({ wallet: W1, requestId: UUIDS[41]!, expectedSequence: 0, action: { type: "advance", days: 1 } });
  await assert.rejects(db.query("UPDATE game_ops.colony_sim_actions SET cluster = 'devnet' WHERE owner_wallet = $1", [W1]));
  await assert.rejects(db.query("DELETE FROM game_ops.colony_sim_actions WHERE owner_wallet = $1", [W1]));
  await db.close();
});

test("кошельки изолированы: сеанс одного не виден другому", async () => {
  const { db, adapter } = await openDb();
  const svc = new ColonySimService(adapter, { cluster: "devnet", spendRequired: false });
  await svc.act({ wallet: W1, requestId: UUIDS[42]!, expectedSequence: 0, action: { type: "advance", days: 5 } });
  assert.equal((await svc.get(W2)).state.day, 0);
  assert.equal((await svc.get(W1)).state.day, 5);
  await db.close();
});
