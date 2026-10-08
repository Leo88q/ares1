#!/usr/bin/env node
/**
 * Инвентаризация ончейн-программ проекта — чек-лист п. 98 (аудит 2026-09-28).
 *
 * Прецеденты 2026 года: Raydium Legacy AMM V3 ($1.34M из пяти спящих пулов),
 * Aztec Connect / Private Rollup (2 × $2.1M из устаревших мостов), Thetanuts
 * (устаревшее хранилище). Chainalysis: ≥ $36.7M за полгода ушло из протоколов
 * с неверифицированными контрактами, и ИИ-агенты сделали повторный аудит
 * старого кода дешёвым — «забытая» программа это не мусор, а открытая дверь.
 *
 * Скрипт читает game/program-inventory.json, для каждой программы:
 *   1. проверяет, что аккаунт существует (если не должен быть retired);
 *   2. вычисляет programData-адрес (offset 4..36 аккаунта программы);
 *   3. читает слот апгрейда и upgrade authority из programData (offset 13..45,
 *      Option<Pubkey> после 4-байт тега и 8-байт слота);
 *   4. сверяет authority с реестром: активная программа — ожидаемый
 *      authority/multisig; deprecated — ТОЛЬКО null (immutable);
 *   5. считает lamports: deprecated-программа с балансом = «не осушена».
 *
 * Exit codes: 0 — всё чисто; 1 — нарушение; 2 — сеть/RPC недоступна.
 *
 *   RPC_URL=https://api.devnet.solana.com node scripts/inventory-programs.mjs
 *   node scripts/inventory-programs.mjs --json        # машинный вывод
 *   node scripts/inventory-programs.mjs --schema-only # без сети (для CI/агентов)
 *   node scripts/inventory-programs.mjs --expect-authority <base58>  # адрес из
 *     приватного runbook вместо закоммиченного expectedUpgradeAuthority
 *
 * Крон для прод-окружения (см. docs/OPERATIONS.md, раздел «Инвентарь программ»):
 * раз в сутки, любой не-нулевой exit — алерт.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// INVENTORY_PATH (env) — фикстура для тестов; по умолчанию реестр в game/.
const INVENTORY_PATH = process.env.INVENTORY_PATH
  ? path.resolve(process.env.INVENTORY_PATH)
  : path.join(here, "..", "program-inventory.json");
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const SCHEMA_ONLY = args.includes("--schema-only");
// --expect-authority <base58>: verify the on-chain upgrade authority against an
// address supplied OUTSIDE the repository (CI variable / runbook), instead of
// committing it to program-inventory.json. This is the flag the registry note
// promised; it lets the check run before the Squads address is public.
const EXPECT_AUTHORITY = (() => {
  const i = args.indexOf("--expect-authority");
  return i === -1 ? null : args[i + 1] ?? "";
})();

function fail(msg) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, violations: [msg] }, null, 2));
  else console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

const inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
if (inventory.schemaVersion !== 1) fail(`schemaVersion != 1`);

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
for (const p of inventory.programs ?? []) {
  if (!B58.test(p.id ?? "")) fail(`плохой id: ${p.id}`);
  if (!["active", "deprecated", "retired"].includes(p.status)) fail(`плохой статус у ${p.id}`);
  if (p.status === "deprecated" && p.expectedUpgradeAuthority !== null) {
    fail(`deprecated-программа ${p.id} обязана быть immutable (expectedUpgradeAuthority = null)`);
  }
  if (EXPECT_AUTHORITY !== null && !B58.test(EXPECT_AUTHORITY)) {
    fail(`--expect-authority: не base58-адрес: ${EXPECT_AUTHORITY}`);
  }
  // Не нарушение, но громкое напоминание: активная программа без зафиксированного
  // ожидания authority — незакрытый пункт реестра (гейт G-2). Молчаливого
  // «schema: OK» по этому полю быть не должно.
  if (p.status === "active" && p.expectedUpgradeAuthority === null && EXPECT_AUTHORITY === null) {
    console.error(
      `! активная программа ${p.id}: expectedUpgradeAuthority не задан — до mainnet заполни Squads-мультисиг (G-2) или передай --expect-authority <addr>`,
    );
  }
}

if (SCHEMA_ONLY) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: process.exitCode !== 1, schemaOnly: true, expectAuthorityOverride: EXPECT_AUTHORITY ?? null }, null, 2));
  else console.log(process.exitCode === 1 ? "schema: FAIL" : "schema: OK (see warnings above, if any)");
  process.exit(process.exitCode ?? 0);
}

const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
const STANDARDS = { mainnet: "https://api.mainnet-beta.solana.com", devnet: "https://api.devnet.solana.com" };

async function rpc(method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC error: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

function b58encode(buf) {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
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
  return out + digits.reverse().map((d) => ALPHABET[d]).join("");
}

async function checkProgram(entry) {
  const violations = [];
  const warnings = [];
  const info = await rpc("getAccountInfo", [entry.id, { encoding: "base64" }]);
  const acc = info?.value;
  if (!acc) {
    if (entry.status === "retired") return { entry, violations, state: "retired-absent-ok" };
    violations.push(`программа ${entry.id} (${entry.status}) не найдена в ${inventory.network}`);
    return { entry, violations, state: "missing" };
  }
  const data = Buffer.from(acc.data[0], "base64");
  if (acc.owner !== "BPFLoaderUpgradeab1e11111111111111111111111") {
    violations.push(`${entry.id}: owner ${acc.owner} — не BPF upgradeable loader`);
  }
  if (data.length < 36) {
    violations.push(`${entry.id}: аккаунт программы короче 36 байт (${data.length})`);
    return { entry, violations, state: "malformed" };
  }
  const programData = b58encode(data.subarray(4, 36));
  const pdInfo = await rpc("getAccountInfo", [programData, { encoding: "base64" }]);
  const pd = pdInfo?.value;
  if (!pd) {
    violations.push(`${entry.id}: programData ${programData} не найден`);
    return { entry, violations, state: "no-programdata" };
  }
  const pdData = Buffer.from(pd.data[0], "base64");
  // ProgramData layout: 4 байта тега + 8 байт slot + Option<Pubkey> (1 + 32).
  let authority = null;
  if (pdData.length >= 45 && pdData[12] === 1) authority = b58encode(pdData.subarray(13, 45));
  const isImmutable = authority === null;
  const lamports = pd.lamports + acc.lamports;

  if (entry.status === "deprecated" && !isImmutable) {
    violations.push(
      `DEPRECATED программа ${entry.id} всё ещё mutable (authority ${authority}) — финализируй: solana program set-upgrade-authority <id> --final`,
    );
  }
  // Приоритет у значения из CLI: оно позволяет сверять authority с адресом из
  // приватного runbook, не коммитя его в публичный реестр.
  const expectedAuthority = EXPECT_AUTHORITY ?? entry.expectedUpgradeAuthority;
  if (entry.status === "active" && expectedAuthority && authority !== expectedAuthority) {
    violations.push(
      `ACTIVE программа ${entry.id}: authority ${authority ?? "None"} ≠ ожидаемой ${expectedAuthority} — возможен захват апгрейда (п. 102)`,
    );
  }
  if ((entry.status === "deprecated" || entry.status === "retired") && lamports > 0 && entry.drainRequired !== false) {
    violations.push(
      `${entry.status} программа ${entry.id} держит ${(lamports / 1e9).toFixed(4)} SOL — осушить и close (п. 98: спящие пулы Raydium)`,
    );
  }
  if (!expectedAuthority && entry.status === "active" && !isImmutable) {
    // Не нарушение (комментарий 2026-10-03/07): активная mutable-программа без
    // зафиксированного ожидания authority — незакрытый пункт реестра до Squads
    // (гейт G-2), а не инцидент. Раньше это шло в violations → exit 1 → cron
    // открывал issue каждый запуск (issue #55) и прятал настоящие алерты.
    // Теперь — громкое предупреждение в логе/JSON, но НЕ сбой проверки:
    // принудительный контроль authority на mainnet делает preflight-mainnet.sh
    // (items 44/63: без MAINNET_AUTHORITY — fail).
    warnings.push(`ACTIVE программа ${entry.id}: expectedUpgradeAuthority не задан — заполни Squads-мультисиг до mainnet (гейт G-2) или передай --expect-authority <addr> [текущий authority на цепи: ${authority ?? "None"}]`);
  }
  return { entry, violations, warnings, state: "ok", authority, isImmutable, lamports, programData };
}

try {
  const results = [];
  for (const entry of inventory.programs ?? []) {
    results.push(await checkProgram(entry));
  }
  const violations = results.flatMap((r) => r.violations);
  const warnings = results.flatMap((r) => r.warnings ?? []);
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: violations.length === 0, network: inventory.network, results, violations, warnings }, null, 2));
  } else {
    for (const r of results) {
      const line = `${r.entry.status.toUpperCase().padEnd(10)} ${r.entry.id}`;
      if (r.violations.length) console.error(`✗ ${line}\n    ${r.violations.join("\n    ")}`);
      else console.log(`✓ ${line} authority=${r.authority ?? "None"} lamports=${r.lamports ?? "-"}`);
    }
    for (const w of warnings) console.error(`! ${w}`);
    const verdict = violations.length === 0 ? "OK" : `FAIL (${violations.length})`;
    console.log(`\ninventory: ${verdict}${warnings.length ? ` [${warnings.length} warning(s)]` : ""}`);
  }
  process.exitCode = violations.length === 0 ? 0 : 1;
} catch (err) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: String(err) }, null, 2));
  else console.error(`inventory: RPC/network failure — ${err.message}`);
  process.exit(2);
}
