/**
 * Phase 1 presale: каталог, верификация платежа, сверка.
 *
 * Все три модуля чистые, поэтому тесты не требуют ни Postgres, ни ноды.
 * Отдельно закреплён текстовый пин ончейн-констант: каталог обещает покупателю
 * выдачу, а выдачу ограничивает программа. Если lib.rs изменится, а зеркало
 * здесь — нет, тест упадёт вместо того, чтобы мы продали невыдаваемое.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_REWARD_MICRO,
  BASE_FIELD_PRICE_MICRO,
  MAX_DAILY_CAP_MICRO,
  MAX_REWARD_EXPIRY_SECONDS,
  PACKS,
  findPack,
  fieldPriceMicro,
  packPotatoMicro,
  packFieldCount,
  validatePackDeliverability,
  packsPerDay,
  deliveryDays,
  dailyGrantQuotaMicro,
  expectedUnits,
  orderNoFromUnits,
  CURRENCIES,
  SKR_DECIMALS,
  toUnits,
  currencySpec,
  assertDustIsNegligible,
} from '../src/presale/catalog.js';
import { verifyPayment, treasuryInflow, verifyTokenPayment, tokenInflow } from '../src/presale/verify.js';
import type { ChainTransferView, ChainTokenTransferView, TokenBalanceView } from '../src/presale/verify.js';
import { reconcile, payersFromChain } from '../src/presale/reconcile.js';
import type { ChainTransfer, DbOrderRecord } from '../src/presale/reconcile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// tests/ → backend/ → apps/ → game/, оттуда programs/solana_potato/src/lib.rs
const libRs = fs.readFileSync(path.resolve(here, '../../../programs/solana_potato/src/lib.rs'), 'utf8');

const MICRO = 1_000_000n; // 1 POTATO в микро (6 знаков)

// ─────────────────────────────────────────────────────────────────────────────
// Пин ончейн-констант
// ─────────────────────────────────────────────────────────────────────────────

function pinConstant(name: string, expected: bigint): void {
  const match = libRs.match(new RegExp(`pub const ${name}: (?:u64|i64) = ([0-9_]+)`));
  assert.ok(match, `в lib.rs не найден pub const ${name}`);
  const value = BigInt(match[1].replace(/_/g, ''));
  assert.equal(value, expected, `lib.rs:${name} разошёлся с зеркалом в presale/catalog.ts`);
}

test('зеркало ончейн-констант совпадает с lib.rs', () => {
  pinConstant('MAX_REWARD_MICRO', MAX_REWARD_MICRO);
  pinConstant('BASE_FIELD_PRICE_MICRO', BASE_FIELD_PRICE_MICRO);
  pinConstant('MAX_DAILY_CAP_MICRO', MAX_DAILY_CAP_MICRO);
  pinConstant('MAX_REWARD_EXPIRY_SECONDS', MAX_REWARD_EXPIRY_SECONDS);
});

test('множители цены по типу поля совпадают с type_cost_bps', () => {
  const body = libRs.match(/pub fn type_cost_bps[\s\S]*?\n}/);
  assert.ok(body, 'в lib.rs не найден type_cost_bps');
  const arms = body[0];

  // 0 и 1 — именованные ветки.
  for (const [type, bps] of [[0, 4_000n], [1, 10_000n]] as const) {
    const arm = arms.match(new RegExp(`\\b${type} => ([0-9_]+)`));
    assert.ok(arm, `в type_cost_bps нет ветки для типа ${type}`);
    assert.equal(BigInt(arm[1].replace(/_/g, '')), bps, `type_cost_bps(${type}) разошёлся`);
  }

  // Тип 2 в программе — НЕ именованная ветка, а catch-all `_ => 20_000`:
  // любой field_type ≥ 2 стоит 2×. Зеркало в catalog.ts намеренно строже —
  // оно знает только 0/1/2 и отклоняет остальное, потому что продавать
  // «тип 7» мы не собираемся, а молча оценить его как Поле было бы ошибкой.
  // Этот пин ловит случай, когда в программе появится именованная ветка 2 =>
  // с другим множителем: тогда зеркало придётся расширить, а не оставить как есть.
  const catchAll = arms.match(/_ => ([0-9_]+)/);
  assert.ok(catchAll, 'в type_cost_bps исчезла catch-all ветка — проверь, не появились ли именованные типы');
  assert.equal(BigInt(catchAll[1].replace(/_/g, '')), 20_000n,
    'catch-all множитель type_cost_bps изменился: каталог паков нужно пересчитать');
});

// ─────────────────────────────────────────────────────────────────────────────
// Каталог
// ─────────────────────────────────────────────────────────────────────────────

test('цены полей: Грядка 100, Луг 250, Поле 500 POTATO', () => {
  assert.equal(fieldPriceMicro(0), 100n * MICRO);
  assert.equal(fieldPriceMicro(1), 250n * MICRO);
  assert.equal(fieldPriceMicro(2), 500n * MICRO);
  assert.throws(() => fieldPriceMicro(3), /Неизвестный тип поля/);
});

test('каждый пак каталога выдаваем одной выдачей', () => {
  assert.ok(PACKS.length > 0, 'каталог не должен быть пустым');
  const ids = new Set<string>();
  for (const pack of PACKS) {
    assert.ok(!ids.has(pack.id), `дубль id пака: ${pack.id}`);
    ids.add(pack.id);
    assert.deepEqual(validatePackDeliverability(pack), [], `пак ${pack.id} невыдаваем`);
    assert.equal(findPack(pack.id)?.id, pack.id);
    // Ровно потолок выдачи: составы подобраны так, чтобы вычерпывать грант
    // целиком — иначе рельса тратит квоту впустую.
    assert.equal(packPotatoMicro(pack), MAX_REWARD_MICRO,
      `пак ${pack.id}: ожидалось ровно ${MAX_REWARD_MICRO} микро (потолок одной выдачи)`);
  }
  assert.equal(findPack('нет-такого'), null);
});

test('пак сверх потолка выдачи отклоняется с внятной причиной', () => {
  const tooBig = { fields: [{ type: 1, count: 5 }] }; // 1250 POTATO > 1000
  const problems = validatePackDeliverability(tooBig);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /потолок одной выдачи/);
  assert.match(problems[0], /deploy/);

  const badType = { fields: [{ type: 9, count: 1 }] };
  assert.ok(validatePackDeliverability(badType).some(p => /неизвестный тип поля 9/.test(p)));

  // count=0 — это «некорректное количество», и валидатор на нём останавливается,
  // не доходя до расчёта суммы. Ровно пустой список полей — отдельный случай.
  const zeroCount = validatePackDeliverability({ fields: [{ type: 1, count: 0 }] });
  assert.ok(zeroCount.some(p => /некорректное количество для типа 1/.test(p)));
  const emptyProblems = validatePackDeliverability({ fields: [] });
  assert.deepEqual(emptyProblems, ['пустой состав: выдавать нечего']);
});

test('квота выдачи — физика, а не настройка: 25 000 POTATO в сутки, 25 паков', () => {
  // 10 % от капа эпохи 250 000 POTATO.
  assert.equal(dailyGrantQuotaMicro(), 25_000n * MICRO);
  for (const pack of PACKS) {
    assert.equal(packsPerDay(pack), 25, `пак ${pack.id}: ожидалось 25 паков в сутки`);
  }
  // Тираж в 100 паков физически выдаётся за 4 суток, а не за день.
  assert.equal(deliveryDays(PACKS[0], 100), 4);
  assert.equal(deliveryDays(PACKS[0], 25), 1);
  // 26 паков — уже двое суток: округление вверх, обещать «1 день» было бы враньём.
  assert.equal(deliveryDays(PACKS[0], 26), 2);
  assert.equal(deliveryDays({ fields: [] }, 10), Number.POSITIVE_INFINITY);
});

test('lamport-пыль: сумма уникальна на заказ и обратима', () => {
  const base = 500_000_000n; // 0.5 SOL
  assert.equal(expectedUnits(base, 1), base + 1n);
  assert.equal(expectedUnits(base, 17), base + 17n);
  // Разные номера ⇒ разные суммы: в этом и состоит автопривязка.
  assert.notEqual(expectedUnits(base, 1), expectedUnits(base, 2));

  for (const orderNo of [1, 2, 17, 999]) {
    assert.equal(orderNoFromUnits(base, expectedUnits(base, orderNo)), orderNo);
  }
  // Меньше базы — не наш платёж.
  assert.equal(orderNoFromUnits(base, base - 1n), 0);
  assert.equal(orderNoFromUnits(base, base), 0);

  assert.throws(() => expectedUnits(0n, 1), /больше 0/);
  assert.throws(() => expectedUnits(base, 0), /целым > 0/);
  assert.throws(() => expectedUnits(base, 1.5), /целым > 0/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Верификация платежа
// ─────────────────────────────────────────────────────────────────────────────

const TREASURY = 'Treasury1111111111111111111111111111111111111';
const PAYER = 'Payer1111111111111111111111111111111111111111';
const STRANGER = 'Stranger11111111111111111111111111111111111111';
const FEE = 5_000n;

function view(overrides: Partial<ChainTransferView> = {}): ChainTransferView {
  return {
    signature: 'sig1111111111111111111111111111111111111111111111111111111111111',
    slot: 100n,
    blockTime: 1_800_000_000n,
    err: null,
    accountKeys: [PAYER, TREASURY],
    preBalances: [1_000_000_000n, 0n],
    postBalances: [1_000_000_000n - 500_000_017n - FEE, 500_000_017n],
    confirmation: 'finalized',
    ...overrides,
  };
}

const EXPECT = { treasury: TREASURY, expectedLamports: 500_000_017n, payerWallet: PAYER };

test('точный платёж в финализированной транзакции засчитывается', () => {
  const verdict = verifyPayment(view(), EXPECT);
  assert.equal(verdict.code, 'OK');
  assert.equal(verdict.ok, true);
  assert.equal(verdict.needsManualReview, false);
  assert.equal(verdict.receivedUnits, 500_000_017n);
  assert.equal(verdict.slot, 100n);
});

test('комиссия сети не ломает проверку плательщика', () => {
  // Плательщик теряет перевод + fee, до казначейства доходит только перевод.
  const verdict = verifyPayment(view(), EXPECT);
  assert.equal(verdict.code, 'OK', 'fee списывается сверх перевода и не должен выглядеть недоплатой');
});

test('нефинализированная транзакция не засчитывается', () => {
  for (const confirmation of ['processed', 'confirmed'] as const) {
    const verdict = verifyPayment(view({ confirmation }), EXPECT);
    assert.equal(verdict.code, 'NOT_FINALIZED');
    assert.equal(verdict.ok, false);
    assert.equal(verdict.needsManualReview, false, 'это не инцидент, а «подождать»');
  }
});

test('упавшая транзакция не засчитывается, даже если в ней был перевод', () => {
  const verdict = verifyPayment(view({ err: { InstructionError: [0, 'Custom'] } }), EXPECT);
  assert.equal(verdict.code, 'TX_FAILED');
  assert.equal(verdict.ok, false);
});

test('транзакция без казначейства отклоняется', () => {
  const verdict = verifyPayment(
    view({ accountKeys: [PAYER, STRANGER], postBalances: [0n, 500_000_017n], preBalances: [500_000_017n, 0n] }),
    EXPECT,
  );
  assert.equal(verdict.code, 'TREASURY_NOT_INVOLVED');
});

test('перевод без притока к казначейству отклоняется', () => {
  const verdict = verifyPayment(
    view({ preBalances: [1_000_000_000n, 500_000_017n], postBalances: [999_995_000n, 500_000_017n] }),
    EXPECT,
  );
  assert.equal(verdict.code, 'NO_INFLOW');
});

test('недоплата уходит в ручную очередь, а не теряется', () => {
  const short = 500_000_016n;
  const verdict = verifyPayment(
    view({ postBalances: [1_000_000_000n - short - FEE, short] }),
    EXPECT,
  );
  assert.equal(verdict.code, 'AMOUNT_SHORT');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.needsManualReview, true, 'деньги пришли — оператор обязан их увидеть');
  assert.equal(verdict.receivedUnits, short);
});

test('переплата не округляется до нужной суммы', () => {
  const over = 500_000_018n;
  const verdict = verifyPayment(
    view({ postBalances: [1_000_000_000n - over - FEE, over] }),
    EXPECT,
  );
  assert.equal(verdict.code, 'AMOUNT_OVERPAID');
  assert.equal(verdict.needsManualReview, true);
});

test('платёж не от покупателя отклоняется', () => {
  // Кошелёк покупателя вообще не в транзакции.
  const absent = verifyPayment(
    view({ accountKeys: [STRANGER, TREASURY], preBalances: [1_000_000_000n, 0n],
           postBalances: [1_000_000_000n - 500_000_017n - FEE, 500_000_017n] }),
    EXPECT,
  );
  assert.equal(absent.code, 'PAYER_MISMATCH');
  assert.equal(absent.needsManualReview, true);

  // Кошелёк в транзакции есть, но ничего не потерял — деньги пришли не с него.
  const passive = verifyPayment(
    view({ accountKeys: [STRANGER, TREASURY, PAYER],
           preBalances: [1_000_000_000n, 0n, 777n],
           postBalances: [1_000_000_000n - 500_000_017n - FEE, 500_000_017n, 777n] }),
    EXPECT,
  );
  assert.equal(passive.code, 'PAYER_MISMATCH');
});

test('древняя транзакция не принимается за текущий заказ', () => {
  const verdict = verifyPayment(view({ blockTime: 1_000n }), { ...EXPECT, minBlockTime: 1_700_000_000n });
  assert.equal(verdict.code, 'TOO_OLD');
  assert.equal(verdict.needsManualReview, true);

  // Без blockTime возраст непроверяем — тоже в ручную очередь.
  const noTime = verifyPayment(view({ blockTime: null }), { ...EXPECT, minBlockTime: 1_700_000_000n });
  assert.equal(noTime.code, 'TOO_OLD');
});

test('treasuryInflow берёт индекс из accountKeys, а не «первый похожий»', () => {
  const v = view({ accountKeys: [PAYER, STRANGER, TREASURY],
                   preBalances: [10n, 20n, 30n], postBalances: [5n, 20n, 30n + 100n] });
  assert.deepEqual(treasuryInflow(v, TREASURY), { index: 2, received: 100n });
  assert.equal(treasuryInflow(v, STRANGER)?.received, 0n);
  assert.equal(treasuryInflow(view(), 'NotInTransaction11111111111111111111111111'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Сверка
// ─────────────────────────────────────────────────────────────────────────────

const chain = (over: Partial<ChainTransfer> = {}): ChainTransfer => ({
  signature: 'sigA', fromWallet: PAYER, units: 500_000_017n, slot: 100n, blockTime: 1_800_000_000n,
  ...over,
});
const order = (over: Partial<DbOrderRecord> = {}): DbOrderRecord => ({
  order_no: 17, tx_signature: 'sigA', received_units: 500_000_017n, state: 'paid', payer_wallet: PAYER,
  ...over,
});

test('чистая сверка: цепь и БД сходятся', () => {
  const report = reconcile([chain()], [order()]);
  assert.equal(report.ok, true);
  assert.equal(report.matchedCount, 1);
  assert.deepEqual(report.chainOnly, []);
  assert.deepEqual(report.dbOnly, []);
});

test('деньги без заказа — инцидент, а не шум', () => {
  const report = reconcile([chain()], []);
  assert.equal(report.ok, false);
  assert.equal(report.chainOnly.length, 1);
  assert.equal(report.chainOnly[0].signature, 'sigA');
});

test('заказ без платежа в цепи — инцидент (мы бы выдали пак без денег)', () => {
  const report = reconcile([], [order()]);
  assert.equal(report.ok, false);
  assert.equal(report.dbOnly.length, 1);
  assert.equal(report.dbOnly[0].order_no, 17);
});

test('неоплаченный заказ без подписи не считается расхождением', () => {
  const report = reconcile([], [order({ tx_signature: null, received_units: null, state: 'reserved' })]);
  assert.equal(report.ok, true);
  assert.deepEqual(report.dbOnly, []);
});

test('расхождение суммы и кошелька ловятся отдельно', () => {
  const amount = reconcile([chain({ units: 999n })], [order()]);
  assert.equal(amount.ok, false);
  assert.equal(amount.amountMismatch.length, 1);
  assert.equal(amount.amountMismatch[0].chainUnits, 999n);

  const wallet = reconcile([chain({ fromWallet: STRANGER })], [order()]);
  assert.equal(wallet.ok, false);
  assert.equal(wallet.walletMismatch.length, 1);
});

test('одна подпись на два заказа — расхождение', () => {
  const report = reconcile([chain()], [order(), order({ order_no: 18 })]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.duplicateSignature, [{ signature: 'sigA', orderNos: [17, 18] }]);
});

test('повтор подписи в самой истории кошельца роняет сверку', () => {
  assert.throws(() => reconcile([chain(), chain()], []), /повтор подписи/);
});

test('список плательщиков восстанавливается из одной истории кошелька', () => {
  const transfers = [
    chain({ signature: 'sigA', fromWallet: PAYER, units: 500_000_017n }),
    chain({ signature: 'sigB', fromWallet: PAYER, units: 500_000_018n }),
    chain({ signature: 'sigC', fromWallet: STRANGER, units: 900_000_000n }),
  ];
  const payers = payersFromChain(transfers);
  assert.equal(payers.length, 2);
  // Сортировка по убыванию суммы: PAYER суммарно 1_000_000_035 > 900_000_000.
  assert.equal(payers[0].fromWallet, PAYER);
  assert.equal(payers[0].transfers, 2);
  assert.equal(payers[0].totalUnits, 1_000_000_035n);
  assert.deepEqual(payers[0].signatures, ['sigA', 'sigB']);
  assert.equal(payers[1].fromWallet, STRANGER);
  assert.deepEqual(payersFromChain([]), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Валюты: SOL и SKR
// ─────────────────────────────────────────────────────────────────────────────

test('разрядность валют зафиксирована: SOL 10^9, SKR 10^6', () => {
  assert.equal(CURRENCIES.sol.decimals, 9);
  assert.equal(CURRENCIES.skr.decimals, 6);
  assert.equal(CURRENCIES.skr.unitsPerWhole, 1_000_000n);
  assert.equal(CURRENCIES.sol.unitsPerWhole, 1_000_000_000n);
  // Пин против lib.rs:167 — именно здесь живёт ошибка «съехали на 10^k».
  const dec = libRs.match(/pub const SKR_DECIMALS: u8 = (\d+)/);
  assert.ok(dec, 'в lib.rs не найден SKR_DECIMALS');
  assert.equal(Number(dec[1]), SKR_DECIMALS, 'SKR_DECIMALS разошёлся с lib.rs');
  const mint = libRs.match(/pub const SKR_MINT: Pubkey = pubkey!\("([^"]+)"\)/);
  assert.ok(mint, 'в lib.rs не найден SKR_MINT');
  assert.equal(mint[1], 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o');

  assert.equal(toUnits('skr', 1_053n), 1_053_000_000n, '1053 SKR = 1 053 000 000 атомов');
  assert.equal(toUnits('sol', 1n), 1_000_000_000n);
  assert.throws(() => currencySpec('usd' as never), /Неизвестная валюта/);
});

test('одинаковое число в SOL и SKR — это разные деньги, и схема их не смешивает', () => {
  // 1053 базовых единицы SOL = 0.000001053 SOL, а 1053 атома SKR = 0.001053 SKR.
  assert.notEqual(CURRENCIES.sol.unitsPerWhole, CURRENCIES.skr.unitsPerWhole);
  assert.equal(toUnits('sol', 1053n) / toUnits('skr', 1053n), 1_000n,
    'SOL ровно в 1000 раз крупнее SKR по разрядности — перепутать значит ошибиться в 1000 раз');
});

test('пыль обязана оставаться пылью: база цены проверяется против cap', () => {
  // cap=100 ⇒ база не ниже 100 000 базовых единиц.
  assert.doesNotThrow(() => assertDustIsNegligible('sol', 500_000_000n, 100));
  assert.throws(() => assertDustIsNegligible('sol', 50_000n, 100), /пыль/i);
  assert.throws(() => assertDustIsNegligible('skr', 50_000n, 100), /пыль/i);
  // Для SKR порог тот же в атомах: 100 000 атомов = 0.1 SKR.
  assert.doesNotThrow(() => assertDustIsNegligible('skr', 100_000_000n, 100));
});

// ─────────────────────────────────────────────────────────────────────────────
// Верификация платежа в SKR (SPL-токен)
// ─────────────────────────────────────────────────────────────────────────────

const SKR_MINT_ID = 'Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o';
const OTHER_MINT = 'OtherMint111111111111111111111111111111111111';
const TREASURY_ATA = 'TreasuryAta111111111111111111111111111111111111';
const PAYER_ATA = 'PayerAta111111111111111111111111111111111111111';
const SKR_PRICE = 1_053_000_017n; // база 1053 SKR + пыль 17

const tb = (o: Partial<TokenBalanceView> & { accountIndex: number }): TokenBalanceView => ({
  mint: SKR_MINT_ID, owner: '', amount: 0n, ...o,
});

function tokenView(over: Partial<ChainTokenTransferView> = {}): ChainTokenTransferView {
  return {
    signature: 'sigT11111111111111111111111111111111111111111111111111111111111111',
    slot: 200n,
    blockTime: 1_800_000_000n,
    err: null,
    accountKeys: [PAYER, TREASURY, PAYER_ATA, TREASURY_ATA],
    preTokenBalances: [
      tb({ accountIndex: 2, owner: PAYER, amount: 5_000_000_000n }),
      tb({ accountIndex: 3, owner: TREASURY, amount: 0n }),
    ],
    postTokenBalances: [
      tb({ accountIndex: 2, owner: PAYER, amount: 5_000_000_000n - SKR_PRICE }),
      tb({ accountIndex: 3, owner: TREASURY, amount: SKR_PRICE }),
    ],
    confirmation: 'finalized',
    ...over,
  };
}

const EXPECT_TOKEN = {
  treasuryAta: TREASURY_ATA,
  mint: SKR_MINT_ID,
  expectedUnits: SKR_PRICE,
  payerWallet: PAYER,
};

test('точный SKR-платёж в финализированной транзакции засчитывается', () => {
  const v = verifyTokenPayment(tokenView(), EXPECT_TOKEN);
  assert.equal(v.code, 'OK');
  assert.equal(v.ok, true);
  assert.equal(v.receivedUnits, SKR_PRICE);
});

test('платёж в другом минте не принимается за SKR', () => {
  const wrongMint = tokenView({
    preTokenBalances: [
      tb({ accountIndex: 2, owner: PAYER, mint: OTHER_MINT, amount: 5_000_000_000n }),
      tb({ accountIndex: 3, owner: TREASURY, mint: OTHER_MINT, amount: 0n }),
    ],
    postTokenBalances: [
      tb({ accountIndex: 2, owner: PAYER, mint: OTHER_MINT, amount: 5_000_000_000n - SKR_PRICE }),
      tb({ accountIndex: 3, owner: TREASURY, mint: OTHER_MINT, amount: SKR_PRICE }),
    ],
  });
  const v = verifyTokenPayment(wrongMint, EXPECT_TOKEN);
  assert.equal(v.code, 'TREASURY_NOT_INVOLVED');
  assert.equal(v.ok, false);
});

test('недоплата и переплата в SKR уходят в ручную очередь', () => {
  const short = SKR_PRICE - 1n;
  const vShort = verifyTokenPayment(tokenView({
    postTokenBalances: [
      tb({ accountIndex: 2, owner: PAYER, amount: 5_000_000_000n - short }),
      tb({ accountIndex: 3, owner: TREASURY, amount: short }),
    ],
  }), EXPECT_TOKEN);
  assert.equal(vShort.code, 'AMOUNT_SHORT');
  assert.equal(vShort.needsManualReview, true);

  const over = SKR_PRICE + 1n;
  const vOver = verifyTokenPayment(tokenView({
    postTokenBalances: [
      tb({ accountIndex: 2, owner: PAYER, amount: 5_000_000_000n - over }),
      tb({ accountIndex: 3, owner: TREASURY, amount: over }),
    ],
  }), EXPECT_TOKEN);
  assert.equal(vOver.code, 'AMOUNT_OVERPAID');
  assert.equal(vOver.needsManualReview, true);
});

test('SKR-платёж не от покупателя отклоняется', () => {
  // Баланс покупателя не уменьшился (pre == post) — токен пришёл откуда-то ещё.
  const v = verifyTokenPayment(tokenView({
    preTokenBalances: [
      tb({ accountIndex: 2, owner: PAYER, amount: 5_000_000_000n - SKR_PRICE }),
      tb({ accountIndex: 3, owner: TREASURY, amount: 0n }),
    ],
  }), EXPECT_TOKEN);
  assert.equal(v.code, 'PAYER_MISMATCH');
  assert.equal(v.needsManualReview, true);

  // Покупатель отправил меньше, чем дошло до казначейства.
  const partial = verifyTokenPayment(tokenView({
    preTokenBalances: [
      tb({ accountIndex: 2, owner: PAYER, amount: 5_000_000_000n - SKR_PRICE + 1n }),
      tb({ accountIndex: 3, owner: TREASURY, amount: 0n }),
    ],
  }), EXPECT_TOKEN);
  assert.equal(partial.code, 'PAYER_MISMATCH');
});

test('нефинализированный и упавший SKR-перевод не засчитываются', () => {
  assert.equal(verifyTokenPayment(tokenView({ confirmation: 'confirmed' }), EXPECT_TOKEN).code, 'NOT_FINALIZED');
  assert.equal(verifyTokenPayment(tokenView({ err: { InstructionError: [0] } }), EXPECT_TOKEN).code, 'TX_FAILED');
});

test('tokenInflow сопоставляет снимки по accountIndex, а не по порядку', () => {
  const v = tokenView();
  assert.deepEqual(tokenInflow(v, TREASURY, SKR_MINT_ID), { accountIndex: 3, received: SKR_PRICE });
  // У покупателя дельта отрицательная — именно это отличает отправителя.
  assert.equal((tokenInflow(v, PAYER, SKR_MINT_ID)?.received ?? 0n) < 0n, true);
  assert.equal(tokenInflow(v, TREASURY, OTHER_MINT), null);
});
