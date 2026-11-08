"""Shock Autopilot: notice an income shock in the customer's own transactions, then build a ranked
recovery plan whose every step is priced and measured by the engine.

1. detect(): compares the latest month's money in with the customer's usual income (I, a median).
   Works from the live Tiger Data feed or the Parquet cache, whichever the profile came from.
2. ladder(): the recovery steps, each a real spending category from the customer's last 12 months
   (transfers out, card and cash spending, the loan payment), with the runway each step adds when
   they are applied in order. Every runway is engine.runway, the judges' formula.
3. evaluate(): the runway and simulated chance for whichever steps the customer switches on.

The browser never calculates: it sends the shock and the chosen step ids and draws what comes back.
"""

from __future__ import annotations

from dataclasses import astuple, replace
from functools import lru_cache

import numpy as np
import pandas as pd

import engine
import plan
import simulate
from engine import Profile, Shock

DETECT_BELOW = 0.6          # latest month's income under 60% of usual counts as a shock
WINDOW = 12                 # months of history used to price each step


def _money(x: float) -> str:
    return f"-${-x:,.0f}" if x < 0 else f"${x:,.0f}"


def _months(r: engine.RunwayResult) -> str:
    return "more than 10 years" if r.no_shortfall or r.months >= engine.RUNWAY_CAP else f"{r.months:.1f} months"


def _months_value(r: engine.RunwayResult) -> float:
    return engine.RUNWAY_CAP if r.no_shortfall else float(r.months)


# --------------------------------------------------------------------------- 1. detection

def detect(p: Profile, monthly: pd.DataFrame) -> dict:
    """Did income just drop? Uses only the customer's own months (latest vs their usual income)."""
    m = monthly.sort_values("month")
    if m.empty or p.I <= 0:
        return {"detected": False}
    last = m.iloc[-1]
    ratio = float(last["money_in"]) / p.I
    month = pd.Timestamp(last["month"]).strftime("%b %Y")
    if ratio >= DETECT_BELOW:
        return {"detected": False, "month": month, "ratio": round(ratio, 3)}
    factor = round(max(0.0, min(1.0, ratio)), 2)
    return {
        "detected": True, "month": month, "ratio": round(ratio, 3),
        "income_seen": _money(float(last["money_in"])), "income_usual": _money(p.I),
        "drop": f"{(1 - ratio) * 100:.0f}%",
        "message": (f"In {month}, money in was {_money(float(last['money_in']))}, "
                    f"{(1 - ratio) * 100:.0f}% below the usual {_money(p.I)} a month."),
        "suggested_shock": {**Shock(income_factor=factor, income_months=6).__dict__},
    }


# --------------------------------------------------------------------------- 2. the recovery ladder

def _typical(monthly: pd.DataFrame, col: str) -> float:
    v = monthly.sort_values("month").tail(WINDOW)[col]
    return float(np.median(v)) if len(v) else 0.0


def steps(p: Profile, monthly: pd.DataFrame) -> list[dict]:
    """Candidate steps, cheapest-to-do first; only those that free up real money."""
    out = []
    transfers = _typical(monthly, "transfers_out_other")
    card = _typical(monthly, "card_withdrawals")
    cash = _typical(monthly, "cash_withdrawals_genuine")
    if transfers >= 1:
        out.append({"id": "pause_transfers", "label": "Pause transfers to other accounts",
                    "detail": "Hold off on savings and other regular transfers until income is back.",
                    "saving": transfers})
    if card >= 1:
        out.append({"id": "trim_card", "label": "Spend a quarter less on the card",
                    "detail": "Trim eating out, shopping and subscriptions on the card.", "saving": 0.25 * card})
    if cash >= 1:
        out.append({"id": "trim_cash", "label": "Take out a quarter less cash",
                    "detail": "Plan cash withdrawals for the week ahead.", "saving": 0.25 * cash})
    if p.loan_running and p.P >= 1:
        out.append({"id": "defer_loan", "label": "Ask us to defer the loan payment",
                    "detail": "A short payment deferral while income recovers (needs a conversation with us).",
                    "saving": float(p.P)})
    return out


def _with_cuts(s: Shock, saving: float) -> Shock:
    # A recovery step lowers monthly spending: a negative 'other increase' in the judges' formula.
    return replace(s, spend_delta=s.spend_delta - saving)


def ladder(p: Profile, s: Shock, monthly: pd.DataFrame) -> list[dict]:
    """Each step with the runway it adds when the steps are taken in order."""
    rows, saved = [], 0.0
    prev = engine.runway(p, s)
    for st in steps(p, monthly):
        saved += st["saving"]
        now = engine.runway(p, _with_cuts(s, saved))
        added = _months_value(now) - _months_value(prev)
        rows.append({**st, "saving_text": f"{_money(st['saving'])} a month",
                     "adds": round(added, 1),
                     "adds_text": ("enough to stop the shortfall" if now.no_shortfall and not prev.no_shortfall
                                   else f"+{added:.1f} months" if added > 0 else "no change"),
                     "runway_before": _months_value(prev), "runway_after": _months_value(now),
                     "no_shortfall_after": bool(now.no_shortfall),
                     "runway_after_text": _months(now)})
        prev = now
    return rows


# --------------------------------------------------------------------------- 3. any combination the customer picks

@lru_cache(maxsize=1024)
def _survival(profile_t: tuple, shock_t: tuple, target: float) -> float:
    return float(simulate.one(Profile(*profile_t), Shock(*shock_t), target=target)["survival"])


def evaluate(p: Profile, s: Shock, monthly: pd.DataFrame, chosen: list[str]) -> dict:
    target = float(s.income_months or plan.TARGET_RUNWAY)
    all_steps = {st["id"]: st for st in steps(p, monthly)}
    picked = [all_steps[i] for i in chosen if i in all_steps]
    saving = sum(st["saving"] for st in picked)
    before = engine.runway(p, s)
    after = engine.runway(p, _with_cuts(s, saving))
    surv_before = _survival(astuple(p), astuple(s), target)
    surv_after = _survival(astuple(p), astuple(_with_cuts(s, saving)), target)
    makes_it = after.no_shortfall or after.months >= target
    return {
        "target": target,
        "chosen": [st["id"] for st in picked],
        "saving_text": f"{_money(saving)} a month",
        "before": {"months": _months_value(before), "text": _months(before), "survival": surv_before},
        "after": {"months": _months_value(after), "text": _months(after), "survival": surv_after},
        "makes_it": makes_it,
        "verdict": (f"With these steps the savings last {_months(after)}, "
                    + ("enough to get through" if makes_it else "still short of")
                    + f" the {target:g} months."),
    }
