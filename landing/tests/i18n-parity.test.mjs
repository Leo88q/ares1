// F-15: landing had no tests. Lock the i18n dictionary set: every locale must
// carry exactly the same keys as the English baseline, no duplicates, and
// every static t("…") literal used by the app must exist in the baseline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stringsDir = join(root, 'i18n', 'strings');
const files = readdirSync(stringsDir).filter(f => f.endsWith('.ts')).sort();

function keysOf(file) {
  const src = readFileSync(join(stringsDir, file), 'utf8');
  const keys = [];
  const re = /^ {1,2}'((?:[^'\\]|\\.)*)':/gm;
  let m;
  while ((m = re.exec(src)) !== null) keys.push(m[1].replace(/\\'/g, "'"));
  return keys;
}

test('locale files exist and share one key set', () => {
  assert.ok(files.length >= 6, `expected >=6 locale files, got ${files.length}`);
  const baseline = keysOf('en.ts');
  assert.ok(baseline.length >= 300, `suspiciously small en.ts: ${baseline.length} keys`);
  assert.equal(new Set(baseline).size, baseline.length, 'duplicate keys in en.ts');
  for (const f of files) {
    const keys = keysOf(f);
    assert.equal(new Set(keys).size, keys.length, `duplicate keys in ${f}`);
    const missing = baseline.filter(k => !keys.includes(k));
    const extra = keys.filter(k => !baseline.includes(k));
    assert.deepEqual({ f, missing, extra }, { f, missing: [], extra: [] },
      `${f} diverges from en.ts baseline`);
  }
});

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'public' || entry === 'strings') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

test('static t() literals used by the app exist in en.ts', () => {
  const baseline = new Set(keysOf('en.ts'));
  const missing = [];
  for (const file of walk(root)) {
    const code = readFileSync(file, 'utf8');
    const re = /\bt\(\s*(['"])((?:[^'"\\]|\\.)*?)\1/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const key = m[2].replace(/\\'/g, "'");
      if (!/[\u0410-\u044f\u0401\u0451]/.test(key)) continue;
      if (!baseline.has(key)) missing.push(`${file.slice(root.length + 1)}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

function entriesOf(file) {
  const src = readFileSync(join(stringsDir, file), 'utf8');
  const entries = new Map();
  const re = /^ {1,2}'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const decode = value => value.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    entries.set(decode(m[1]), decode(m[2]));
  }
  return entries;
}

test('new presale, fee and season copy is localized with interpolation tokens preserved', () => {
  const keys = [
    'Фаза 1 — отдельный пресейл mainnet. Devnet-бета бесплатна, прогресс не переносится, тестовые SOL/SKR не имеют реальной стоимости.',
    'Этот сервер работает в devnet: не отправляйте сюда реальные средства.',
    'Пресейл mainnet пока закрыт: не отправляйте средства.',
    'Переведите ровно {amount} на:',
    'Целевая версия V2: 9–12% от gross-суммы удерживается только при успешном fill из выплаты продавцу и поступает в казну в валюте расчёта (SOL или SKR). Суточные маржинальные сегменты seller-wallet: 9% на первые 1 000 POTATO, 10% до 10 000, 11% до 100 000, затем 12%; объём общий для обеих пар — дробление ордеров не снижает ставку. Sybil-кошельки без identity-системы не блокируются. Сейчас devnet-контракт — legacy SOL/POTATO; V2 и пара POTATO/SKR ещё не активны.',
    'СЕЗОННАЯ ОПЕРАЦИЯ',
    'ОПЕРАЦИЯ: ПЕРВАЯ ТЕПЛИЦА',
    'Текущий devnet-контракт V1 сжигает 60% старой комиссии, которую продавец вносит в POTATO при создании ордера; эта схема legacy. Целевая V2-комиссия 9–12% удерживается при успешной сделке из выплаты продавцу в SOL или SKR и идёт в казну — она не сжигает POTATO. Другие игровые расходы могут сжигать POTATO по правилам контракта. Релиз V2 ещё не включён; burn не гарантирует рост цены.',
    'Что такое «Операция: Первая теплица»?',
    'Целевая версия V2: 9–12% от gross-суммы удерживается только при успешном fill из выплаты продавцу и поступает в казну в валюте расчёта (SOL или SKR). Суточные маржинальные tiers зависят от суммарного POTATO-объёма seller-wallet и общие для SOL/SKR-пар — дробление ордеров одного адреса не должно обходить ставку. Конкретные границы tiers — рабочий проект и будут опубликованы после финального решения перед релизом. Sybil-кошельки без identity-системы не блокируются. Сейчас devnet-контракт — legacy SOL/POTATO; V2 и пара POTATO/SKR ещё не активны.',
  ];
  const english = entriesOf('en.ts');
  const placeholders = value => [...value.matchAll(/\{[^{}]+\}/g)].map(match => match[0]).sort();
  const tierDraftKey = keys.find(key => key.includes('Суточные маржинальные сегменты seller-wallet:'));
  const draftCue = {
    'es-419.ts': 'borrador',
    'id.ts': 'rancangan',
    'pt-BR.ts': 'rascunho',
    'tl.ts': 'draft',
    'vi.ts': 'bản nháp',
  };
  for (const file of files.filter(file => file !== 'en.ts')) {
    const translated = entriesOf(file);
    assert.ok(translated.get(tierDraftKey).toLocaleLowerCase().includes(draftCue[file]),
      `${file} must clearly label proposed V2 tier breakpoints as a draft`);
    for (const key of keys) {
      assert.ok(english.has(key), `missing English source for ${key}`);
      assert.ok(translated.has(key), `${file} is missing ${key}`);
      assert.notEqual(translated.get(key), english.get(key), `${file} leaves new launch copy in English: ${key}`);
      assert.deepEqual(placeholders(translated.get(key)), placeholders(english.get(key)), `${file} changes interpolation tokens for ${key}`);
    }
  }
});

test('translations contain no leftover Russian text', () => {
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(join(stringsDir, f), 'utf8');
    const re = /^ {1,2}'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (/[\u0410-\u044f\u0401\u0451]/.test(m[2])) offenders.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
