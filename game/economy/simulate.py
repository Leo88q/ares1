#!/usr/bin/env python3
"""
Solana Potato — 12-месячная симуляция экономики (пересчёт 14.09.2026).

Синхронизировано с programs/solana_potato/src/lib.rs (после аудита):
* формула урожая: base(6) × type(0.35/1/2.1) × level_mult × durability × global
  × LUNAR_TABLE[epoch % 28] (0.85–1.15); fertilizer/tax_penalty не моделируются
  (консервативно для burn — они только режут выплату)
* прогрессивный налог при сборе: 2% + 8%·(supply/max)², потолок 10%;
  50% налога → казна 🥔, 50% → burn
* эпоха = 24h; гибрид-кап: avg(250k + burn_прошлой_эпохи/2,
  cap_прошлый·(1 + 0.15·(U−0.85))) clamp [250k, 750k], где U = ВСЕ минты эпохи / кап
  (lib.rs: epoch.minted_micro учитывает player + treasury + квесты + TG)
* стоки (total_burned в lib.rs): покупка поля 100/250/500, налог-поддержка
  6/нед × (L+1)/2 × type, ремонт 15 × max(1, L//3) × type, апгрейд 100×L×type,
  комиссия рынка 9/10/11/12% (60% → burn)
* квесты: разовый пул 550 🥔; TG-кран: 10% активных × 500/день (ограничен капом)
* max supply 1 000 000 000 🥔

Упрощения (задокументированы):
* когортная модель: архетип = группа игроков с идентичными полями, upgrade-решения
  синхронные; 1 harvest/день
* durability: износ 4/день, пол 20, ремонт при ≤25 (сброс на 100) — средний
  множитель ~0.68
* цена SOL/🥔 — прозрачная линейная модель клиринга (допущение):
  P' = P · clamp(1 + κ·(D−S)/S, ±20%/день), κ=0.5;
  D = только закупки новичков (вход + топливо на 30 дней upkeep) — единственный
  источник НОВОГО SOL; внутренние сделки игрок→игрок цену не поддерживают;
  S = продажи за день (включая крановые 🥔). Это не oracle-модель — ориентир,
  не прогноз; модельный пол 1e-8 — числовой, не ценовой.
* сценарии — steady state: 10 / 1 000 / 100 000 активных, churn 15%/год.

Запуск: python3 economy/simulate.py
"""
from __future__ import annotations

# ───── on-chain константы (lib.rs) ─────
BASE_YIELD = 6.0
TYPE_YIELD = [0.35, 1.00, 2.10]
TYPE_COST = [0.4, 1.00, 2.00]
FIELD_PRICE = 250.0            # базовая цена грядки, 🥔
MAX_SUPPLY = 1_000_000_000.0
CAP_MIN, CAP_MAX = 250_000.0, 750_000.0
# LUNAR_TABLE из lib.rs (28 эпох = 28 дней; пик на дне 7, минимум на дне 21)
LUNAR = [10000, 10334, 10651, 10935, 11173, 11352, 11462, 11500,
         11462, 11352, 11173, 10935, 10651, 10334, 10000, 9666,
         9349, 9065, 8827, 8648, 8538, 8500, 8538, 8648,
         8827, 9065, 9349, 9666]
TAX_BASE_BPS, TAX_GROWTH_BPS = 200, 800   # 2% + 8%·ratio², потолок 10%
TAX_CAP_BPS = 1000
FEE_BURN_SHARE = 0.60                    # 60% комиссии рынка → burn
QUEST_POOL_ONE_TIME = 550.0
TG_DAILY_CLAIM = 500.0                   # 🥔/день на игрока
TG_ACTIVE_SHARE = 0.10                   # допущение: 10% активных забирают
DURABILITY_FLOOR = 20.0
DURABILITY_DRAIN = 4.0                    # /день
DURABILITY_REPAIR_AT = 25.0

PRICE_POTATO_INIT = 0.0001      # SOL/🥔 — стартовое допущение
PRICE_KAPPA = 0.5
PRICE_STEP_MAX = 0.20
PRICE_FLOOR_REPORT = 1e-8       # числовой пол для ОТЧЁТА (не ценовое допущение)
CHURN_PER_YEAR = 0.15

# Архетипы (определения из game/docs/ECONOMY.md): (имя, доля, {тип: полей}, sell_rate, upgrade при окупаемости ≤ N дн)
ARCHETYPES = [
    ("casual",   0.5, {0: 3, 1: 2},        0.70, None),
    ("hardcore", 0.4, {0: 1, 1: 2, 2: 2},  0.40, 150),
    ("whale",    0.1, {2: 5},              0.20, 365),
]


def level_mult(level: int) -> float:
    table = {1: 1.0, 2: 1.57, 3: 2.04, 4: 2.46, 5: 2.86}
    return table[level] if level <= 5 else 2.86 + (level - 5) * 0.40


def fee_bps(amount: float) -> int:
    if amount < 1_000:
        return 900
    if amount < 10_000:
        return 1000
    if amount < 100_000:
        return 1100
    return 1200


def field_cost(ftype: int) -> float:
    return FIELD_PRICE * TYPE_COST[ftype]


def entry_cost(fields: dict) -> float:
    return sum(field_cost(t) * n for t, n in fields.items())


def harvest_tax_bps(supply: float) -> float:
    ratio = supply / MAX_SUPPLY
    return min(TAX_CAP_BPS, TAX_BASE_BPS + TAX_GROWTH_BPS * ratio * ratio) / 10_000


class Archetype:
    """Группа идентичных игроков; поля по типам с общим уровнем/прочностью."""

    def __init__(self, name, count, fields, sell_rate, upg_days):
        self.name, self.count = name, count
        self.fields = fields
        self.sell_rate, self.upg_days = sell_rate, upg_days
        # тип -> [кол-во полей на игрока, уровень, прочность]
        self.types = {t: [n, 1, 100.0] for t, n in fields.items()}
        self.balance = 0.0
        self.upgrades = 0
        self.sold_total = 0.0

    def gross_per_player(self, day: int) -> float:
        lunar = LUNAR[day % 28] / 10_000
        total = 0.0
        for t, (n, lvl, dur) in self.types.items():
            total += n * BASE_YIELD * TYPE_YIELD[t] * level_mult(lvl) \
                * (0.2 + 0.8 * dur / 100) * lunar
        return total


def simulate(n_players: int, months: int = 12) -> dict:
    cohorts = [
        Archetype(name, max(1, round(n_players * share)), fields, sr, up)
        for name, share, fields, sr, up in ARCHETYPES
    ]
    n = sum(c.count for c in cohorts)
    avg_entry = sum(entry_cost(c.fields) * c.count for c in cohorts) / n
    new_per_day = n * CHURN_PER_YEAR / 365        # steady state: пришло = ушло

    supply = 0.0
    cap = CAP_MIN
    price = PRICE_POTATO_INIT
    price_min, price_max = price, price
    mint_total = burn_total = tg_total = 0.0
    fee_burn_total = tax_burn_total = sold_total = treasury_total = 0.0
    entry_burn_total = 0.0
    cap_hits = 0
    quest_granted = False
    daily_burn = []                                 # для burn_прошлой_эпохи
    monthly = []
    snap = {"mint": 0.0, "burn": 0.0, "sold": 0.0, "supply": 0.0, "price": price, "cap": cap}
    days = months * 30
    day_mint_all = 0.0                              # для utilization эпохи 0

    for day in range(days):
        # ── гибрид-кап новой эпохи (roll_epoch в lib.rs) ──
        burn_prev_total = burn_total
        prev_burned = daily_burn[-1] if daily_burn else 0.0
        cap_from_burn = CAP_MIN + prev_burned / 2
        util_prev = min(1.0, day_mint_all / cap) if day > 0 else 0.85
        cap_from_util = cap * (1 + 0.15 * (util_prev - 0.85))
        cap = min(CAP_MAX, max(CAP_MIN, (cap_from_burn + cap_from_util) / 2))
        cap_left = cap

        day_mint = day_tax_burn = day_tax_treasury = day_sold = 0.0
        day_mint_all = 0.0                          # ВСЕ минты эпохи (для U)
        day_upkeep_pp_sum = 0.0                     # upkeep дня (для demand-модели)

        # ── пропуск 1: спрос дня (выплаты + TG), без распределения капа ──
        for c in cohorts:
            gross_pp = c.gross_per_player(day)
            c._tb = harvest_tax_bps(supply)
            c._net_pp = gross_pp * (1 - c._tb)
            c._tax_pp = gross_pp * c._tb
        harvest_demand = sum(c._net_pp * c.count for c in cohorts)
        tg_demand = n * TG_ACTIVE_SHARE * TG_DAILY_CLAIM

        # квесты (разово) первыми, из капа
        q = 0.0
        if not quest_granted:
            q = min(QUEST_POOL_ONE_TIME, cap, MAX_SUPPLY - supply)
            supply += q
            day_mint_all += q
            mint_total += q
            quest_granted = True
        cap_share = cap - q
        # распределение капа: если спрос < капа — все получают полностью;
        # иначе пропорционально спросу (допущение о порядке транзакций;
        # "TG первым" = наихудший случай для игроков, "TG последним" = лучший)
        total_demand = harvest_demand + tg_demand
        if total_demand <= 0:
            harvest_scale, tg = 1.0, 0.0
        elif cap_share >= total_demand:
            harvest_scale, tg = 1.0, min(tg_demand, MAX_SUPPLY - supply)
        else:
            ratio = cap_share / total_demand
            harvest_scale = ratio
            tg = min(tg_demand * ratio, MAX_SUPPLY - supply)
        supply += tg
        day_mint_all += tg
        mint_total += tg
        tg_total += tg
        day_sold += tg                               # крановые 🥔 продаются (чистый кран)

        # ── пропуск 2: выплаты по капу ──
        for c in cohorts:
            gross_pp = c.gross_per_player(day)
            tb, net_pp, tax_pp = c._tb, c._net_pp, c._tax_pp
            payout_pp = net_pp * harvest_scale
            if harvest_scale < 1.0:
                cap_hits += 1
            supply += payout_pp * c.count
            day_mint += payout_pp * c.count
            day_mint_all += payout_pp * c.count

            # налог: 50% burn / 50% казна (минт в казну тоже в капе)
            supply += tax_pp / 2 * c.count
            day_mint_all += tax_pp / 2 * c.count
            day_tax_burn += tax_pp / 2 * c.count
            day_tax_treasury += tax_pp / 2 * c.count

            # износ прочности
            for t in c.types:
                c.types[t][2] = max(DURABILITY_FLOOR, c.types[t][2] - DURABILITY_DRAIN)

            # апгрейды (синхронные, от дорогого типа к дешёвому, пока хватает окупаемости и баланса)
            if c.upg_days:
                for t in sorted(c.types, key=lambda x: -TYPE_COST[x]):
                    nn, lvl, dur = c.types[t]
                    cost = 100 * lvl * TYPE_COST[t]
                    extra = BASE_YIELD * TYPE_YIELD[t] * (level_mult(lvl + 1) - level_mult(lvl)) \
                        * (0.2 + 0.8 * dur / 100)
                    if extra > 0 and cost / extra <= c.upg_days and c.balance >= cost:
                        c.balance -= cost
                        c.types[t][1] += 1
                        c.upgrades += 1
                        burn_total += cost * c.count
                        supply = max(0.0, supply - cost * c.count)

            # upkeep: налог-поддержка + ремонт при durability ≤ 25 (стоки)
            upkeep_pp = 0.0
            for t, (nn, lvl, dur) in c.types.items():
                upkeep_pp += nn * 6 / 7 * (lvl + 1) / 2 * TYPE_COST[t]
                if dur <= DURABILITY_REPAIR_AT:
                    upkeep_pp += nn * 15 * max(1, lvl // 3) * TYPE_COST[t]
                    c.types[t][2] = 100.0
            day_upkeep_pp_sum += upkeep_pp * c.count
            burn_total += upkeep_pp * c.count
            supply = max(0.0, supply - upkeep_pp * c.count)

            # продажа части чистого урожая
            net_sellable = max(0.0, payout_pp - upkeep_pp)
            sell_pp = net_sellable * c.sell_rate
            day_sold += sell_pp * c.count
            c.sold_total += sell_pp * c.count
            # непроданное — в баланс (на апгрейды/поля)
            c.balance += net_sellable - sell_pp

        mint_total += day_mint
        tax_burn_total += day_tax_burn
        burn_total += day_tax_burn
        treasury_total += day_tax_treasury

        # ── стоки: покупка полей новыми игроками (churn-заместители) ──
        entry_burn = new_per_day * avg_entry
        entry_burn_total += entry_burn
        burn_total += entry_burn
        supply = max(0.0, supply - entry_burn)

        # ── комиссия рынка (по среднему чеку за день) ──
        avg_check = day_sold / max(1, n * 0.5)
        fee = day_sold * fee_bps(avg_check) / 10_000
        fee_burn_total += fee * FEE_BURN_SHARE
        burn_total += fee * FEE_BURN_SHARE
        treasury_total += fee * (1 - FEE_BURN_SHARE)
        sold_total += day_sold
        supply = max(0.0, supply - fee * FEE_BURN_SHARE)

        # ── клиринг цены ──
        # Спрос = закупки новичков: поле входа + топливо на 30 дней upkeep.
        # Внутренние переводы (игрок→игрок) цену не поддерживают — их нет в D.
        upkeep_pp_avg = day_upkeep_pp_sum / max(1, n)
        absorb_per_entrant = avg_entry + 30 * upkeep_pp_avg
        demand = new_per_day * absorb_per_entrant
        factor = 1 + PRICE_KAPPA * (demand - day_sold) / max(day_sold, 1.0)
        price *= min(1 + PRICE_STEP_MAX, max(1 - PRICE_STEP_MAX, factor))
        price_min, price_max = min(price_min, price), max(price_max, price)
        entrants_for_stability = day_sold / max(absorb_per_entrant, 1e-9)

        daily_burn.append(burn_total - burn_prev_total)

        if (day + 1) % 30 == 0:
            dm = mint_total - snap["mint"]
            db = burn_total - snap["burn"]
            ds = sold_total - snap["sold"]
            monthly.append({
                "month": (day + 1) // 30, "players": n,
                "mint": dm / 30, "burn": db / 30,
                "burn_mint": db / max(1e-9, dm),
                "supply": supply, "sold": ds / 30,
                "price": max(price, PRICE_FLOOR_REPORT), "cap": cap,
            })
            snap = {"mint": mint_total, "burn": burn_total, "sold": sold_total,
                    "supply": supply, "price": price, "cap": cap}

    return {
        "n_players": n, "final_supply": supply,
        "price_start": PRICE_POTATO_INIT, "price_end": price,
        "price_min": price_min, "price_max": price_max,
        "entrants_for_stability": entrants_for_stability,
        "new_per_day": new_per_day,
        "monthly": monthly,
        "totals": {
            "mint": mint_total, "burn": burn_total, "fee_burn": fee_burn_total,
            "tax_burn": tax_burn_total, "entry_burn": entry_burn_total,
            "tg_mint": tg_total, "sold": sold_total,
            "treasury": treasury_total, "cap_hits": cap_hits,
        },
    }


def cross_scale() -> list:
    """Просмотр масштабов: где кап становится ограничением, где дефляция."""
    rows = []
    for n in (10, 100, 1_000, 5_000, 10_000, 50_000, 100_000):
        r = simulate(n, months=12)
        t = r["totals"]
        rows.append({
            "n": n,
            "burn_mint": t["burn"] / max(1e-9, t["mint"]),
            "tg_share": t["tg_mint"] / max(1e-9, t["mint"]) * 100,
            "cap_hits": t["cap_hits"],
            "supply_m": r["final_supply"] / 1e6,
            "price_end": r["price_end"],
        })
    return rows


def report() -> str:
    lines = [
        "# Симуляция экономики — 14.09.2026 (формулы lib.rs v2, когортная модель)",
        "",
    ]
    lines += [
        "## Пересчёт по масштабам (12 месяцев, steady state)",
        "",
        "| Игроки | Burn/Mint | TG-кран, % минтов | Кап эпохи | Supply через год, M🥔 | Цена через год |",
        "|---|---|---|---|---|---|",
    ]
    for row in cross_scale():
        lines.append(
            f"| {row['n']:,} | {row['burn_mint']:.2f} "
            f"({'дефляция' if row['burn_mint'] > 1 else 'инфляция'}) "
            f"| {row['tg_share']:.0f}% "
            f"| {'**режет**' if row['cap_hits'] else 'нет'} "
            f"| {row['supply_m']:,.2f} | {max(row['price_end'], PRICE_FLOOR_REPORT):.1e} |")
    lines += ["", "---", ""]
    for n in (10, 1_000, 100_000):
        r = simulate(n)
        t = r["totals"]
        lines += [
            f"## Сценарий: {n:,} активных игроков (steady state, churn 15%/год)",
            "",
            "| Мес. | Mint/день | Burn/день | Burn/Mint | Supply, M🥔 | Продажи/день | Кап эпохи | Цена SOL/🥔 |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for m in r["monthly"]:
            lines.append(
                f"| {m['month']} | {m['mint']:,.0f} | {m['burn']:,.0f} | {m['burn_mint']:.2f} "
                f"| {m['supply'] / 1e6:,.3f} | {m['sold']:,.0f} | {m['cap']:,.0f} | {m['price']:.2e} |")
        tg_share = t["tg_mint"] / max(1e-9, t["mint"])
        tax_at_end = min(0.10, 0.02 + 0.08 * (r["final_supply"] / MAX_SUPPLY) ** 2)
        lines += [
            "",
            f"- Supply через год: **{r['final_supply'] / 1e6:,.2f} M🥔** "
            f"({r['final_supply'] / MAX_SUPPLY * 100:.4f}% от max 1B) "
            f"→ прогрессивный налог всего **{tax_at_end * 100:.2f}%** (базовые 2% + 8%·ratio² — механизм спит)",
            f"- За год: mint {t['mint'] / 1e6:.2f} M, burn {t['burn'] / 1e6:.2f} M "
            f"→ **burn/mint = {t['burn'] / max(1e-9, t['mint']):.2f}** "
            f"({'дефляция' if t['burn'] > t['mint'] else 'инфляция'})",
            f"  (TG-кран {t['tg_mint'] / 1e6:.2f} M = {tg_share * 100:.0f}% всех минтов; "
            f"налог→burn {t['tax_burn'] / 1e6:.2f} M; комиссия→burn {t['fee_burn'] / 1e6:.2f} M; "
            f"вход-поля {t['entry_burn'] / 1e6:.2f} M; "
            f"upkeep/апгрейд {(t['burn'] - t['tax_burn'] - t['fee_burn'] - t['entry_burn']) / 1e6:.2f} M)",
            f"- Казна 🥔: {t['treasury'] / 1e6:.2f} M за год "
            f"≈ {t['treasury'] * PRICE_POTATO_INIT:.0f} SOL по стартовой цене 1e-4",
            f"- Цена (модель клиринга): 1.00e-04 → **{max(r['price_end'], PRICE_FLOOR_REPORT):.1e}** SOL/🥔 "
            f"(динамика модели; пол отчёта {PRICE_FLOOR_REPORT:.0e} — числовой, не ценовой)",
            f"- **Порог стабильности цены:** нужно ≥{r['entrants_for_stability']:,.1f} новичков/день "
            f"= {r['entrants_for_stability'] * 365:,.0f}/год, т.е. "
            f"**×{r['entrants_for_stability'] / max(1e-9, r['new_per_day']):.0f}** к churn-заместителям "
            f"({r['new_per_day']:,.2f}/день) — иначе цена падает на модельный пол",
            f"- Упирается в кап эпохи: {'ДА (' + str(t['cap_hits']) + ' когортных транкций — кап режет выплаты, чаще всего у китов)' if t['cap_hits'] else 'нет'}",
            "",
        ]
    return "\n".join(lines)


if __name__ == "__main__":
    print(report())
