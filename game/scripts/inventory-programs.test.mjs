import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { execFile } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, "inventory-programs.mjs");

// ── base58 (та же реализация, что в скрипте — адреса фикстур должны сходиться) ──
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf) {
  let digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of buf) {
    if (byte === 0) out += "1";
    else break;
  }
  return out + digits.reverse().map((d) => B58_ALPHABET[d]).join("");
}

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const PROG_ID = b58(Buffer.from("7d".repeat(32), "hex"));
const PD_KEY = Buffer.from("01".repeat(32), "hex");
const AUTH_KEY = Buffer.from("ab".repeat(32), "hex"); // «devnet-деплойер»
const OTHER_KEY = Buffer.from("cd".repeat(32), "hex");
const AUTH_ADDR = b58(AUTH_KEY);
const OTHER_ADDR = b58(OTHER_KEY);

function programAccount(lamports = 1_000_000) {
  const data = Buffer.concat([Buffer.from([0x04, 0x00, 0x00, 0x00]), PD_KEY]);
  return { owner: LOADER, lamports, data: [data.toString("base64"), "base64"] };
}

// ProgramData layout: 4-байт тег + 8-байт slot + Option<Pubkey> (1 + 32).
function programDataAccount({ authority = AUTH_KEY, lamports = 2_000_000, slot = 42 } = {}) {
  const data = Buffer.alloc(45);
  data.writeUInt32LE(0x05, 0);
  data.writeBigUInt64LE(BigInt(slot), 4);
  if (authority) {
    data[12] = 1;
    authority.copy(data, 13);
  } else {
    data[12] = 0;
  }
  return { owner: LOADER, lamports, data: [data.toString("base64"), "base64"] };
}

function startRpc(accounts) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const msg = JSON.parse(body);
        let result = null;
        if (msg.method === "getAccountInfo") {
          const acc = accounts[msg.params[0]];
          result = { context: { slot: 1 }, value: acc ?? null };
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      });
    });
    srv.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () => new Promise((r) => srv.close(r)),
      }),
    );
  });
}

let fixtureSeq = 0;
function writeFixture(programs) {
  const file = path.join(os.tmpdir(), `inventory-programs-test-${process.pid}-${fixtureSeq++}.json`);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, network: "devnet", programs }, null, 2));
  return file;
}

function runCli({ url, fixture }) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [CLI, "--json"],
      { env: { ...process.env, RPC_URL: url, INVENTORY_PATH: fixture } },
      (err, stdout, stderr) => {
        let parsed = null;
        try {
          parsed = JSON.parse(stdout);
        } catch {}
        resolve({ code: err ? err.code : 0, parsed, stderr });
      },
    );
  });
}

const mutableProgramChain = {
  [PROG_ID]: programAccount(),
  [b58(PD_KEY)]: programDataAccount(),
};

test("active mutable program without expected authority: WARNING, not a violation (issue #55)", async () => {
  const rpc = await startRpc(mutableProgramChain);
  const fixture = writeFixture([
    { id: PROG_ID, role: "t", status: "active", expectedUpgradeAuthority: null, drainRequired: true },
  ]);
  try {
    const { code, parsed } = await runCli({ url: rpc.url, fixture });
    assert.equal(code, 0, `expected exit 0, got ${code}: ${JSON.stringify(parsed)}`);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.violations.length, 0);
    assert.equal(parsed.warnings.length, 1);
    assert.match(parsed.warnings[0], /expectedUpgradeAuthority не задан/);
    // Доказательство в предупреждении: фактический authority с цепи.
    assert.match(parsed.warnings[0], new RegExp(AUTH_ADDR));
  } finally {
    await rpc.close();
    fs.unlinkSync(fixture);
  }
});

test("active mutable program with matching expected authority: clean", async () => {
  const rpc = await startRpc(mutableProgramChain);
  const fixture = writeFixture([
    { id: PROG_ID, role: "t", status: "active", expectedUpgradeAuthority: AUTH_ADDR, drainRequired: true },
  ]);
  try {
    const { code, parsed } = await runCli({ url: rpc.url, fixture });
    assert.equal(code, 0, `expected exit 0, got ${code}: ${JSON.stringify(parsed)}`);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.violations.length, 0);
    assert.equal(parsed.warnings.length, 0);
  } finally {
    await rpc.close();
    fs.unlinkSync(fixture);
  }
});

test("active program with authority != expected: still a VIOLATION (hijack detection, item 102)", async () => {
  const rpc = await startRpc(mutableProgramChain);
  const fixture = writeFixture([
    { id: PROG_ID, role: "t", status: "active", expectedUpgradeAuthority: OTHER_ADDR, drainRequired: true },
  ]);
  try {
    const { code, parsed } = await runCli({ url: rpc.url, fixture });
    assert.equal(code, 1);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.violations.some((v) => v.includes("≠ ожидаемой")), JSON.stringify(parsed.violations));
  } finally {
    await rpc.close();
    fs.unlinkSync(fixture);
  }
});

test("deprecated mutable program: still a violation (must be finalized)", async () => {
  const rpc = await startRpc(mutableProgramChain);
  const fixture = writeFixture([
    { id: PROG_ID, role: "t", status: "deprecated", expectedUpgradeAuthority: null, drainRequired: true },
  ]);
  try {
    const { code, parsed } = await runCli({ url: rpc.url, fixture });
    assert.equal(code, 1);
    assert.ok(
      parsed.violations.some((v) => v.includes("всё ещё mutable") && v.includes("--final")),
      JSON.stringify(parsed.violations),
    );
  } finally {
    await rpc.close();
    fs.unlinkSync(fixture);
  }
});

test("retired program still holding lamports: still a violation (drain, item 98)", async () => {
  const rpc = await startRpc(mutableProgramChain);
  const fixture = writeFixture([
    { id: PROG_ID, role: "t", status: "retired", expectedUpgradeAuthority: null, drainRequired: true },
  ]);
  try {
    const { code, parsed } = await runCli({ url: rpc.url, fixture });
    assert.equal(code, 1);
    assert.ok(parsed.violations.some((v) => v.includes("осушить")), JSON.stringify(parsed.violations));
  } finally {
    await rpc.close();
    fs.unlinkSync(fixture);
  }
});

test("retired program absent from chain: ok", async () => {
  const rpc = await startRpc({});
  const fixture = writeFixture([
    { id: PROG_ID, role: "t", status: "retired", expectedUpgradeAuthority: null, drainRequired: true },
  ]);
  try {
    const { code, parsed } = await runCli({ url: rpc.url, fixture });
    assert.equal(code, 0);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.violations.length, 0);
  } finally {
    await rpc.close();
    fs.unlinkSync(fixture);
  }
});
