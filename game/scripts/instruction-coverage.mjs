#!/usr/bin/env node
/**
 * instruction-coverage — статические упоминания инструкций по слоям клиента.
 *
 * Зачем (Этап 2): помогает найти кандидатов для проверки, но не доказывает,
 * что instruction действительно вызывается в runtime. Скрипт читает клиентский
 * IDL (`apps/web/src/idl.json`, sha256 сверяется в Этапе 0) и ищет каждое имя
 * отдельно по UI web, builder, утилитам, backend, тестам и скриптам. Программа
 * (`programs/`) намеренно не считается: там инструкции определены, а не вызваны.
 *
 * Ограничения (печатаются в отчёте вместе с цифрами):
 *   - это СТАТИЧЕСКАЯ проверка ссылок, а не on-chain покрытие: инструкция,
 *     вызываемая внешним клиентом или из консоли, здесь выглядит «не
 *     вызываемой»;
 *   - idl.json и автогенерированные types/** исключены — иначе весь ABI
 *     «используется» самим собой;
 *   - комментарии удаляются перед поиском, строки сохраняются; совпадение по
 *     границам идентификатора: `grant_reward` не засчитывается за
 *     `grant_reward_once`;
 *   - имя встречается в строке/коде — это статическое упоминание, а не гарантия
 *     рабочего пути вызова; динамические и внешние вызовы не видны.
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

// Ignore comments without stripping quoted strings: an instruction name in a
// discriminator string is useful evidence, while a prose comment is not a
// source reference. Preserve newlines so diagnostics keep stable line numbers.
function stripComments(source) {
  let out = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'line') {
      if (ch === '\n' || ch === '\r') {
        out += ch;
        state = 'code';
      } else out += ' ';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        out += '  ';
        i += 1;
        state = 'code';
      } else out += ch === '\n' || ch === '\r' ? ch : ' ';
      continue;
    }
    if (state === 'string') {
      out += ch;
      if (ch === '\\' && i + 1 < source.length) out += source[++i];
      else if (ch === quote) state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') {
      out += '  ';
      i += 1;
      state = 'line';
    } else if (ch === '/' && next === '*') {
      out += '  ';
      i += 1;
      state = 'block';
    } else {
      out += ch;
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        state = 'string';
      }
    }
  }
  return out;
}

const sourceCache = new Map();
function sourceWithoutComments(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, stripComments(readFileSync(file, 'utf8')));
  return sourceCache.get(file);
}

function count(files, needles) {
  let hits = 0;
  const where = new Set();
  for (const file of files) {
    const text = sourceWithoutComments(file);
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
  const usage = Object.entries(per).filter(([, hits]) => hits > 0).map(([label]) => label);
  return { name, camel: camel(name), hits: per, total, usage, where: [...where].sort() };
});

const layers = Object.keys(files);
const onlyLayers = (included) => rows
  .filter((r) => included.some((layer) => r.hits[layer] > 0))
  .filter((r) => layers.every((layer) => included.includes(layer) || r.hits[layer] === 0))
  .map((r) => r.name);
const uiRefs = rows.filter((r) => r.hits['web-ui'] > 0);
const summary = {
  idl: 'apps/web/src/idl.json',
  instructions: rows.length,
  layerFiles: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length])),
  layerInstructionCounts: Object.fromEntries(
    layers.map((layer) => [layer, rows.filter((r) => r.hits[layer] > 0).length]),
  ),
  withUiPath: uiRefs.length,
  uiMissing: rows.filter((r) => r.hits['web-ui'] === 0).map((r) => r.name),
  noWebBuilder: rows.filter((r) => r.hits['web-builder'] === 0).map((r) => r.name),
  noWebRefs: rows.filter((r) => r.hits['web-ui'] + r.hits['web-builder'] + r.hits['web-utils'] === 0).map((r) => r.name),
  onlyWebUtils: onlyLayers(['web-utils']),
  onlyBuilder: onlyLayers(['web-builder']),
  onlyBackend: onlyLayers(['backend']),
  onlyTestsScripts: onlyLayers(['tests', 'scripts']),
  unreferenced: rows.filter((r) => r.total === 0).map((r) => r.name),
  note: 'статическая лексическая проверка имён по слоям; комментарии исключены, строки сохраняются; упоминание не доказывает runtime-вызов, динамические/внешние вызовы могут не обнаружиться; UI и web-builder считаются отдельно; programs/ и idl.json исключены',
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
    console.log(`${r.name.padEnd(32)} ${String(r.total).padStart(3)} ${r.usage.length ? r.usage.join(', ') : 'нет ссылок'}`);
  }
  console.log(`\nвсего ${rows.length}; прямые UI-упоминания ${payload.withUiPath}; без ссылок в любой слой ${payload.unreferenced.length}`);
  if (payload.unreferenced.length) console.log(`без ссылок: ${payload.unreferenced.join(', ')}`);
}
