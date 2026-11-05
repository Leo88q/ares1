#!/usr/bin/env node
/**
 * Гейт процедуры ротации ключей (S-01).
 *
 * Скан истории (`scripts/secret-scan-history.mjs`) красный, пока ключ не отозван.
 * Этот тест держит саму процедуру, чтобы «зелёный CI» нельзя было получить
 * неправильным способом:
 *
 *   1. реестр `.secret-rotation-status.json` существует, парсится и содержит
 *      запись S-01 с путём и правилом;
 *   2. ключ нельзя «забыть» в allowlist — запись `NOT ALLOWLISTED` обязана
 *      оставаться, иначе утечка превращается в разрешённую;
 *   3. сканер читает реестр: строка `revoked=false` — красный, `revoked-at=…` —
 *      путь пропускается;
 *   4. процедура описана (docs/SECRET_ROTATION.md) и workflow на неё ссылается.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));

test('реестр ротаций описывает S-01 и не содержит самого ключа', () => {
  assert.ok(existsSync(path.join(root, '.secret-rotation-status.json')));
  const registry = json('.secret-rotation-status.json');
  const entry = registry['S-01'];
  assert.ok(entry, 'S-01 must stay tracked: a revocation nobody records is a forgotten leak');
  assert.equal(entry.rule, 'helius-key-in-url');
  assert.equal(entry.historicalPath, 'game/apps/web/.env.production');
  assert.match(entry.status, /^(revoked=false|revoked-at=\d{4}-\d{2}-\d{2}.*|no-longer-valid)$/);
  // В реестре не должно быть ничего, похожего на ключ: он сканируется тем же сканером.
  const raw = read('.secret-rotation-status.json');
  assert.doesNotMatch(raw, /helius-rpc\.com\/\?api-key=/i);
  assert.doesNotMatch(raw, /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
});

test('ключ НЕ в allowlist: утечка остаётся утечкой до отзыва', () => {
  const allowlist = json('.secret-scan-allowlist.json');
  const entry = allowlist['helius-key-in-url']?.['game/apps/web/.env.production'];
  assert.ok(entry, 'the historical path must stay listed with an explicit reason');
  assert.match(entry, /NOT ALLOWLISTED/);
  assert.match(entry, /Revoke\/rotate/i);
});

test('сканер читает реестр: revoked=false — находка, revoked-at=… — пропуск', () => {
  const scanner = read('scripts/secret-scan-history.mjs');
  assert.match(scanner, /ROTATION_FILE = '\.secret-rotation-status\.json'/);
  assert.match(scanner, /const remediationOf = \(ruleId, p\)/);
  // Дата обязательна: слово «revoked» без даты не должно закрывать гейт.
  assert.match(scanner, /revoked-at=/);
  // В исходнике сканера регулярка записана буквально, поэтому ищем её текст.
  assert.ok(scanner.includes('revoked-at=\\d{4}-\\d{2}-\\d{2}'), 'scanner must require an ISO date, not the bare word revoked');
  assert.match(scanner, /status === 'no-longer-valid'/);
  // Известная обязанность: запись ротации обязана быть в выводе, а не только в коде.
  assert.match(scanner, /rotation \$\{id\}/);
});

test('процедура описана и workflow на неё ссылается', () => {
  const doc = read('docs/SECRET_ROTATION.md');
  for (const step of ['Отозвать ключ', 'revoked-at=', 'git fetch --unshallow origin']) {
    assert.ok(doc.includes(step), `SECRET_ROTATION.md must describe: ${step}`);
  }
  const workflow = read('.github/workflows/security.yml');
  assert.match(workflow, /docs\/SECRET_ROTATION\.md/);
  assert.match(workflow, /\.secret-rotation-status\.json/);
});

test('реестр читается скриптом в dry-run: JSON валиден для Node', () => {
  // Отдельная проверка на «файл поправили руками и забыли запятую»: сканер
  // падает на старте с невнятной ошибкой, если JSON битый.
  const out = execFileSync(process.execPath, ['-e', `
    const fs = require('fs');
    const r = JSON.parse(fs.readFileSync('.secret-rotation-status.json', 'utf8'));
    const pending = Object.entries(r).filter(([k, v]) => !k.startsWith('$') && v && v.rule && v.status === 'revoked=false');
    console.log(pending.map(([k]) => k).join(','));
  `], { cwd: root }).toString().trim();
  // Пока ключ не отозван — запись обязана быть в pending (это и есть сигнал).
  assert.equal(out, 'S-01');
});
