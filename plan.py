"""Plans and explanations built on the judges' formula (Phases 2 and 3a).

Every number here comes from engine.runway(); nothing replaces it.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from functools import lru_cache

import numpy as np
import pandas as pd

import engine
import risk
from engine import Profile, Shock, runway
from load import load_table

TARGET_RUNWAY = 6.0          # months the backup plan aims for


# --------------------------------------------------------------------------- facts per account

@lru_cache(maxsize=1)
def _account_facts() -> pd.DataFrame:
    m = load_table("monthly_summary", columns=["account_id", "days_below_zero"])
    ever = m.groupby("account_id")["days_below_zero"].sum().gt(0).rename("ever_below_zero")
    acc = load_table("accounts", columns=["account_id", "district_id"])
    dist = load_table("districts", columns=["district_id", "district_name", "region", "average_salary",
                                            "unemployment_rate_2023"])
    facts = acc.merge(dist, on="district_id", how="left", validate="m:1").set_index("account_id")
    facts = facts.join(ever).join(risk.risk_factors_all().set_index("account_id")[["flex_share", "sd_in", "sd_out"]])
    facts["ever_below_zero"] = facts["ever_below_zero"].fillna(False).astype(bool)
    return facts


def facts(account_id: int) -> pd.Series:
    return _account_facts().loc[int(account_id)]


# --------------------------------------------------------------------------- risk flags

@dataclass(frozen=True)
class Flag:
    level: str      # "high", "medium" or "ok"
    text: str


def risk_flags(p: Profile) -> list[Flag]:
    f = facts(p.account_id)
    flags = []
    if p.days_below_zero_6m > 0:
        flags.append(Flag("high", f"Balance was below zero on {p.days_below_zero_6m:.0f} days in the last 6 months"))
    elif f["ever_below_zero"]:
        flags.append(Flag("medium", "Balance has gone below zero before (not in the last 6 months)"))
    if p.defaulted:
        flags.append(Flag("high", "Has a loan in default"))
    if p.S > 0 and p.B < p.S:
        flags.append(Flag("high", f"Buffer covers less than one month of spending ({p.B / p.S:.1f} months)"))
    if p.surplus < 0:
        flags.append(Flag("medium", f"Spends ${-p.surplus:,.0f} more than they earn in a typical month"))
    if p.loan_running and p.I > 0 and p.P / p.I > 0.3:
        flags.append(Flag("medium", f"Loan payment takes {p.P / p.I:.0%} of income"))
    if p.months_of_data < 6:
        flags.append(Flag("medium", f"Limited history: {p.months_of_data} months of data"))
    if not flags:
        flags.append(Flag("ok", "No warning signs in the last 6 months"))
    return flags


# --------------------------------------------------------------------------- peers

@lru_cache(maxsize=1)
def _peer_table() -> pd.DataFrame:
    prof = engine.profiles_all().set_index("account_id")
    df = prof[["I", "S", "B", "runway_base"]].join(_account_facts()[["region"]])
    df["buffer_months"] = np.where(df["S"] > 0, df["B"] / df["S"].where(df["S"] > 0, 1), np.inf)
    df["income_band"] = pd.qcut(df["I"].rank(method="first"), 5, labels=False)
    return df


def peers(account_id: int) -> dict:
    """How this customer's buffer (in months of spending) compares with similar customers."""
    df = _peer_table()
    me = df.loc[int(account_id)]
    group = df[(df["region"] == me["region"]) & (df["income_band"] == me["income_band"])]
    better = float((group["buffer_months"] < me["buffer_months"]).mean())
    return {"pct_better": better, "n_peers": int(len(group)), "region": me["region"],
            "income_band": int(me["income_band"]) + 1, "buffer_months": float(me["buffer_months"]),
            "peer_median_buffer_months": float(group["buffer_months"].replace(np.inf, np.nan).median())}


# --------------------------------------------------------------------------- explain the change

def waterfall(p: Profile, s: Shock) -> pd.DataFrame:
    """Base runway, then the effect of each part of the shock in turn, then the new runway.

    Runway isn't additive, so each step applies one more part of the shock to the previous one.
    """
    def months(shock: Shock) -> float:
        return runway(p, shock).months

    steps = [("Base runway", Shock())]
    cur = Shock()
    parts = [
        ("Income falls", dict(income_factor=s.income_factor, ei_cap_on=s.ei_cap_on)),
        ("Bills rise", dict(bills_pct=s.bills_pct)),
        ("Other costs rise", dict(spend_delta=s.spend_delta)),
        ("One-off cost", dict(one_off=s.one_off, one_off_x_S=s.one_off_x_S)),
    ]
    rows = [("Base runway", months(cur), "absolute")]
    for label, change in parts:
        nxt = replace(cur, **change)
        if nxt == cur:
            continue
        rows.append((label, months(nxt) - months(cur), "relative"))
        cur = nxt
    rows.append(("New runway", months(s), "total"))
    return pd.DataFrame(rows, columns=["step", "months", "measure"])


def burn_down(p: Profile, s: Shock, months: int = 24) -> pd.DataFrame:
    """Month-by-month balance under the shock, the judges' way (the gap every month)."""
    r = runway(p, s)
    t = np.arange(months + 1)
    bal = r.buffer_left - r.gap * t
    out = pd.DataFrame({"month": t, "balance": bal})
    # Also show what happens when EI ends, if the card says how long it lasts
    if s.income_months and s.income_factor < 1:
        after = np.where(t <= s.income_months, bal,
                         r.buffer_left - r.gap * s.income_months - (r.spending) * (t - s.income_months))
        out["balance_ei_ends"] = after
    return out


# --------------------------------------------------------------------------- plans

@dataclass(frozen=True)
class GoalPlan:
    target: float
    months_to_target: float | None     # None when they can't get there from their surplus
    monthly_cut_needed: float           # to reach the target in 12 months when the surplus isn't enough
    cut_pct_of_flexible: float | None
    reason: str


def goal_plan(p: Profile) -> GoalPlan:
    """Emergency fund: 3 x S (6 x S if the balance has ever gone below zero)."""
    f = facts(p.account_id)
    k = 6 if f["ever_below_zero"] else 3
    target = k * p.S
    reason = f"{k} months of spending" + (" (balance has gone below zero before)" if k == 6 else "")
    gap = target - p.B
    flex = p.S * float(f["flex_share"])
    if gap <= 0:
        return GoalPlan(target, 0.0, 0.0, 0.0, reason)
    if p.surplus > 0:
        return GoalPlan(target, gap / p.surplus, 0.0, 0.0, reason)
    need = gap / 12 - p.surplus
    return GoalPlan(target, None, need, need / flex if flex > 0 else None, reason)


@dataclass(frozen=True)
class BackupPlan:
    target_months: float
    already_ok: bool
    cut_amount: float                   # $ per month to cut from flexible spending
    flexible: float                     # $ per month of flexible spending (card, cash, other transfers)
    cut_pct: float | None               # share of flexible spending to cut; None if no flexible spending
    possible: bool
    new_runway: float


def backup_plan(p: Profile, s: Shock, target: float = TARGET_RUNWAY) -> BackupPlan:
    """If the shock hits: cut flexible spending first (bills, insurance and loans stay fixed)."""
    r = runway(p, s)
    flex = p.S * float(facts(p.account_id)["flex_share"])
    if r.no_shortfall or r.months >= target:
        return BackupPlan(target, True, 0.0, flex, 0.0, True, r.months)
    if r.buffer_left <= 0:
        return BackupPlan(target, False, float("nan"), flex, None, False, 0.0)
    cut = r.gap - r.buffer_left / target
    pct = cut / flex if flex > 0 else None
    possible = pct is not None and pct <= 1.0
    new = runway(p, replace(s, spend_delta=s.spend_delta - min(cut, flex))).months
    return BackupPlan(target, False, cut, flex, pct, possible, new)


# --------------------------------------------------------------------------- money flow

def money_flow(p: Profile, s: Shock) -> dict:
    """Where a typical month's money comes from and goes after the shock, balanced so both sides add up.

    Out: fixed costs (F, capped at S), the rest of typical spending (flexible), the bills rise (bills_pct x H)
    and any other increase. A cut (negative other increase) comes off flexible spending. In: the income after
    the shock, then whatever is taken from savings to cover the rest. If income is larger, the surplus is an
    extra "Left over" item on the out side. With no cut bigger than flexible spending, "From savings" equals
    the judges' monthly gap.
    """
    r = runway(p, s)
    fixed = float(min(max(p.F, 0.0), max(p.S, 0.0)))
    flexible = float(max(p.S, 0.0) - fixed)
    cut = min(s.spend_delta, 0.0)
    out = [{"key": "fixed", "label": "Fixed costs", "amount": fixed},
           {"key": "flexible", "label": "Everyday spending", "amount": max(0.0, flexible + cut)}]
    if s.bills_pct and p.H:
        out.append({"key": "bills", "label": f"Bills up {s.bills_pct:.0%}", "amount": float(s.bills_pct * p.H)})
    if s.spend_delta > 0:
        out.append({"key": "other", "label": "Other costs up", "amount": float(s.spend_delta)})
    total_out = sum(o["amount"] for o in out)
    income = float(max(r.income, 0.0))
    used = min(income, total_out)
    inflow = [{"key": "income", "label": "Income" if s.income_factor >= 1 else "Income after the shock", "amount": used}]
    if total_out > used:
        inflow.append({"key": "savings", "label": "From savings", "amount": total_out - used})
    if income > used:
        out.append({"key": "left", "label": "Left over", "amount": income - used})
        inflow[0]["amount"] = income
    return {"in": inflow, "out": out, "total": float(sum(i["amount"] for i in inflow))}


# --------------------------------------------------------------------------- plain-language summary

def _m(x: float) -> str:
    return "more than 10 years" if x >= engine.RUNWAY_CAP else f"{x:.1f} months"


def summary(p: Profile, s: Shock, survival: float | None = None, target: float | None = None) -> str:
    base, shocked = runway(p, s.__class__()), runway(p, s)
    bp = engine.breaking_point(p, s, target or TARGET_RUNWAY)
    plan = backup_plan(p, s)
    out = []
    if shocked.buffer_left <= 0:
        out.append("Their savings are already used up after this shock, so they would need help right away.")
    elif shocked.no_shortfall:
        out.append("Even with this shock, money coming in still covers what goes out, so their savings aren't touched.")
    else:
        out.append(f"With this shock their savings would last about {_m(shocked.months)}"
                   + (f", down from {_m(base.months)} today." if not base.no_shortfall else ", where today they never run short."))
    if s.income_months and s.income_factor < 1 and not shocked.no_shortfall:
        ok = shocked.months >= s.income_months
        out.append(f"That {'covers' if ok else 'does not cover'} the {s.income_months} months on EI"
                   + (f"; across our simulated futures they make it {survival:.0%} of the time." if survival is not None else "."))
    elif survival is not None and target:
        out.append(f"Across our simulated futures they get through {target:g} months {survival:.0%} of the time.")
    if not plan.already_ok and plan.possible and plan.cut_pct is not None:
        out.append(f"Cutting flexible spending (card, cash and other transfers) by {plan.cut_pct:.0%}, about "
                   f"${plan.cut_amount:,.0f} a month, would stretch it to {_m(plan.new_runway)}.")
    elif not plan.already_ok:
        out.append("Cutting flexible spending alone can't reach 6 months; this customer needs a payment plan "
                   "or a top-up to their emergency fund.")
    elif bp.income_factor is not None and 0 < bp.income_factor < 1 and not bp.already_broken:
        out.append(f"They stay above 6 months unless income falls below {bp.income_factor:.0%} of normal.")
    return " ".join(out)
