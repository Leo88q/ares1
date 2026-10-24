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

test('English dictionary has no orphaned entries outside production source', () => {
  const source = walk(srcDir).map((file) => readFileSync(file, 'utf8')).join('\n');
  const orphaned = keysOf('en.ts').filter((key) => !source.includes(key));
  assert.deepEqual(orphaned, [], 'remove translations that no production component or content can use');
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

test('tutorial describes Age of Farming as separate and the bridge as not live', () => {
  const keys = [
    '07 / КВЕСТЫ И ПЛАНЫ',
    'Награды квестов и планы интеграции',
    'Квесты минтит сервер (не клиент). Age of Farming — отдельное приложение; межигровые переводы и общий burn пока не доступны. Удачи, колонист.',
  ];
  const english = entriesOf('en.ts');
  assert.ok(english.get(keys[2]).includes('separate app'));
  assert.ok(english.get(keys[2]).includes('not available'));
  for (const file of files.filter((file) => file !== 'en.ts')) {
    const translated = entriesOf(file);
    for (const key of keys) {
      assert.ok(translated.has(key), `${file} is missing ${key}`);
      assert.notEqual(translated.get(key), english.get(key), `${file} leaves the tutorial integration copy in English`);
    }
  }
});

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
    'Сейчас активна только пара POTATO/SOL; legacy-контракт удерживает комиссию в POTATO при создании ордера. Целевая V2-модель: 9–12% из выплаты продавцу при успешной сделке, в валюте расчёта и в казну; суточные накопительные tiers и отдельная пара POTATO/SKR пока не активны, точные пороги остаются проектом до финального решения. Devnet-активы тестовые.',
    'ОПЕРАЦИЯ: ПЕРВАЯ ТЕПЛИЦА',
    'ЭКИПАЖ: {wallet} · ЦИКЛ #{cycle}',
    'Подготовь теплицу за 28 дней. Задачи ниже сверяются с текущими on-chain аккаунтами; пока это журнал состояния, без сезонных очков, рейтинга или награды.',
    'ГОТОВО: {done} ИЗ {total}',
    'Это devnet-журнал состояния, а не запущенный соревновательный сезон. Очки, призы, глобальный рейтинг и архив появятся только после внедрения сезонного on-chain учёта; тестовые активы и прогресс не имеют денежной ценности.',
    'Рынок devnet сейчас legacy V1: комиссия 9–12% в POTATO при создании ордера; settlement fee 9–12% в SOL/SKR и пара SKR ещё не активны',
    'V2 · комиссия из выплаты продавца',
    'V2 · комиссия продавца вычитается из выплаты только после успешного fill; вся сумма поступает в казну в валюте пары.',
    'Пороги 1k / 10k / 100k POTATO — черновик; утвердить до релиза V2.',
    'Оборот POTATO',
    'Всего сделок',
    'Оборот SOL',
    'Оборот SKR',
    'Мой объём за UTC-день: {amount} POTATO',
    'Сумма сделки',
    'Валовая сумма',
    'Ставки комиссии',
    'Оценка комиссии',
    'Чистая выплата продавцу',
    'Ордера V2 пока не опубликованы.',
    'POTATO депонируется без комиссии; комиссия в валюте пары взимается только при fill.',
    'Оценка комиссии может измениться до исполнения из-за накопленного объёма продавца за UTC-день.',
    'Минимум 10 POTATO.',
    'Недостаточно POTATO для депозита',
    'Укажи количество POTATO и цену в {asset}',
    'Цена за 1 POTATO ({asset})',
    'Публикуем…',
    'Отгрузить V2-ордер',
    'Отменить V2-ордер',
    'Купить за {amount} {asset}',
    'Твой ордер',
    '{h} ч осталось',
    'Покупатель платит gross; комиссия вычитается из выплаты продавца.',
    'Проверь сделку: gross {gross}; ставки {rates}; комиссия продавца {fee}; чистая выплата {net}. Казна получит комиссию в {asset}. Оценка может измениться до исполнения.',
    'Ордер V2 опубликован',
    'Комиссия удерживается только при успешной сделке.',
    'Не удалось создать V2-ордер',
    'Покупка V2 выполнена',
    '+{amount} POTATO; комиссия в казну: {fee} {asset}',
    'Не удалось исполнить V2-ордер',
    'V2-ордер отменён',
    'POTATO возвращён; комиссия за отмену не взимается.',
    'Не удалось отменить V2-ордер',
    'Отменить V2-ордер? Вернётся весь депозит POTATO, комиссия не взимается.',
    'Срок ордера истёк',
    'Истёкший V2-ордер: верни весь депозит POTATO без комиссии.',
    'Вернуть депозит POTATO',
    'Вернуть продавцу депозит POTATO',
    'Закрыть истёкший ордер? Полный депозит вернётся продавцу; комиссия не взимается. Если ATA продавца отсутствует, ты оплатишь её создание.',
    'Истёкший V2-ордер закрыт',
    'Депозит POTATO возвращён продавцу без комиссии.',
    'Не удалось закрыть истёкший V2-ордер',
    'Mint SKR не настроен или имеет неверное число знаков в этой сети.',
    'Недостаточно SKR для валовой оплаты.',
    'Недостаточно SOL для валовой оплаты, сетевой комиссии и аренды ATA.',
    'Недостаточно SOL для сетевых комиссий и аренды ATA.',
    'Создай и пополни ATA SKR перед покупкой.',
    'Пара POTATO / SKR недоступна для новых сделок без проверенного mint; ордера видны, свои можно отменить, истёкший escrow можно вернуть.',
    'Цена должна быть положительной.',
    'Проверь сумму и цену: значения должны быть положительными, а gross — не ниже минимума пары.',
    'Выбор версии рынка',
    'Рынок V2',
    'Рынок V1',
    'V1-ордера и escrow остаются в отдельном legacy-рынке до исполнения, отмены или закрытия. V2 не меняет их layout и правила; в V1 комиссия удерживается в POTATO при создании.',
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

test('field lab product copy is translated, with interpolation tokens preserved', () => {
  // /lab (2026-10-17): живые данные игры, общий сток колонии и мост стенд↔база.
  // 'ЛАБ' — навигационное сокращение: во всех языках клавиша пульта подписана
  // универсальным «LAB», поэтому в список «обязательно отличается от английского»
  // она не входит (ключ и переводы присутствуют и проверяются паритетом).
  const keys = [
    'ПОЛЕВАЯ ЛАБОРАТОРИЯ',
    'ПРОДАКТ · ЖИВЫЕ ДАННЫЕ ИГРЫ',
    'Настоящие поля кошелька, общий сток колонии и правила рынка в одной секции. Инженерный SIM остаётся учебным слоем и не платит токенами.',
    'ЭКИПАЖ: {wallet}',
    'ЖДЁТ СБОРА: {n} POTATO',
    'ВЫХОД ПОЛЕЙ В ДЕНЬ',
    'ЛИМИТ БАТЧА: {n} ПОЛЕЙ',
    'ДЕФИЦИТ: {n} КВТ·Ч',
    'УЧЕБНЫЙ СТЕНД · НЕ АККАУНТ КОШЕЛЬКА',
    'СТЕНД {tier} · {name}',
    'СНАБЖЕНИЕ СТЕНДА ИЗ КОЛОНИИ',
    'Один сток на секции: сколько забрал стенд, столько списано у базы. Партии еды возвращаются в её хранилище.',
    'ОСТАНОВИ ЧАСЫ КОЛОНИИ, ЧТОБЫ ПЕРЕДАТЬ СНАБЖЕНИЕ',
    'СТОК КОЛОНИИ: {value} {unit}',
    'СВОБОДНО НА СТЕНДЕ: {value} {unit}',
    'ПЕРЕДАТЬ {amount} {unit}',
    'ПЕРЕДАНО ИЗ КОЛОНИИ: {amount} {unit}',
    'ПАРТИЯ {kg} КГ ПРИНЯТА В ХРАНИЛИЩЕ БАЗЫ',
    'СВОБОДНО В ХРАНИЛИЩЕ: {kg} КГ ИЗ {cap} КГ',
    'ПОЛУЧЕНО ОТ БАЗЫ: {litres} {unit} / {nutrients} {nutrientUnit}',
    'МАСШТАБ СТЕНДА: ×{scale} · ПОТОЛОК РЕЗЕРВА {cap} {unit}',
    'СВЯЗЬ С КОЛОНИЕЙ',
    'ДЕНЬ {day} ИЗ {total}',
    'ПОЛЯ, СВЯЗАННЫЕ С БАЗОЙ',
    'Предел связи с базой достигнут: освободи площадку или построй новый модуль.',
    'СТАКАН СНАБЖЕНИЯ',
    'ЛУЧШАЯ ЦЕНА ПОКУПКИ',
    'РЫНОК И ЭКОНОМИКА',
    'ОКУПАЕМОСТЬ',
    'МИКРО-ПОЛЕ',
    'БАЛАНС: {amount} POTATO',
    'СВЯЗЬ С БАЗОЙ: {linked} ИЗ {cap} ПОЛЕЙ ПРИ {free} СВОБОДНЫХ ПЛОЩАДКАХ',
    'Полевая лаборатория читает настоящие поля, балансы и ордера, но SIM-партии еды и ресурсы колонии остаются локальным учётом: они не конвертируются в POTATO и не создают транзакций.',
  ];
  const english = entriesOf('en.ts');
  const placeholders = (value) => [...value.matchAll(/\{[^{}]+\}/g)].map(match => match[0]).sort();
  for (const key of keys) assert.ok(english.has(key), `missing English source for ${key}`);
  for (const file of files.filter(file => file !== 'en.ts')) {
    const translated = entriesOf(file);
    for (const key of keys) {
      assert.ok(translated.has(key), `${file} is missing ${key}`);
      assert.notEqual(translated.get(key), english.get(key), `${file} leaves field lab copy in English: ${key}`);
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
