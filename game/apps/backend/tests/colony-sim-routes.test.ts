// HTTP-контракт серверной симуляции колонии: сессия, коды ответов, оплата, отсутствие утечек.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import { Keypair } from "@solana/web3.js";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { placementHitsNetwork } from "@ares/colony-engine/colony/networks";
import { findPlacement } from "@ares/colony-engine/colony/layout";
import { CATALOG, type ColonyState } from "@ares/colony-engine/colony/simulation";
import { issueWalletSession } from "../src/colonies/walletAuth.js";
import { colonySimRouter } from "../src/colonySim/routes.js";
import { ColonySimService, type SimDatabase, type SimQueryable } from "../src/colonySim/service.js";

const migrationsDir = fileURLToPath(new URL("../../../migrations/game_ops/", import.meta.url));
const ORIGIN = "https://app.example";
const SECRET = "s".repeat(48);
// Кошельки сессии обязаны быть настоящими 32-байтовыми ключами Solana.
const W1 = Keypair.generate().publicKey.toBase58();
const W2 = Keypair.generate().publicKey.toBase58();
const UUIDS = Array.from({ length: 100 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const sig = (n: number) => "3".repeat(80) + "A".repeat(n) + "B";
const place = (state: ColonyState, kind: "greenhouse") => findPlacement(state.modules, kind, at => placementHitsNetwork(state, kind, at));

async function setup(t: TestContext, spendRequired = false) {
  const db = await PGlite.create();
  for (const file of (await readdir(migrationsDir)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    await db.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  const toQ = (q: { query: PGlite["query"] }): SimQueryable => ({ query: ((text: string, values?: unknown[]) => q.query(text, values)) as SimQueryable["query"] });
  const adapter: SimDatabase = { ...toQ(db), transaction: <T>(fn: (tx: SimQueryable) => Promise<T>) => db.transaction(tx => fn(toQ(tx))) };
  const errors: unknown[] = [];
  const service = new ColonySimService(adapter, { cluster: "devnet", spendRequired });
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/colony-sim", colonySimRouter({
    allowedOrigins: [ORIGIN], allowLocalhostForDevelopment: false, sessionSecret: SECRET, service,
    onInternalError: err => errors.push(err),
  }));
  const server: Server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/colony-sim`;
  const token = (wallet: string) => issueWalletSession({ wallet, origin: ORIGIN, secret: SECRET });
  const call = async (method: string, route: string, wallet: string | null, body?: unknown, origin: string | null = ORIGIN) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (origin) headers.origin = origin;
    if (wallet) headers.authorization = `Bearer ${token(wallet)}`;
    const res = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, any>, text: "" };
  };
  const close = async () => { server.close(); await db.close(); };
  t.after(close);
  return { db, call, errors, base, token };
}

test("без сессии или с чужим origin — 401, без тела состояния", async (t) => {
  const { call } = await setup(t);
  const noAuth = await call("GET", "/state", null);
  assert.deepEqual([noAuth.status, noAuth.json.error], [401, "SESSION_REQUIRED"]);
  const badOrigin = await call("GET", "/state", W1, undefined, "https://evil.example");
  assert.equal(badOrigin.status, 401);
  assert.equal(badOrigin.json.view, undefined);
});

test("GET /state создаёт стартовую колонию; POST /actions принимает действие и отвечает reused на повтор", async (t) => {
  const { call } = await setup(t);
  const state = await call("GET", "/state", W1);
  assert.equal(state.status, 200);
  assert.equal(state.json.view.sequence, 0);
  assert.equal(state.json.view.state.day, 0);

  const body = { requestId: UUIDS[0], expectedSequence: 0, action: { type: "advance", days: 7 } };
  const first = await call("POST", "/actions", W1, body);
  assert.equal(first.status, 200);
  assert.deepEqual([first.json.ok, first.json.reused, first.json.view.sequence], [true, false, 1]);
  const again = await call("POST", "/actions", W1, body);
  assert.deepEqual([again.status, again.json.reused, again.json.view.sequence], [200, true, 1]);
});

test("коды ошибок: 400 на мусор, 409 на устаревший sequence (с состоянием), 422 без эффекта", async (t) => {
  const { call } = await setup(t);
  await call("POST", "/actions", W1, { requestId: UUIDS[1], expectedSequence: 0, action: { type: "advance", days: 1 } });

  const junk = await call("POST", "/actions", W1, { requestId: "x", expectedSequence: 0, action: { type: "advance", days: 1 } });
  assert.deepEqual([junk.status, junk.json.code], [400, "INVALID_REQUEST_ID"]);
  const badAction = await call("POST", "/actions", W1, { requestId: UUIDS[2], expectedSequence: 1, action: { type: "nuke" } });
  assert.deepEqual([badAction.status, badAction.json.code], [400, "INVALID_ACTION"]);
  // Решение владельца: серверный сброс и «что если» отключены (новые действия отклоняются до транзакции).
  const reset = await call("POST", "/actions", W1, { requestId: UUIDS[3], expectedSequence: 1, action: { type: "reset" } });
  assert.deepEqual([reset.status, reset.json.code], [400, "ACTION_DISABLED"]);
  const scenario = await call("POST", "/actions", W1, { requestId: UUIDS[4], expectedSequence: 1, action: { type: "scenario", scenario: { sunHours: 24, waterRecovery: 0.98 } } });
  assert.deepEqual([scenario.status, scenario.json.code], [400, "ACTION_DISABLED"]);
  // Аудит A1: labDraw списывает сток без приёмника, сервер его не принимает.
  const labDraw = await call("POST", "/actions", W1, { requestId: UUIDS[5], expectedSequence: 1, action: { type: "labDraw", resource: "water", kg: 5 } });
  assert.deepEqual([labDraw.status, labDraw.json.code], [400, "ACTION_DISABLED"]);
  // A5: уборка без учёта глубокого мира отключена; новые записи идут через harvestBedV2.
  const oldHarvest = await call("POST", "/actions", W1, { requestId: UUIDS[5], expectedSequence: 1, action: { type: "harvestBed", moduleId: "greenhouse-1", index: 0 } });
  assert.deepEqual([oldHarvest.status, oldHarvest.json.code], [400, "ACTION_DISABLED"]);
  const notObject = await call("POST", "/actions", W1, [1, 2, 3]);
  assert.deepEqual([notObject.status, notObject.json.code], [400, "INVALID_REQUEST"]);

  const stale = await call("POST", "/actions", W1, { requestId: UUIDS[3], expectedSequence: 0, action: { type: "advance", days: 1 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "STALE_SEQUENCE");
  assert.equal(stale.json.view.sequence, 1, "при 409 клиент получает актуальное состояние");

  const noEffect = await call("POST", "/actions", W1, { requestId: UUIDS[4], expectedSequence: 1, action: { type: "move", moduleId: "nope", at: { x: 1, z: 1, rotation: 0 } } });
  assert.deepEqual([noEffect.status, noEffect.json.code], [422, "NO_EFFECT"]);
});

test("оплата: стройка без квитанции — 402; с квитанцией — 200 и потребление", async (t) => {
  const { db, call } = await setup(t, true);
  await call("POST", "/actions", W1, { requestId: UUIDS[5], expectedSequence: 0, action: { type: "advance", days: 1 } });
  const state = (await call("GET", "/state", W1)).json.view.state as ColonyState;
  const at = place(state, "greenhouse")!;
  const build = { type: "build", kind: "greenhouse", at };

  const none = await call("POST", "/actions", W1, { requestId: UUIDS[6], expectedSequence: 1, action: build });
  assert.deepEqual([none.status, none.json.code], [402, "RECEIPT_REQUIRED"]);

  await db.query(
    `INSERT INTO game_ops.colony_potato_spends (signature, owner_wallet, cluster, amount_micro, purpose, slot) VALUES ($1, $2, 'devnet', $3, 1, 100)`,
    [sig(1), W1, String(CATALOG.greenhouse.credits * 1_000_000)],
  );
  const paid = await call("POST", "/actions", W1, { requestId: UUIDS[7], expectedSequence: 1, action: build, spendSignature: sig(1) });
  assert.deepEqual([paid.status, paid.json.view?.sequence], [200, 2]);
  // Новое место: старое уже занято первой стройкой и отсеялось бы как NO_EFFECT до проверки квитанции.
  const at2 = place((await call("GET", "/state", W1)).json.view.state as ColonyState, "greenhouse")!;
  const reused = await call("POST", "/actions", W1, { requestId: UUIDS[8], expectedSequence: 2, action: { type: "build", kind: "greenhouse", at: at2 }, spendSignature: sig(1) });
  assert.deepEqual([reused.status, reused.json.code], [409, "RECEIPT_USED"]);
});

test("изоляция: квитанция и сессия одного кошелька не работают для другого", async (t) => {
  const { db, call } = await setup(t, true);
  await db.query(
    `INSERT INTO game_ops.colony_potato_spends (signature, owner_wallet, cluster, amount_micro, purpose, slot) VALUES ($1, $2, 'devnet', $3, 1, 100)`,
    [sig(2), W2, String(CATALOG.greenhouse.credits * 1_000_000)],
  );
  await call("POST", "/actions", W1, { requestId: UUIDS[9], expectedSequence: 0, action: { type: "advance", days: 1 } });
  const state = (await call("GET", "/state", W1)).json.view.state as ColonyState;
  const at = place(state, "greenhouse")!;
  const stolen = await call("POST", "/actions", W1, { requestId: UUIDS[10], expectedSequence: 1, action: { type: "build", kind: "greenhouse", at }, spendSignature: sig(2) });
  assert.deepEqual([stolen.status, stolen.json.code], [422, "RECEIPT_MISMATCH"]);
  assert.equal((await call("GET", "/state", W2)).json.view.sequence, 0);
});

test("повреждённый журнал/снимок: 503 без внутренних деталей в ответе", async (t) => {
  const { db, call, errors } = await setup(t);
  await call("POST", "/actions", W1, { requestId: UUIDS[11], expectedSequence: 0, action: { type: "advance", days: 2 } });
  await db.query("UPDATE game_ops.colony_sim_sessions SET state_hash = $2 WHERE owner_wallet = $1", [W1, "b".repeat(64)]);
  const res = await call("GET", "/state", W1);
  assert.equal(res.status, 503);
  assert.equal(res.json.code, "REPLAY_HASH_MISMATCH");
  assert.equal(res.json.stack, undefined);
  assert.equal(errors.length, 0, "ожидаемый отказ не считается внутренней ошибкой");
});

test("gzip: при Accept-Encoding gzip тело сжато и декодируется в тот же JSON; без него — обычный ответ", async (t) => {
  const { base, token } = await setup(t);
  const auth = { authorization: `Bearer ${token(W1)}`, origin: ORIGIN };
  const zipped = await fetch(base + "/state", { headers: { ...auth, "accept-encoding": "gzip" } });
  assert.equal(zipped.status, 200);
  assert.equal(zipped.headers.get("content-encoding"), "gzip");
  assert.match(zipped.headers.get("vary") ?? "", /Accept-Encoding/i);
  const plain = await fetch(base + "/state", { headers: { ...auth, "accept-encoding": "identity" } });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get("content-encoding"), null);
  // fetch сам распаковывает gzip: тела должны совпадать по содержимому.
  const a = (await zipped.json()) as { ok: boolean; view: { stateHash: string; sequence: number } };
  const b = (await plain.json()) as typeof a;
  assert.deepEqual(a, b);
  assert.equal(a.ok, true);
});

test("gzip: ответ 401 без сессии тоже сжимается и остаётся JSON-ошибкой", async (t) => {
  const { base } = await setup(t);
  const res = await fetch(base + "/state", { headers: { origin: ORIGIN, "accept-encoding": "gzip" } });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal(((await res.json()) as { error: string }).error, "SESSION_REQUIRED");
});
