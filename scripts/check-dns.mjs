#!/usr/bin/env node
/**
 * Мониторинг доменных записей — чек-лист п. 119 (аудит 2026-09-28).
 *
 * Прецедент: BONKfun (Solana, 11.03.2026) — атакующий через поддержку
 * DNS-провайдера перевёл домен к внешнему регистратору; пользователи ~недели
 * ходили на фишинговый фронтенд. Приём на стороне «аппаратной» защиты
 * (transfer lock, отдельная парольная фраза поддержки, аппаратный ключ у
 * регистратора) — в docs/OPERATIONS.md; ЭТОТ скрипт — детектор уже случившейся
 * подмены: он сравнивает текущие DNS-записи с зафиксированным baseline'ом.
 *
 * Использование:
 *   node scripts/check-dns.mjs                 # сверка с baseline (для крона/CI)
 *   node scripts/check-dns.mjs --update        # переписать baseline текущим состоянием
 *   node scripts/check-dns.mjs --verbose       # печатать все записи, даже без изменений
 *
 * Exit codes: 0 — без изменений (или безопасная CDN-ротация IP); 1 — обнаружены
 * изменения, требующие ручной проверки (возможный угон); 2 — сеть недоступна.
 *
 * Baseline: scripts/dns-baseline.json — КОММИТИТСЯ в репозиторий: изменения
 * видны в diff любого PR, а откат — через git. Смена A/AAAA внутри диапазонов
 * Cloudflare считается штатной ротацией anycast-IP; всё остальное — алерт.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(here, "dns-baseline.json");
const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const VERBOSE = args.includes("--verbose");

const DEFAULT_DOMAINS = ["ares1.is-a.dev", "play.ares1.is-a.dev"];
const TYPES = ["A", "AAAA", "CNAME", "NS", "TXT"];

// Диапазоны Cloudflare (https://www.cloudflare.com/ips/): смена записей внутри
// них — штатная работа прокси, а не угон. Поддержаны только IPv4/IPv6 префиксы,
// реально встречающиеся на этом проекте.
const CF_V4 = ["104.16.0.0/13", "172.64.0.0/13", "188.114.96.0/20", "162.159.0.0/16"];
const CF_V6 = ["2606:4700::/32"];

function ipToBuf(ip) {
  if (ip.includes(":")) {
    const [head, tail = ""] = ip.split("::");
    const h = head.split(":").filter(Boolean);
    const t = tail.split(":").filter(Boolean);
    const missing = 8 - h.length - t.length;
    const groups = [...h, ...Array(missing).fill("0"), ...t];
    const buf = Buffer.alloc(16);
    groups.forEach((g, i) => buf.writeUInt16LE(parseInt(g, 16), (7 - i) * 2));
    return { buf, v6: true };
  }
  const buf = Buffer.alloc(4);
  ip.split(".").forEach((o, i) => buf.writeUInt8(parseInt(o, 10), 3 - i));
  return { buf, v6: false };
}

function inCidr(ip, cidrs) {
  const a = ipToBuf(ip);
  for (const cidr of cidrs) {
    const [net, bitsRaw] = cidr.split("/");
    const bits = parseInt(bitsRaw, 10);
    const b = ipToBuf(net);
    if (a.v6 !== b.v6) continue;
    const len = b.buf.length;
    let full = Math.floor(bits / 8);
    const rem = bits % 8;
    let ok = true;
    for (let i = 0; i < full && ok; i++) {
      // buf'ы записаны little-endian по байтам групп — сравниваем «снаружи»:
      ok = a.buf[len - 1 - i] === b.buf[len - 1 - i];
    }
    if (ok && rem > 0 && full < len) {
      const mask = (0xff << (8 - rem)) & 0xff;
      ok = (a.buf[len - 1 - full] & mask) === (b.buf[len - 1 - full] & mask);
      full += 1;
    }
    if (ok) return true;
  }
  return false;
}

function isManagedCdn(record) {
  if (record.type === "A") return inCidr(record.data, CF_V4);
  if (record.type === "AAAA") return inCidr(record.data, CF_V6);
  return false;
}

async function resolve(domain, type) {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error(`DoH ${res.status} for ${domain}/${type}`);
  const body = await res.json();
  if (body.Status !== 0 && body.Status !== 3) throw new Error(`DoH status ${body.Status} for ${domain}/${type}`);
  return (body.Answer ?? []).map(a => ({ type, data: String(a.data).trim() })).sort((x, y) => x.data.localeCompare(y.data));
}

async function snapshot(domains) {
  const out = { generatedAt: new Date().toISOString(), resolver: "dns.google", domains: {} };
  for (const d of domains) {
    const records = {};
    for (const t of TYPES) records[t] = await resolve(d, t);
    out.domains[d] = records;
  }
  return out;
}

function flatten(snap) {
  const lines = [];
  for (const [d, records] of Object.entries(snap.domains ?? {})) {
    for (const [t, answers] of Object.entries(records)) {
      for (const a of answers) lines.push(`${d} ${t} ${a.data}`);
    }
  }
  return lines;
}

function cmp(base, current) {
  const b = new Set(flatten(base));
  const c = new Set(flatten(current));
  const added = [...c].filter(x => !b.has(x));
  const removed = [...b].filter(x => !c.has(x));
  return { added, removed };
}

function severity(changes) {
  const hostile = [];
  for (const line of [...changes.added, ...changes.removed]) {
    const [, type, data] = line.split(" ");
    if (isManagedCdn({ type, data })) continue; // штатная CDN-ротация
    hostile.push(line);
  }
  return hostile;
}

async function main() {
  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : null;
  const domains = baseline?.domains ? Object.keys(baseline.domains) : DEFAULT_DOMAINS;
  let current;
  try {
    current = await snapshot(domains);
  } catch (err) {
    console.error(`dns-check: network/resolver failure — ${err.message}`);
    process.exit(2);
  }
  if (!baseline) {
    console.error("dns-check: baseline отсутствует — создайте его осознанно:\n  node scripts/check-dns.mjs --update");
    process.exit(1);
  }
  const changes = cmp(baseline, current);
  const hostile = severity(changes);
  if (VERBOSE) {
    for (const line of flatten(current)) console.log(`  ${line}`);
  }
  if (changes.added.length === 0 && changes.removed.length === 0) {
    console.log("dns-check: OK — записи совпадают с baseline");
    process.exit(0);
  }
  for (const l of changes.added) console.error(`+ ${l}`);
  for (const l of changes.removed) console.error(`- ${l}`);
  if (hostile.length > 0) {
    console.error(
      `\ndns-check: FAIL — ${hostile.length} изменени(й/я) вне диапазонов Cloudflare.\n` +
        "Проверьте: не менялся ли NS/регистратор (п. 119), нет ли фишингового фронта,\n" +
        "уведомите команду кошельков и блок-листы, включите резервный домен (см. docs/OPERATIONS.md).",
    );
    process.exit(1);
  }
  console.log(
    "dns-check: только штатная ротация Cloudflare-IP — ок (для обновления baseline: --update)",
  );
  if (UPDATE) {
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
    console.log("dns-check: baseline обновлён");
  }
  process.exit(0);
}

if (UPDATE && process.argv.length > 0) {
  // --update: снять НОВЫЙ baseline полностью (пересоздать файл)
  try {
    const snap = await snapshot(DEFAULT_DOMAINS);
    writeFileSync(BASELINE_PATH, JSON.stringify(snap, null, 2) + "\n");
    console.log(`dns-check: baseline записан (${DEFAULT_DOMAINS.join(", ")}) — проверьте diff и закоммитьте`);
    process.exit(0);
  } catch (err) {
    console.error(`dns-check: network/resolver failure — ${err.message}`);
    process.exit(2);
  }
}

await main();
