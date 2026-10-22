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
    if (entry === 'node_modules' || entry === 'dist' || entry === 'public' || entry === 'strings' || entry === 'tests') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

test('English dictionary has no orphaned entries outside production source', () => {
  const source = walk(root).map(file => readFileSync(file, 'utf8')).join('\n');
  const orphaned = keysOf('en.ts').filter(key => !source.includes(key));
  assert.deepEqual(orphaned, [], 'remove translations that no production component or content can use');
});

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

test('launch-gate, live-field, fee and season-status copy is localized with interpolation tokens preserved', () => {
  const keys = [
    'ПРЕСЕЙЛ SKR ЗАКРЫТ',
    'ПОКУПКА ПАКОВ ОТКЛЮЧЕНА',
    'Пресейл mainnet пока закрыт: не отправляйте средства.',
    'Фаза 1 — отдельный пресейл mainnet. Devnet-бета бесплатна, прогресс не переносится, тестовые SOL/SKR не имеют реальной стоимости.',
    'ARES-1 сейчас — devnet-бета с реальными on-chain-полями и действиями. Пресейл за SKR закрыт; строительство колонии пока не подключено.',
    'До официального запуска здесь нет подключения кошелька, резерва, адреса оплаты или формы подтверждения.',
    'Поля накапливают $POTATO по текущей devnet-конфигурации; сбор требует подтверждённой транзакции',
    'Поля — отдельные on-chain аккаунты; продажа паков, уровни редкости и право строить колонию не подключены',
    'Существующая лицензия может влиять только на legacy-механики devnet V1. Новые лицензии и продление за SKR отключены до отдельного одобренного запуска; она не уменьшает целевую V2-комиссию.',
    'Экран операции сверяет задачи с текущими on-chain аккаунтами. Это не 28-дневная кампания, не обучение и не активный сезон: очки, общий рейтинг и награды не подключены.',
    'Это обзор текущего продукта, а не кампания, обучение или локальная симуляция.',
  ];
  const english = entriesOf('en.ts');
  const placeholders = value => [...value.matchAll(/\{[^{}]+\}/g)].map(match => match[0]).sort();
  for (const file of files.filter(file => file !== 'en.ts')) {
    const translated = entriesOf(file);
    for (const key of keys) {
      assert.ok(english.has(key), `missing English source for ${key}`);
      assert.ok(translated.has(key), `${file} is missing ${key}`);
      assert.notEqual(translated.get(key), english.get(key), `${file} leaves new launch copy in English: ${key}`);
      assert.deepEqual(placeholders(translated.get(key)), placeholders(english.get(key)), `${file} changes interpolation tokens for ${key}`);
    }
  }
});

test('NeuroForge integration concept and separate-app notice are localized as non-live', () => {
  const keys = [
    'КОНЦЕПЦИЯ: ARES-1 × NEUROFORGE',
    'Планируемая интеграция; мост и переводы $POTATO пока не работают.',
    'ПЛАН МЕЖИГРОВОЙ ИНТЕГРАЦИИ',
    'ПЛАН · НЕ ЗАПУЩЕНО',
    'Художественный лор — не описание функций',
    'Интеграция ARES-1 ↔ NeuroForge не запущена: нет работающего маршрута, переводов $POTATO, межигрового burn, предметов или наград. Текст ниже — концепция, а не действующая механика.',
    'В художественном сценарии ARES-1 получает сигнал от NeuroForge. Это вымышленная часть лора и не подтверждает работающую связь между приложениями.',
    'Будущий сценарий мог бы использовать $POTATO в отдельных игровых механиках NeuroForge. Сейчас в ARES-1 нет on-chain-маршрута к этому приложению и нет интеграции токена.',
    'Квантовый мост, межигровой burn, крафт, общие предметы и передача достижений недоступны. Их возможный запуск потребует реализации, проверки и отдельного объявления; сроки не обещаны.',
    'ПЛАНИРУЕМАЯ СВЯЗЬ · SOLANA',
    'Отдельное приложение; связь с ARES-1 не запущена.',
    'Перевод $POTATO между ARES-1 и NeuroForge не работает.',
    'Общие предметы, достижения, награды и крафт не подключены.',
    'Межигровой burn и рыночный маршрут не реализованы.',
    'Цифры и механики NeuroForge из лора не подтверждены как функции интеграции.',
    'Посмотреть статус интеграции',
    'Открыть Age of Farming ↗',
    'Age of Farming — отдельное приложение; переход по ссылке не подключает его к ARES-1.',
    'Подробнее о статусе',
    'СТАТУС ИНТЕГРАЦИИ',
    'Мост ARES-1 ↔ NeuroForge не запущен: отправить или получить $POTATO здесь нельзя. Внешняя ссылка открывает отдельное приложение Age of Farming, не связанное с этой интеграцией.',
    'ПЛАН · МАРС ↔ NEUROFORGE',
    'ЧАСТОТА В ХУДОЖЕСТВЕННОМ ЛОРЕ · 17.42 ГГц',
    'Переводы $POTATO через мост',
    'Дата запуска интеграции',
    'Переводы не запущены',
    'Запуск не объявлен',
    'Ожидаем официальное объявление',
    'Интеграция не запущена: переводы не выполняются. На этой странице нельзя отправить $POTATO или списать SOL/SKR.',
    'Внешняя ссылка не связывает приложения и не переводит токены. До подписания любой операции проверьте адрес программы, сеть и условия транзакции.',
    'Ссылка на отдельное приложение не настроена.',
    'Статус интеграции',
    'Выберите карточку; кросс-игровые функции пока не подключены.',
  ];
  const english = entriesOf('en.ts');
  const importantClaims = [
    ['Интеграция ARES-1 ↔ NeuroForge не запущена: нет работающего маршрута, переводов $POTATO, межигрового burn, предметов или наград. Текст ниже — концепция, а не действующая механика.', 'not live'],
    ['Интеграция не запущена: переводы не выполняются. На этой странице нельзя отправить $POTATO или списать SOL/SKR.', 'cannot send $potato'],
    ['Age of Farming — отдельное приложение; переход по ссылке не подключает его к ARES-1.', 'does not connect'],
  ];
  for (const [key, phrase] of importantClaims) {
    assert.ok(english.get(key)?.toLowerCase().includes(phrase), `English copy must state ${phrase}`);
  }
  for (const file of files.filter(file => file !== 'en.ts')) {
    const translated = entriesOf(file);
    for (const key of keys) {
      assert.ok(english.has(key), `missing English source for ${key}`);
      assert.ok(translated.has(key), `${file} is missing ${key}`);
      assert.notEqual(translated.get(key), english.get(key), `${file} leaves integration copy in English: ${key}`);
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
