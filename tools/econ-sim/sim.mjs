#!/usr/bin/env node
// ARES-1 econ-sim — эпохи, эмиссия vs sink'и, гибридный кап, призовый пул.
// Формулы взяты из game/apps/web/src/utils/constants.ts и programs/solana_potato/src/lib.rs.
// Допущения (помечены [A]) — параметры поведения игроков, их можно менять флагами.

const MICRO = 1_000_000;
const BPS = 10_000;
const EPOCH_DAYS = 28;
const BASE = 6 * MICRO; // DEFAULT_BASE_YIELD_MICRO_PER_DAY
const DAILY_CAP_DEFAULT = 250_000; // 🥔 — default daily/epoch cap clamp floor (см. lib.rs withdraw note)

// FIELD_TYPES из constants.ts
const TYPES = [
  { name: 'Common', yieldBps: 3_500, costBps: 4_000 },
  { name: 'Rare', yieldBps: 10_000, costBps: 10_000 },
  { name: 'Epic', yieldBps: 21_000, costBps: 20_000 },
];
// moduleTiers / PRESALE_DROP
const TIER_CHANCE = [0.7, 0.25, 0.05];

const LUNAR = [
  10000, 10334, 10651, 10935, 11173, 11352, 11462, 11500,
  11462, 11352, 11173, 10935, 10651, 10334, 10000, 9666,
  9349, 9065, 8827, 8648, 8538, 8500, 8538, 8648,
  8827, 9065, 9349, 9666,
];

function levelMultBps(l) {
  const t = { 0: 10000, 1: 10000, 2: 15700, 3: 20400, 4: 24600, 5: 28600 };
  if (l <= 5) return t[l];
  return 28600 + (l - 5) * 4000;
}
const durMultBps = (d) => 2000 + Math.min(d, 100) * 80;
const scaled = (base, type) => Math.floor((base * TYPES[type].costBps) / BPS);
const feeBps = (pot) => (pot < 1000 ? 900 : pot < 10000 ? 1000 : pot < 100000 ? 1100 : 1200);

// ── Архетипы игроков [A] ─────────────────────────────────────────
const ARCHETYPES = [
  { name: 'Турист', share: 0.3, fields: [1, 0, 0], level: 1, durability: 50,
    taxPaid: false, fertPerEpoch: 0, repairsPerEpoch: 0, upgradesPerEpoch: 0,
    buysFieldPerEpoch: 0, modulesPerEpoch: 0, marketVolPerEpoch: 0 },
  { name: 'Регуляр', share: 0.5, fields: [1, 0, 0], level: 6, durability: 85,
    taxPaid: true, fertPerEpoch: 4, repairsPerEpoch: 1, upgradesPerEpoch: 2,
    buysFieldPerEpoch: 0.5, modulesPerEpoch: 10, marketVolPerEpoch: 500 },
  { name: 'Хардкор', share: 0.2, fields: [2, 1, 1], level: 15, durability: 100,
    taxPaid: true, fertPerEpoch: 12, repairsPerEpoch: 3, upgradesPerEpoch: 6,
    buysFieldPerEpoch: 1, modulesPerEpoch: 30, marketVolPerEpoch: 5000 },
];

// ── Цены модулей стройки ─────────────────────────────────────────
function moduleAvgCost(anchor) {
  const t1avgDaily = (BASE * TYPES[1].yieldBps) / BPS / MICRO; //Rare L1 ≈6.0
  const t0avgDaily = (BASE * TYPES[0].yieldBps) / BPS / MICRO; //Common ≈2.1
  const t2avgDaily = (BASE * TYPES[2].yieldBps) / BPS / MICRO; //Epic ≈12.6
  if (anchor === 'days') {
    // Якорь: Common=2 дня, Rare=5 дней, Epic=12 дней тир-дохода
    const c = 2 * t0avgDaily, r = 5 * t1avgDaily, e = 12 * t2avgDaily;
    return { common: c, rare: r, epic: e, expect: TIER_CHANCE[0] * c + TIER_CHANCE[1] * r + TIER_CHANCE[2] * e };
  }
  // pilot: текущие цены пилота (узел60/солнце80 | вода120/жилой150 | теплица200/лаба300)
  const c = 70, r = 135, e = 250;
  return { common: c, rare: r, epic: e, expect: TIER_CHANCE[0] * c + TIER_CHANCE[1] * r + TIER_CHANCE[2] * e };
}

// ── Сценарий ─────────────────────────────────────────────────────
function run({ players = 300, epochs = 3, anchor = 'pilot', fee = 'v2', dailyCap = DAILY_CAP_DEFAULT }) {
  const price = moduleAvgCost(anchor);
  let cap = dailyCap; // mint_cap эпохи (clamp [daily, 3×daily])
  const lines = [];
  let totals = { minted: 0, burned: 0 };

  for (let e = 1; e <= epochs; e++) {
    let emissionDemand = 0;
    const sink = { tax: 0, fert: 0, repair: 0, upgrade: 0, fieldBuy: 0, builderBurn: 0, feeBurn: 0 };

    for (const a of ARCHETYPES) {
      const n = players * a.share;
      // — эмиссия за эпоху (все28 дней, лунный вес внутри эпохи) —
      let perPlayer = 0;
      for (const [typeId, count] of a.fields.entries()) {
        if (!count) continue;
        // удобрение покрывает fertPerEpoch дней из28 → средний множитель за эпоху
        const fertFactor = BPS + Math.floor((5000 * a.fertPerEpoch) / EPOCH_DAYS);
        const m =
          levelMultBps(a.level) *
          durMultBps(a.durability) *
          TYPES[typeId].yieldBps *
          (a.taxPaid ? BPS : 5000) *
          fertFactor; // пять bps-факторов → /BPS^5
        let dailyNoLunar = (BASE * m) / Math.pow(BPS, 5); // micro/день
        // луна: lunarSum/BPS ≈ «дней-эквивалент28 × средний вес» → умножаем день на день
        let lunarSum = 0;
        for (const lb of LUNAR) lunarSum += lb;
        perPlayer += (count * dailyNoLunar * (lunarSum / BPS)) / MICRO; // → POTATO за эпоху
      }
      emissionDemand += n * perPlayer;

      // — sink'и (всё burn по lib.rs) —
      const t = a.fields[0] ? 0 : a.fields[1] ? 1 : 2; // реф. тип для расходов [A]
      sink.tax += n * ((a.taxPaid ? a.repairsPerEpoch || true : false) ? EPOCH_DAYS / 7 : 0) *
        scaled(6, t) * Math.floor((a.level + 1) / 2);
      sink.fert += n * a.fertPerEpoch * scaled(10, t);
      sink.repair += n * a.repairsPerEpoch * scaled(15, t) * Math.max(Math.floor(a.level / 3), 1);
      sink.upgrade += n * a.upgradesPerEpoch * scaled(100, t) * a.level;
      sink.fieldBuy += n * a.buysFieldPerEpoch * scaled(250, t);

      // — стройка:50% burn /50% пул —
      sink.builderBurn += n * a.modulesPerEpoch * price.expect * 0.5;

      // — legacy fee:60% burn; v2 — в SOL (вне POTATO-леджера) —
      if (fee === 'legacy') {
        const feePot = a.marketVolPerEpoch * (feeBps(a.marketVolPerEpoch) / 10000);
        sink.feeBurn += n * feePot * 0.6;
      }
    }

    const burned =
      sink.tax + sink.fert + sink.repair + sink.upgrade + sink.fieldBuy + sink.builderBurn + sink.feeBurn;
    const minted = Math.min(emissionDemand, cap);
    const util = cap > 0 ? minted / cap : 0;
    const pool = nPool(sink.builderBurn, minted);
    const poolPaid = Math.min(pool, 0.2 * minted); // пул ≤20% эмиссии эпохи

    // гибридный кап следующей эпохи (lib.rs roll_epoch)
    const burnAxis = dailyCap + burned / 2;
    const utilAxis = cap * (1 + 0.15 * (util - 0.85));
    cap = Math.min(Math.max((burnAxis + utilAxis) / 2, dailyCap), dailyCap * 3);

    totals.minted += minted;
    totals.burned += burned;

    lines.push({
      epoch: e,
      demand: emissionDemand,
      minted,
      util,
      sinks: burned,
      burnRows: sink,
      pool,
      poolPaid,
      net: minted - burned,
      burnRatio: minted > 0 ? burned / minted : Infinity,
      nextCap: cap,
    });
  }
  return { price, lines, totals };
}

const nPool = (builderBurn) => builderBurn; // пул =50% строек = ровно builderBurn

function fmt(n) {
  if (!isFinite(n)) return '∞';
  return Math.round(n).toLocaleString('ru-RU');
}

// ── CLI ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : d;
};

const res = run({
  players: Number(opt('players', 300)),
  epochs: Number(opt('epochs', 3)),
  anchor: opt('anchor', 'pilot'),
  fee: opt('fee', 'v2'),
  dailyCap: Number(opt('cap', DAILY_CAP_DEFAULT)),
});

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║ ARES-1 econ-sim — эпохи по28 дней (лунный цикл включён)      ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`игроков: ${opt('players', 300)} | эпох: ${opt('epochs', 3)} | цены: ${opt('anchor', 'pilot')} | fee: ${opt('fee', 'v2')} | cap: ${fmt(res.lines[0] ? Number(opt('cap', DAILY_CAP_DEFAULT)) : 0)} 🥔/эпоху`);
console.log(`ожид. цена модуля: ${res.price.expect.toFixed(1)} 🥔 (C ${res.price.common.toFixed(0)} / R ${res.price.rare.toFixed(0)} / E ${res.price.epic.toFixed(0)})`);
console.log('');
console.log('эпоха | спрос   | отчеканено | ютил. | сожжено  | burn/mint | чистый   | выплата | в казну | cap→');
console.log('──────┼─────────┼────────────┼───────┼──────────┼───────────┼──────────┼─────────┼─────────┼─────────');
for (const l of res.lines) {
  console.log(
    `${String(l.epoch).padStart(5)} | ${fmt(l.demand).padStart(6)} | ${fmt(l.minted).padStart(10)} | ${(l.util * 100).toFixed(0).padStart(5)}% | ${fmt(l.sinks).padStart(8)} | ${(l.burnRatio).toFixed(2).padStart(9)} | ${fmt(l.net).padStart(8)} | ${fmt(l.poolPaid).padStart(7)} | ${fmt(l.pool - l.poolPaid).padStart(7)} | ${fmt(l.nextCap)}`
  );
}
console.log('');
const last = res.lines[res.lines.length - 1];
console.log('Sink\'и последней эпохи (все — BURN, кроме пула):');
for (const [k, v] of Object.entries(last.burnRows)) {
  if (k === 'builderBurn') continue;
  console.log(`  ${k.padEnd(11)} ${fmt(v).padStart(9)} 🥔`);
}
console.log(`  builderBurn ${fmt(last.burnRows.builderBurn)} 🥔 (+${fmt(last.burnRows.builderBurn)} в призовый пул)`);
console.log('');
const netPct = (last.net / Math.max(last.minted, 1)) * 100;
console.log(`ИТОГ: чистый прирост за эпоху ${fmt(last.net)} 🥔 (${netPct.toFixed(1)}% от отчеканенного)`);
console.log(`burn/mint = ${last.burnRatio.toFixed(2)} (цель ≥1.00 — нетто-дефляция при ≥1)`);
console.log(`Критерий чек-листа: чистая эмиссия ≤+5% — ${netPct <= 5 ? '✅ ВЫПОЛНЕН' : '❌ НЕ ВЫПОЛНЕН'}`);
console.log('');
console.log('Допущения [A]: доля архетипов30/50/20; таксономия — по моделям архетипов;');
console.log('удобрение = +50% в fertPerEpoch дней; V2 fee — вне POTATO-леджера (SOL→казна).');
