// Паритет словарей игры: у всех локалей один и тот же набор ключей, без
// дублей, и каждый статический литерал t("…") / t('…') из кода есть в базовом
// английском словаре. Зеркало landing/tests/i18n-parity.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const stringsDir = join(srcDir, 'i18n', 'strings');
const files = readdirSync(stringsDir).filter((f) => f.endsWith('.ts')).sort();

function keysOf(file) {
  const src = readFileSync(join(stringsDir, file), 'utf8');
  const keys = [];
  const re = /^ {1,2}'((?:[^'\\]|\\.)*)':/gm;
  let m;
  while ((m = re.exec(src)) !== null) keys.push(m[1].replace(/\\'/g, "'"));
  return keys;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'strings') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

test('locale files exist and share one key set', () => {
  assert.ok(files.length >= 6, `expected >=6 locale files, got ${files.length}`);
  const baseline = keysOf('en.ts');
  assert.ok(baseline.length >= 400, `suspiciously small en.ts: ${baseline.length} keys`);
  assert.equal(new Set(baseline).size, baseline.length, 'duplicate keys in en.ts');
  for (const f of files) {
    const keys = keysOf(f);
    assert.equal(new Set(keys).size, keys.length, `duplicate keys in ${f}`);
    const missing = baseline.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !baseline.includes(k));
    assert.deepEqual({ f, missing, extra }, { f, missing: [], extra: [] },
      `${f} diverges from en.ts baseline`);
  }
});

test('static t() literals used by the app exist in en.ts', () => {
  const baseline = new Set(keysOf('en.ts'));
  const missing = [];
  for (const file of walk(srcDir)) {
    const code = readFileSync(file, 'utf8');
    const re = /\bt\(\s*(['"])((?:[^'"\\]|\\.)*?)\1/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const key = m[2].replace(/\\'/g, "'");
      if (!/[А-Яа-яЁё]/.test(key)) continue; // не-русские ключи = не переводы
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
    const decode = (value) => value.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    entries.set(decode(m[1]), decode(m[2]));
  }
  return entries;
}

test('new greenhouse and settlement copy is translated, with interpolation tokens preserved', () => {
  const keys = [
    'ЛУННОЕ ОКНО · 28 ЭПОХ',
    'Нет данных текущей on-chain эпохи.',
    'ТЕКУЩАЯ ФАЗА',
    'ЭПОХА {day} ИЗ 28',
    'МНОЖИТЕЛЬ УРОЖАЯ',
    'Текущий множитель берётся из on-chain эпохи и влияет только на расчёт урожая. Это не прогноз погоды и не отдельная награда.',
    'АРХИВ МУТАЦИЙ',
    'Снимок активных on-chain полей этого кошелька, не полная история. Мутации не гарантированы; экран не проверяет честность случайного выбора.',
    'Подключи кошелёк, чтобы увидеть текущие on-chain мутации.',
    'Нет активных мутаций в текущих полях.',
    'Мутации могут появиться после улучшения поля, если сработает проверка контракта.',
    'Фаза 1 — отдельный пресейл mainnet. Devnet-бета бесплатна, прогресс не переносится, тестовые SOL/SKR не имеют реальной стоимости.',
    'Этот сервер работает в devnet: не отправляйте сюда реальные средства.',
    'НАЗАД В КОЛОНИЮ',
    'Это локальная демо-сцена: кнопки меняют только состояние в браузере. Здесь нет токенов, транзакций, кошелька или сохранения прогресса.',
    'Сейчас активна только пара POTATO/SOL; legacy-контракт удерживает комиссию в POTATO при создании ордера. Целевая V2-модель: 9–12% из выплаты продавцу при успешной сделке, в валюте расчёта и в казну; суточные накопительные tiers и отдельная пара POTATO/SKR пока не активны. Devnet-активы тестовые.',
    'ОПЕРАЦИЯ: ПЕРВАЯ ТЕПЛИЦА',
    'ЭКИПАЖ: {wallet} · ЦИКЛ #{cycle}',
    'Подготовь теплицу за 28 дней. Задачи ниже сверяются с текущими on-chain аккаунтами; пока это журнал состояния, без сезонных очков, рейтинга или награды.',
    'ГОТОВО: {done} ИЗ {total}',
    'Это devnet-журнал состояния, а не запущенный соревновательный сезон. Очки, призы, глобальный рейтинг и архив появятся только после внедрения сезонного on-chain учёта; тестовые активы и прогресс не имеют денежной ценности.',
    'Рынок devnet сейчас legacy V1: комиссия 9–12% в POTATO при создании ордера; settlement fee 9–12% в SOL/SKR и пара SKR ещё не активны',
  ];
  const english = entriesOf('en.ts');
  const placeholders = (value) => [...value.matchAll(/\{[^{}]+\}/g)].map(match => match[0]).sort();
  for (const file of files.filter(file => file !== 'en.ts')) {
    const translated = entriesOf(file);
    for (const key of keys) {
      assert.ok(english.has(key), `missing English source for ${key}`);
      assert.ok(translated.has(key), `${file} is missing ${key}`);
      assert.notEqual(translated.get(key), english.get(key), `${file} leaves new product copy in English: ${key}`);
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
