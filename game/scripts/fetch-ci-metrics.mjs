// Читает аннотации `ares-*` измерительного workflow `rent-audit` для ТОЧНОЙ
// текущей ревизии. Логи и артефакты CI недоступны из API-only окружений
// (Приложение B.4), поэтому единственный читаемый канал — check-аннотации.
//
// Использование:
//   node scripts/fetch-ci-metrics.mjs                 # HEAD, обязательный набор
//   node scripts/fetch-ci-metrics.mjs --sha <sha>
//   node scripts/fetch-ci-metrics.mjs --require ares-rate,ares-so-z
//   node scripts/fetch-ci-metrics.mjs --json
//
// Exit: 0 — все обязательные аннотации есть; 1 — чего-то нет или ревизия не та.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const game = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'Leo88q/ares1';
const JOB_PREFIX = 'Rent audit:';
const DEFAULT_REQUIRED = ['ares-rate', 'ares-program', 'ares-deployer', 'ares-accounts', 'ares-so-base'];

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const asJson = argv.includes('--json');
const sha = flag('--sha') ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: game, encoding: 'utf8' }).trim();
const required = (flag('--require') ?? DEFAULT_REQUIRED.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const api = (route) => JSON.parse(execFileSync('gh', ['api', route], { cwd: game, encoding: 'utf8', maxBuffer: 20_000_000 }));

const checks = api(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).check_runs
  .filter((c) => c.name.startsWith(JOB_PREFIX))
  .filter((c) => c.head_sha === sha);
if (checks.length === 0) {
  console.error(`Нет check-run'ов "${JOB_PREFIX}*" для ${sha}. Workflow rent-audit не стартовал или ещё не создал job'ы.`);
  process.exit(1);
}

const annotations = [];
for (const check of checks) {
  if (check.status !== 'completed') {
    console.error(`check-run ${check.id} («${check.name}») ещё не завершён: status=${check.status}. Подожди и повтори.`);
    process.exit(1);
  }
  for (let page = 1; page <= 20; page++) {
    const batch = api(`repos/${repo}/check-runs/${check.id}/annotations?per_page=100&page=${page}`);
    for (const a of batch) annotations.push({ ...a, checkId: check.id, job: check.name, headSha: check.head_sha });
    if (batch.length < 100) break;
    if (page === 20) throw new Error('Слишком много аннотаций check-run');
  }
}

const metrics = new Map();
for (const a of annotations) {
  if (!a.title?.startsWith('ares-')) continue;
  if (metrics.has(a.title)) {
    console.error(`Дубль аннотации ${a.title} (job ${a.job}); ожидалось по одной на ключ.`);
    process.exit(1);
  }
  let parsed = a.message;
  if (a.message.trim().startsWith('{')) {
    try {
      parsed = JSON.parse(a.message);
    } catch (error) {
      console.error(`Аннотация ${a.title} не разбирается как JSON: ${error.message}`);
      process.exit(1);
    }
  }
  metrics.set(a.title, { value: parsed, job: a.job, checkId: a.checkId, headSha: a.headSha });
}

if (asJson) {
  console.log(JSON.stringify({ sha, checks: checks.map((c) => ({ id: c.id, name: c.name, conclusion: c.conclusion })), metrics: Object.fromEntries(metrics) }, null, 2));
} else {
  console.log(`Ревизия ${sha}`);
  for (const check of checks) console.log(`  job ${check.name}: ${check.conclusion} (check-run ${check.id})`);
  console.log('');
  const width = Math.max(...[...metrics.keys()].map((k) => k.length), 10);
  for (const [title, { value }] of metrics) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    console.log(`${title.padEnd(width)}  ${text}`);
  }
}

const missing = required.filter((key) => !metrics.has(key));
if (missing.length > 0) {
  console.error(`\nОТСУТСТВУЮТ обязательные аннотации: ${missing.join(', ')}`);
  process.exit(1);
}

const unmeasured = [...metrics.entries()]
  .filter(([, { value }]) => value && typeof value === 'object' && value.measured === false)
  .map(([key]) => key);
if (unmeasured.length > 0) {
  console.error(`\nВНИМАНИЕ: аннотации без измерения (НЕ ИЗМЕРЕНО): ${unmeasured.join(', ')} — причина в поле reason.`);
}
