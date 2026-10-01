#!/usr/bin/env node
/**
 * instruction-coverage — какие инструкции программы реально вызывает клиент.
 *
 * Зачем (Этап 2): «доказанно лишний код» начинается с доказательства, что код
 * никто не вызывает. Скрипт читает клиентский IDL (`apps/web/src/idl.json`,
 * sha256 сверяется в Этапе 0) и ищет каждый метод по слоям клиента: UI web,
 * утилиты web, backend, тесты, скрипты. Программа (`programs/`) намеренно не
 * считается: там инструкции определены, а не вызваны.
 *
 * Ограничения (печатаются в отчёте вместе с цифрами):
 *   - это СТАТИЧЕСКАЯ проверка ссылок, а не on-chain покрытие: инструкция,
 *     вызываемая внешним клиентом или из консоли, здесь выглядит «не
 *     вызываемой»;
 *   - idl.json и автогенерированные types/** исключены — иначе весь ABI
 *     «используется» самим собой;
 *   - совпадение по границам идентификатора: `grant_reward` не засчитывается
 *     за `grant_reward_once`;
 *   - имя встречается в коде — это ссылка, а не гарантия рабочего пути вызова.
 *
 * Запуск:
 *   node scripts/instruction-coverage.mjs              # таблица человеку
 *   node scripts/instruction-coverage.mjs --json       # машиночитаемо
 *   node scripts/instruction-coverage.mjs --annotate   # ::notice title=ares-usage
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const IDL = path.join(ROOT, 'apps/web/src/idl.json');

// Слои клиента. «web-ui» — то, что видит игрок: компоненты, хуки, контексты.
const BUCKETS = {
  'web-ui': [
    'apps/web/src/components',
    'apps/web/src/ui',
    'apps/web/src/hooks',
    'apps/web/src/contexts',
    'apps/web/src/App.tsx',
  ],
  'web-builder': ['apps/web/src/utils/anchorClient.ts'],
  'web-utils': ['apps/web/src/utils', 'apps/web/src/i18n', 'apps/web/src/theme'],
  backend: ['apps/backend/src'],
  tests: ['tests', 'apps/backend/tests'],
  scripts: ['scripts'],
};
const IGNORED = [/^apps\/web\/src\/idl\.json$/, /^apps\/web\/src\/types\//, /node_modules\//];
// anchorClient.ts считается отдельным слоем (web-builder) и не дублируется.
const SKIP_IN = { 'web-utils': new Set(['apps/web/src/utils/anchorClient.ts']) };

function walk(entry) {
  const full = path.join(ROOT, entry);
  const stat = statSync(full, { throwIfNoEntry: false });
  if (!stat) return [];
  const rel = path.relative(ROOT, full);
  if (IGNORED.some((re) => re.test(rel))) return [];
  if (stat.isFile()) return /\.(ts|tsx|mjs|js|cjs|json)$/.test(full) ? [full] : [];
  const out = [];
  for (const child of readdirSync(full, { withFileTypes: true })) {
    out.push(...walk(path.join(rel, child.name)));
  }
  return out;
}

const camel = (name) => name.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());

function count(files, needles) {
  let hits = 0;
  const where = new Set();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const needle of needles) {
      const matches = text.match(new RegExp(`(?<![A-Za-z0-9_])${needle}(?![A-Za-z0-9_])`, 'g'));
      if (matches) {
        hits += matches.length;
        where.add(path.relative(ROOT, file));
      }
    }
  }
  return { hits, files: [...where].sort() };
}

const idl = JSON.parse(readFileSync(IDL, 'utf8'));
const instructions = idl.instructions.map((ix) => ix.name).sort();

const files = {};
for (const [label, entries] of Object.entries(BUCKETS)) {
  const skip = SKIP_IN[label] ?? new Set();
  files[label] = entries
    .flatMap((entry) => walk(entry))
    .filter((file) => !skip.has(path.relative(ROOT, file)));
}

const rows = instructions.map((name) => {
  const needles = [name, camel(name)];
  const per = {};
  let total = 0;
  const where = new Set();
  for (const [label, list] of Object.entries(files)) {
    const found = count(list, needles);
    per[label] = found.hits;
    total += found.hits;
    found.files.forEach((f) => where.add(f));
  }
  const usage =
    per['web-ui'] > 0
      ? 'есть путь из UI'
      : per['web-utils'] > 0
        ? 'только web-утилиты'
        : per.backend > 0
          ? 'только backend'
          : per.tests > 0 || per.scripts > 0
            ? 'только тесты/скрипты'
            : 'нет ссылок';
  return { name, camel: camel(name), hits: per, total, usage, where: [...where].sort() };
});

const byUsage = (label) => rows.filter((r) => r.usage === label).map((r) => r.name);
// Аннотация GitHub обрезается на ~4 КБ, поэтому в неё идёт сводка без `rows`
// (построчный разбор остаётся в `--json`). Списки имён — самое ценное.
const summary = {
  idl: 'apps/web/src/idl.json',
  instructions: rows.length,
  layerFiles: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length])),
  withUiPath: rows.filter((r) => r.usage === 'есть путь из UI').length,
  uiMissing: byUsage('есть путь из UI').length ? instructions.filter((n) => !byUsage('есть путь из UI').includes(n)) : instructions,
  noWebBuilder: rows.filter((r) => r.hits['web-builder'] === 0).map((r) => r.name),
  noWebRefs: rows.filter((r) => r.hits['web-ui'] + r.hits['web-builder'] + r.hits['web-utils'] === 0).map((r) => r.name),
  onlyWebUtils: byUsage('только web-утилиты'),
  onlyBackend: byUsage('только backend'),
  onlyTestsScripts: byUsage('только тесты/скрипты'),
  unreferenced: byUsage('нет ссылок'),
  note: 'статическая проверка ссылок; имя в коде = ссылка, не гарантия вызова; UI вызывает обёртки utils — отсутствие ссылки в UI-слое не доказывает отсутствия пути; programs/ и idl.json исключены',
};
const payload = { ...summary, rows };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(payload, null, 1));
} else if (process.argv.includes('--annotate')) {
  const escape = (v) => v.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  // Сводка + отдельные аннотации, если список не поместился.
  console.log(`::notice title=ares-usage::${escape(JSON.stringify(summary))}`);
  console.log(
    `Инструкций: ${rows.length}; путь из UI: ${payload.withUiPath}; без ссылок: ${payload.unreferenced.length}`,
  );
} else {
  for (const r of rows) {
    console.log(`${r.name.padEnd(32)} ${String(r.total).padStart(3)} ${r.usage}`);
  }
  console.log(`\nвсего ${rows.length}; путь из UI ${payload.withUiPath}; без упоминаний вне UI ${payload.uiMissing.length}`);
  if (payload.unreferenced.length) console.log(`без ссылок: ${payload.unreferenced.join(', ')}`);
}
