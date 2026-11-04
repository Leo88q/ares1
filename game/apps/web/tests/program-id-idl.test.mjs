// Адрес программы живёт в бандле дважды: `src/idl.json` (генерируется `anchor
// build`) и `VITE_PROGRAM_ID` (окружение сборки / .env.example по умолчанию).
// Если они разошлись, клиент разрешает инструкции ДВУМ программам: нашей и той,
// что записана в IDL (allowlist в utils/txSafety.ts строится из idl.address).
// Сборка такую рассинхронизацию ломает (vite.config.ts), здесь — дешёвая
// проверка на уровне репозитория, которая сработает до любой сборки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const idl = JSON.parse(readFileSync(join(root, 'src', 'idl.json'), 'utf8'));

function envExample() {
  const parsed = {};
  for (const rawLine of readFileSync(join(root, '.env.example'), 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    parsed[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return parsed;
}

test('IDL содержит адрес программы', () => {
  assert.match(idl.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});

test('VITE_PROGRAM_ID по умолчанию совпадает с адресом из IDL', () => {
  const configured = envExample().VITE_PROGRAM_ID;
  assert.ok(configured, 'в .env.example обязан быть VITE_PROGRAM_ID — иначе сборка без окружения не знает адрес');
  assert.equal(
    configured,
    idl.address,
    'IDL и .env.example разошлись: клиент разрешил бы инструкции двух программ',
  );
});

test('клиент сверяет IDL и VITE_PROGRAM_ID на старте', () => {
  const source = readFileSync(join(root, 'src', 'contexts', 'SolanaContext.tsx'), 'utf8');
  assert.match(source, /idl\.address !== rawProgramId/, 'нет runtime-проверки соответствия IDL и PROGRAM_ID');
});
