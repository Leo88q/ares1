/**
 * SW016: разбор `init_if_needed`, а не инвентаризация.
 *
 * `scripts/audit-init-if-needed.mjs` пишет в `reports/ares1-audit.json` 27 строк
 * `severity: "review"` — по одной на каждое вхождение токена в исходник, включая
 * комментарии. Такой отчёт нельзя «закрыть»: он не говорит, безопасен ли
 * конкретный контекст, поэтому 27 находок висели со статусом review бесконечно,
 * и следующий читатель отчёта не мог отличить «никто не смотрел» от «смотрели,
 * всё в порядке».
 *
 * Здесь на каждое реальное вхождение (25 аккаунтов в 19 контекстах) есть ответ:
 * почему повторная инициализация безопасна и что именно проверяет Anchor до
 * записи. Тест держит три инварианта разбора:
 *
 *   1. реестр ниже — ПОЛНЫЙ: каждое реальное вхождение покрыто записью, лишних
 *      записей нет (иначе реестр гниёт отдельно от кода);
 *   2. каждое вхождение либо PDA (`seeds` + `bump` + `payer` + `space`), либо
 *      associated-token (адрес выводится из минта и владельца), и у записи есть
 *      осмысленное обоснование;
 *   3. отчёт `reports/ares1-audit.json` помечен как разобранный: инвентарь
 *      остаётся (он ловит новые вхождения), но больше не притворяется списком
 *      неразобранных находок.
 *
 * Опасность `init_if_needed` ровно одна: адрес аккаунта выбирает вызывающий, и
 * «инициализация при необходимости» позволяет завести состояние там, где его не
 * ждут. Поэтому ответ на каждое вхождение — про адресацию, а не про стиль.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const RUST = 'programs/solana_potato/src/lib.rs';

/** Тот же разбор, что в `initIfNeeded.test.ts` (комментарии вырезаны). */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .map(line => {
      const quotes = (line.match(/"/g) ?? []).length;
      const marker = quotes % 2 === 0 ? line.indexOf('//') : -1;
      return marker < 0 ? line : line.slice(0, marker) + ' '.repeat(line.length - marker);
    })
    .join('\n');
}

function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function enclosingStruct(src: string, at: number): string {
  const before = src.slice(0, at);
  let last = '';
  for (const m of before.matchAll(/pub struct (\w+)/g)) last = m[1]!;
  return last;
}

interface Entry { struct: string; account: string; attribute: string; kind: 'pda' | 'ata' }

function collect(source: string): Entry[] {
  const rust = withoutComments(source);
  const found: Entry[] = [];
  for (const match of rust.matchAll(/init_if_needed/g)) {
    const at = match.index!;
    const open = rust.lastIndexOf('#[account(', at);
    assert.ok(open >= 0, `init_if_needed без #[account(...)] на позиции ${at}`);
    const close = matchParen(rust, open + '#[account'.length);
    assert.ok(close > at, 'незакрытый атрибут #[account(...)]');
    const attribute = rust.slice(open, close + 1);
    const account = /pub (\w+):/.exec(rust.slice(close + 1, close + 400))?.[1];
    assert.ok(account, `не найдено имя аккаунта рядом с init_if_needed (${at})`);
    found.push({
      struct: enclosingStruct(rust, open),
      account: account!,
      attribute,
      kind: /associated_token::/.test(attribute) ? 'ata' : 'pda',
    });
  }
  return found;
}

/**
 * Реестр разбора. Ключ — `Контекст.аккаунт`, значение — почему повторная
 * инициализация безопасна.
 *
 * Формулировки про адресацию, а не про «так исторически сложилось»: если
 * атрибут перестанет выводить адрес из seeds/минта, тест ниже упадёт раньше,
 * чем комментарий устареет.
 */
const REVIEWED: Record<string, string> = {
  // ── Токен-аккаунты казны, эскроу и лицензий ────────────────────────────────
  'BatchHarvest.treasury_potato':
    'ATA казны (mint + config PDA): адрес выводится из минта и конфига, а не задаётся вызывающим, поэтому второй «казы» подставить нельзя. Комиссия сбора идёт только на него.',
  'BuyExportLicense.treasury_skr_ata':
    'ATA казны в SKR (mint + treasury_sol PDA). Плата за лицензию уходит на адрес, выведенный программой.',
  'BuyExportLicense.license':
    'PDA [b"license", payer] с bump и space. Один аккаунт на кошелёк: повторная покупка продлевает лицензию, а не создаёт второй аккаунт состояния.',
  'CreateSellOrder.seller_profile':
    'PDA [b"seller", seller] с bump и space, payer — сам продавец. Адрес выведен из подписанта, чужой профиль подставить нельзя.',
  'CreateSellOrder.market_stats':
    'Singleton PDA [b"market_stats"]: один аккаунт статистики на программу, адрес фиксирован seeds.',
  'CreateSellOrderV2.seller_profile':
    'PDA [b"seller", seller] в V2-контексте; тот же вывод адреса, что и в V1-ордере.',
  'CreateSellOrderV2.seller_volume_v2':
    'PDA [b"seller_volume_v2", seller]: счётчик объёма на кошелёк, адрес выводится из подписанта.',
  'CreateSellOrderV2.market_stats_v2':
    'Singleton PDA [b"market_stats_v2"]: один аккаунт статистики V2 на программу.',
  'CancelOrder.seller_profile':
    'PDA [b"seller", seller]: профиль создаётся, если продавец отменяет первый ордер до его появления. Адрес детерминирован.',
  'CancelOrderV2.seller_profile':
    'PDA [b"seller", seller] в V2-контексте; тот же вывод адреса.',
  'FillOrder.treasury_potato':
    'ATA казны в POTATO (mint + config PDA). Комиссия сделки V1 идёт на выведенный адрес казны, а не на переданный вызывающим.',
  'FillOrderV2Skr.treasury_skr_ata':
    'ATA казны в SKR (mint + treasury_sol PDA). Комиссия расчёта уходит только на этот адрес.',
  'FillOrderV2Skr.seller_skr_ata':
    'ATA продавца в SKR (mint + seller): выплата идёт на адрес, выведенный из подписанта ордера, поэтому перенаправить её нельзя.',
  'Harvest.treasury_potato':
    'ATA казны (mint + config PDA); инициализируется тем же вызовом, что и сбор урожая. Адрес казны фиксирован программой.',
  'ClaimAchievement.achievements':
    'PDA [b"achv", user] с bump и space: битовая карта полученных квестов. Один адрес на кошелёк, и он же блокирует повторную выдачу.',

  // ── Пресейл ────────────────────────────────────────────────────────────────
  'BuyFieldSol.buyer_presale':
    'PDA [b"buyer_presale", buyer]: в нём живёт лимит 5 полей на кошелёк, адрес выведен из подписанта.',
  'BuyFieldSkr.buyer_presale':
    'Тот же счётчик, что в SOL-ветке: один адрес на кошелёк, поэтому лимит нельзя обойти сменой валюты покупки.',

  // ── Администрирование и выводы ─────────────────────────────────────────────
  'UpdatePresalePrice.admin_state':
    'Singleton PDA [b"admin_state"]: timelocked-предложения админа. Адрес фиксирован seeds, payer — authority, проверенный has_one на config.',
  'UpdateSkrMint.admin_state':
    'Тот же singleton [b"admin_state"]: повторная инициализация не создаёт второй экземпляр состояния.',
  'ProposeWithdrawal.admin_state':
    'Тот же singleton [b"admin_state"] для предложений выводов; адрес не выбирается вызывающим.',
  'CancelWithdrawal.admin_state':
    'Тот же singleton [b"admin_state"]: отмена не может завести параллельный аккаунт состояния и обойти лимиты.',
  'WithdrawTreasury.admin_state':
    'Тот же singleton [b"admin_state"]: rate-limit и timelock выводов POTATO. Один аккаунт на программу.',
  'WithdrawTreasurySol.admin_state':
    'Тот же singleton [b"admin_state"] для SOL-выводов: лимиты общие, вторым аккаунтом их не обойти.',
  'WithdrawSkrTreasury.admin_state':
    'Тот же singleton [b"admin_state"] для SKR-выводов: адрес фиксирован, лимиты едины для всех валют.',
  'WithdrawSkrTreasury.destination_ata':
    'ATA получателя с authority = authority (signer): адрес выведен из минта и подписанта, поэтому вывод нельзя перенаправить на чужой токен-аккаунт.',
};

const source = readFileSync(RUST, 'utf8');
const entries = collect(source);
const keyOf = (entry: Entry): string => `${entry.struct}.${entry.account}`;

test('реестр разбора SW016 полный: каждое реальное вхождение объяснено, лишних нет', () => {
  const seen = entries.map(keyOf).sort();
  const reviewed = Object.keys(REVIEWED).sort();
  const unreviewed = seen.filter(key => !(key in REVIEWED));
  const stale = reviewed.filter(key => !seen.includes(key));
  assert.deepEqual(unreviewed, [], `новые init_if_needed без разбора: ${unreviewed.join(', ')}`);
  assert.deepEqual(stale, [], `записи реестра без вхождения в коде (устарели): ${stale.join(', ')}`);
  // Пиним количество: 25 аккаунтов в 19 контекстах на 2026-11-05.
  assert.equal(entries.length, 25, `найдено ${entries.length} вхождений`);
  assert.equal(new Set(entries.map(e => e.struct)).size, 19);
});

test('каждое вхождение адресуется PDA или associated-token, и обоснование не пустое', () => {
  for (const entry of entries) {
    const reason = REVIEWED[keyOf(entry)];
    assert.ok(reason && reason.length > 40, `${keyOf(entry)}: обоснование должно объяснять адресацию`);
    if (entry.kind === 'pda') {
      for (const required of ['seeds', 'bump', 'payer', 'space']) {
        assert.match(entry.attribute, new RegExp(`\\b${required}\\b`), `${keyOf(entry)}: PDA без ${required}`);
      }
    } else {
      assert.match(entry.attribute, /associated_token::mint/);
      assert.match(entry.attribute, /associated_token::authority/);
    }
  }
});

test('обоснования говорят про адрес, а не «оставлено как есть»', () => {
  for (const [key, reason] of Object.entries(REVIEWED)) {
    assert.match(reason, /адрес|ATA|PDA|singleton/i, `${key}: обоснование без упоминания адресации`);
    assert.doesNotMatch(reason, /легаси|исторически|пока оставили/i, `${key}: обоснование-отписка`);
  }
});

test('отчёт SW016 помечен как разобранный, а не как список нерешённых находок', () => {
  const report = JSON.parse(readFileSync('../reports/ares1-audit.json', 'utf8')) as {
    findings: { severity?: string; rule_id?: string }[];
    review?: { status?: string; reviewedAt?: string; where?: string; openFindings?: number };
  };
  const inventory = report.findings.filter(f => f.rule_id === 'SW016-source-inventory');
  assert.ok(inventory.length > 0, 'inventory must stay: it is how a NEW init_if_needed gets noticed');
  assert.ok(inventory.every(f => f.severity === 'review'), 'inventory rows stay review-level by design');
  assert.ok(report.review, 'report must carry the review decision, otherwise review-level rows look unowned');
  assert.equal(report.review?.status, 'reviewed');
  assert.equal(report.review?.openFindings, 0);
  assert.match(String(report.review?.where), /initIfNeededReview\.test\.ts/);
  assert.match(String(report.review?.reviewedAt), /^\d{4}-\d{2}-\d{2}$/);
});
