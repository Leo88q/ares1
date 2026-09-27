#!/usr/bin/env node
/**
 * Сканер невидимых символов в исходниках (security checklist item 76).
 *
 * Зачем: скрытая инструкция для ИИ-аудитора или ревьюера прячется в символах,
 * которые не видно в диффе — нулевой ширины, bidi-переопределения, «теговые»
 * символы (U+E0000–U+E007F), мягкий перенос внутри слова. Такой текст читает
 * модель, но не человек. Отдельно: невидимые символы могут «склеивать» разные
 * идентификаторы так, что глазами это не заметно.
 *
 * Использование:
 *   node scripts/check-invisible-unicode.mjs              # все версионируемые файлы
 *   node scripts/check-invisible-unicode.mjs --fix        # удалить найденное
 *   node scripts/check-invisible-unicode.mjs a.ts b.md    # только указанные файлы
 *
 * Exit: 0 — чисто; 1 — найдено (в режиме --fix — если что-то осталось).
 *
 * Порядок работы перед ИИ-аудитом (item 76): прогнать сканер, а затем отдельный
 * проход аудита по коду без README/комментариев (`--strip-comments` у внешних
 * инструментов или ручная выгрузка только кода).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEXT_EXTENSIONS = new Set([
  '.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.py', '.rs', '.sh', '.bash',
  '.yml', '.yaml', '.sql', '.css', '.html', '.toml', '.txt', '.env', '.example', '.lock',
]);
const NAMED_FILES = new Set(['.nvmrc', '.node-version', '.gitignore', '.dockerignore']);

/** Категории с объяснением, почему символ опасен. */
const HIDDEN = [
  { name: 'zero-width', re: /[\u200b\u200c\u200d\u2060\u2061\u2062\u2063\u2064\u180e]/g },
  { name: 'bidi-control', re: /[\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069]/g },
  { name: 'bom/soft-hyphen', re: /[\ufeff\u00ad]/g },
  { name: 'unicode-tag', re: /[\u{e0000}-\u{e007f}]/gu },
  { name: 'other-invisible', re: /[\u061c\u034f\u115f\u1160\u17b4\u17b5\u3164\uffa0]/g },
];

export function scanText(text) {
  const findings = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    for (const { name, re } of HIDDEN) {
      re.lastIndex = 0;
      for (const match of line.matchAll(re)) {
        findings.push({
          line: index + 1,
          column: match.index + 1,
          category: name,
          codePoint: `U+${match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
          context: line.slice(Math.max(0, match.index - 20), match.index + 20),
        });
      }
    }
  }
  return findings;
}

/** Удаляет все невидимые символы (для --fix). */
export function stripHidden(text) {
  let result = text;
  for (const { re } of HIDDEN) result = result.replace(re, '');
  return result;
}

function isTextFile(file) {
  if (NAMED_FILES.has(path.basename(file))) return true;
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).filter(isTextFile);
}

function main(argv) {
  const fix = argv.includes('--fix');
  const targets = argv.filter(arg => !arg.startsWith('--'));
  const files = targets.length ? targets : trackedFiles();
  let total = 0;
  let fixed = 0;
  for (const file of files) {
    const absolute = path.isAbsolute(file) ? file : path.join(ROOT, file);
    let text;
    try {
      text = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    const findings = scanText(text);
    if (!findings.length) continue;
    total += findings.length;
    if (fix) {
      writeFileSync(absolute, stripHidden(text));
      fixed += findings.length;
      console.log(`FIXED ${file}: удалено ${findings.length}`);
      continue;
    }
    for (const finding of findings) {
      console.log(`${file}:${finding.line}:${finding.column} ${finding.category} ${finding.codePoint} :: …${finding.context}…`);
    }
  }
  if (fix) {
    console.log(`Всего удалено невидимых символов: ${fixed}`);
    return 0;
  }
  console.log(total
    ? `Невидимых символов найдено: ${total}. Прогони с --fix или убери вручную.`
    : 'Невидимых символов нет.');
  return total ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, 'check-invisible-unicode.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
