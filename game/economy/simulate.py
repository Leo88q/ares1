#!/usr/bin/env python3
"""
Solana Potato — 1-year economy simulation.

Mirrors the on-chain constants in programs/solana_potato/src/lib.rs.
Run:  python3 economy/simulate.py            # markdown report to stdout
      python3 economy/simulate.py --json     # machine-readable

Model
-----
* 1000 players × 5 fields, three archetypes (casual / hardcore / whale).
* Day-by-day accrual with the real yield formula, durability decay (≈4/day),
  tax, repair, fertilizer and upgrade decisions, marketplace selling with the
  progressive fee (60 % burned / 40 % treasury) and the 250k/day epoch cap.
* Scenarios: baseline, 80 % churn, hyper-inflation (everyone sells everything),
  price -100× (SOL-denominated view only; POTATO flows are unchanged).
"""
from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass, field

# ───── on-chain constants (keep in sync with lib.rs) ─────
BASE_YIELD = 6.0                       # POTATO / day, level 1, type 1
TYPE_YIELD = [0.35, 1.0, 2.1]
TYPE_COST = [0.4, 1.0, 2.0]
FIELD_PRICE = 250.0
TAX = 6.0                              # per 7 days
REPAIR = 15.0
FERTILIZER = 10.0                      # per 24h, ×1.5
UPGRADE_BASE = 100.0                   # × level × type_cost
MAX_LEVEL = 50
DAILY_CAP = 250_000.0
DURABILITY_DECAY_PER_DAY = 4
UNPAID_TAX_MULT = 0.5
FEE_BURN_SHARE = 0.60


def level_mult(level: int) -> float:
    table = {1: 1.0, 2: 1.57, 3: 2.04, 4: 2.46, 5: 2.86}
    return table[level] if level <= 5 else 2.86 + (level - 5) * 0.40


def durability_mult(d: int) -> float:
    return 0.2 + 0.8 * d / 100


def fee_bps(amount: float) -> int:
    if amount < 1_000:
        return 300
    if amount < 10_000:
        return 600
    if amount < 100_000:
        return 900
    return 1_200


def upgrade_cost(level: int, ftype: int) -> float:
    return UPGRADE_BASE * level * TYPE_COST[ftype]


def daily_yield(level: int, ftype: int, durability: int, fert: bool, tax_ok: bool) -> float:
    y = BASE_YIELD * TYPE_YIELD[ftype] * level_mult(level) * durability_mult(durability)
    if fert:
        y *= 1.5
    if not tax_ok:
        y *= UNPAID_TAX_MULT
    return y


# ───── agents ─────
@dataclass
class Field:
    ftype: int
    level: int = 1
    durability: int = 100
    tax_days_left: int = 7
    fert_days_left: int = 0


@dataclass
class Player:
    kind: str
    fields: list[Field]
    balance: float = 0.0
    active: bool = True
    repair_below: int = 40
    upgrade_payback_days: float = 0.0     # 0 = never upgrades
    fertilizer_min_ratio: float = 99.0    # fertilize when daily yield gain / cost > ratio
    sell_share: float = 0.7               # share of monthly net income sold on market
    initial_spend: float = 0.0
    earned: float = 0.0


ARCHETYPES = {
    #            share  fields(types)      repair upg_payback fert_ratio sell
    "casual":   (0.50, [0, 0, 0, 1, 1],   40,    0,          99.0,      0.70),
    "hardcore": (0.40, [0, 1, 1, 2, 2],   60,    150,        1.5,       0.40),
    "whale":    (0.10, [2, 2, 2, 2, 2],   70,    365,        1.2,       0.20),
}


def make_players(n: int, rng: random.Random) -> list[Player]:
    players: list[Player] = []
    for kind, (share, types, repair_below, upg, fert, sell) in ARCHETYPES.items():
        for _ in range(int(n * share)):
            p = Player(kind, [Field(t) for t in types], repair_below=repair_below,
                       upgrade_payback_days=upg, fertilizer_min_ratio=fert, sell_share=sell)
            p.initial_spend = sum(FIELD_PRICE * TYPE_COST[t] for t in types)
            players.append(p)
    rng.shuffle(players)
    return players


@dataclass
class Ledger:
    minted: float = 0.0
    burn_tax: float = 0.0
    burn_repair: float = 0.0
    burn_fert: float = 0.0
    burn_upgrade: float = 0.0
    burn_fields: float = 0.0
    burn_fee: float = 0.0
    treasury: float = 0.0
    sold: float = 0.0
    cap_hit_days: int = 0

    @property
    def burned(self) -> float:
        return (self.burn_tax + self.burn_repair + self.burn_fert + self.burn_upgrade
                + self.burn_fields + self.burn_fee)


def simulate(days: int = 365, n_players: int = 1000, churn_total: float = 0.15,
             sell_override: float | None = None, seed: int = 7) -> dict:
    rng = random.Random(seed)
    players = make_players(n_players, rng)
    monthly: list[dict] = []
    ledger = Ledger()
    total = Ledger()
    # initial field purchases are a burn (players bought POTATO on market first)
    for p in players:
        total.burn_fields += p.initial_spend
    daily_churn = 1 - (1 - churn_total) ** (1 / days)

    for day in range(1, days + 1):
        # churn
        for p in players:
            if p.active and rng.random() < daily_churn:
                p.active = False

        # accrual (pending per field) then cap
        pendings: list[tuple[Player, Field, float]] = []
        for p in players:
            if not p.active:
                continue
            for f in p.fields:
                y = daily_yield(f.level, f.ftype, f.durability, f.fert_days_left > 0, f.tax_days_left > 0)
                pendings.append((p, f, y))
        demand = sum(y for _, _, y in pendings)
        scale = min(1.0, DAILY_CAP / demand) if demand > 0 else 1.0
        if scale < 1.0:
            ledger.cap_hit_days += 1
        for p, f, y in pendings:
            got = y * scale
            p.balance += got
            p.earned += got
            ledger.minted += got
            f.durability = max(0, f.durability - DURABILITY_DECAY_PER_DAY)
            f.tax_days_left -= 1
            f.fert_days_left = max(0, f.fert_days_left - 1)

        # upkeep decisions
        for p in players:
            if not p.active:
                continue
            for f in p.fields:
                tc = TYPE_COST[f.ftype]
                if f.tax_days_left <= 0 and p.balance >= TAX * tc:
                    p.balance -= TAX * tc
                    ledger.burn_tax += TAX * tc
                    f.tax_days_left = 7
                if f.durability < p.repair_below and p.balance >= REPAIR * tc:
                    p.balance -= REPAIR * tc
                    ledger.burn_repair += REPAIR * tc
                    f.durability = 100
                if p.fertilizer_min_ratio < 50 and f.fert_days_left == 0:
                    gain = daily_yield(f.level, f.ftype, f.durability, True, True) - \
                        daily_yield(f.level, f.ftype, f.durability, False, True)
                    if gain / (FERTILIZER * tc) >= p.fertilizer_min_ratio and p.balance >= FERTILIZER * tc:
                        p.balance -= FERTILIZER * tc
                        ledger.burn_fert += FERTILIZER * tc
                        f.fert_days_left = 1
                if p.upgrade_payback_days and f.level < MAX_LEVEL:
                    cost = upgrade_cost(f.level, f.ftype)
                    gain = daily_yield(f.level + 1, f.ftype, 100, False, True) - \
                        daily_yield(f.level, f.ftype, 100, False, True)
                    if gain > 0 and cost / gain <= p.upgrade_payback_days and p.balance >= cost:
                        p.balance -= cost
                        ledger.burn_upgrade += cost
                        f.level += 1

        # monthly selling
        if day % 30 == 0:
            for p in players:
                if not p.active or p.balance <= 0:
                    continue
                share = sell_override if sell_override is not None else p.sell_share
                amt = p.balance * share
                fee = amt * fee_bps(amt) / 10_000
                ledger.sold += amt
                ledger.burn_fee += fee * FEE_BURN_SHARE
                ledger.treasury += fee * (1 - FEE_BURN_SHARE)
                p.balance -= amt + fee
            active = sum(1 for p in players if p.active)
            monthly.append({
                "month": day // 30, "active_players": active,
                "minted": round(ledger.minted), "burned": round(ledger.burned),
                "burn_ratio": round(ledger.burned / ledger.minted, 3) if ledger.minted else 0,
                "sold": round(ledger.sold), "treasury": round(ledger.treasury, 1),
                "cap_hit_days": ledger.cap_hit_days,
                "sinks": {k: round(getattr(ledger, k)) for k in
                          ("burn_tax", "burn_repair", "burn_fert", "burn_upgrade", "burn_fee")},
            })
            for k in vars(ledger):
                setattr(total, k, getattr(total, k) + getattr(ledger, k))
            ledger = Ledger()

    by_kind: dict[str, dict] = {}
    for kind in ARCHETYPES:
        ps = [p for p in players if p.kind == kind]
        by_kind[kind] = {
            "players": len(ps),
            "initial_spend": round(ps[0].initial_spend),
            "avg_earned_year": round(sum(p.earned for p in ps) / len(ps)),
            "avg_balance_end": round(sum(p.balance for p in ps) / len(ps)),
            "avg_level": round(sum(f.level for p in ps for f in p.fields) / (len(ps) * 5), 2),
        }
    totals = {k: round(v) for k, v in vars(total).items()}
    totals["burned"] = round(total.burned)
    return {"monthly": monthly, "total": totals, "by_kind": by_kind}


def breakeven_table() -> list[dict]:
    """Days to recover the field price from net yield at level 1 with full tax/repair upkeep."""
    rows = []
    for t, name in enumerate(["Грядка", "Луг", "Поле"]):
        price = FIELD_PRICE * TYPE_COST[t]
        gross = daily_yield(1, t, 80, False, True)          # avg durability ~80 with repairs
        upkeep = (TAX * TYPE_COST[t]) / 7 + (REPAIR * TYPE_COST[t]) / 12.5
        net = gross - upkeep
        rows.append({"type": name, "price": price, "gross_day": round(gross, 2),
                     "upkeep_day": round(upkeep, 2), "net_day": round(net, 2),
                     "breakeven_days": round(price / net) if net > 0 else None})
    return rows


def upgrade_table(ftype: int = 1) -> list[dict]:
    rows = []
    for lvl in [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 49]:
        cost = upgrade_cost(lvl, ftype)
        gain = daily_yield(lvl + 1, ftype, 100, False, True) - daily_yield(lvl, ftype, 100, False, True)
        rows.append({"from": lvl, "to": lvl + 1, "mult_to": round(level_mult(lvl + 1), 2),
                     "cost": cost, "gain_day": round(gain, 2), "payback_days": round(cost / gain)})
    return rows


def md_table(rows: list[dict]) -> str:
    if not rows:
        return ""
    keys = [k for k in rows[0] if not isinstance(rows[0][k], dict)]
    out = ["| " + " | ".join(keys) + " |", "|" + "---|" * len(keys)]
    for r in rows:
        out.append("| " + " | ".join(str(r[k]) for k in keys) + " |")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    scenarios = {
        "baseline (15 % churn/yr)": simulate(),
        "80 % churn": simulate(churn_total=0.80),
        "hyperinflation (everyone sells 100 %)": simulate(sell_override=1.0),
    }
    result = {"breakeven": breakeven_table(), "upgrades_type1": upgrade_table(1),
              "scenarios": scenarios}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=1))
        return

    print("## Break-even по типам полей (уровень 1, налог и ремонт оплачиваются)\n")
    print(md_table(result["breakeven"]))
    print("\n## Окупаемость апгрейдов (Луг, ×1.0)\n")
    print(md_table(result["upgrades_type1"]))
    for name, s in scenarios.items():
        print(f"\n## Сценарий: {name}\n")
        print(md_table(s["monthly"]))
        t = s["total"]
        print(f"\nИтого за год: minted {t['minted']:,}  burned {t['burned']:,} "
              f"(burn ratio {t['burned']/t['minted']:.2f})  treasury {t['treasury']:,}  "
              f"sold {t['sold']:,}  cap-hit days {t['cap_hit_days']}")
        print("\nПо архетипам:\n")
        print(md_table([{"kind": k, **v} for k, v in s["by_kind"].items()]))


if __name__ == "__main__":
    main()
