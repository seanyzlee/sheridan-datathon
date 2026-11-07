"""Resilience engine: the judges' profile and runway formula, plus the breaking point (D4).

This module is the source of truth for every headline number. The C++ core
and Tiger Data must all reproduce `profile()` and `runway()` exactly.

Usage:
    python engine.py 20111                         # base profile and runway
    python engine.py 20111 --ei 0.55 --bills 0.15  # apply a shock
    python engine.py 20111 --card ei_bills          # apply a twist-card preset
    python engine.py --all                          # build profiles for every account, time it

Definitions (docs/ROADMAP.md, Data Model):
    I = median(money_in)            S = median(money_out)
    F = median(household_bills + insurance + loan_payments)   (sum per row, then median)
    H = median(household_bills)     B = mean(avg_daily_balance) over the last 6 months
    P = loans.monthly_payment if the loan is still running at 2025-12, else 0
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from dataclasses import asdict, dataclass, replace
from functools import lru_cache

import numpy as np
import pandas as pd

from load import CACHE_DIR, load_table

# --------------------------------------------------------------------------- constants

RUNWAY_CAP = 120.0          # months; the judges cap runway at 120
BUFFER_MONTHS = 6           # B is the mean of the last 6 monthly avg_daily_balance values
REFERENCE_MONTH = pd.Period("2025-12", "M")   # "still running at 2025-12"
NO_SHORTFALL_LABEL = "no shortfall (120+)"

# EI maximum weekly benefit (canada.ca, 2026: 55% of max insurable earnings $68,900 / 52).
# Only used when shock.ei_cap_on is True; the judges' number never uses it.
EI_WEEKLY_MAX = 729.0
EI_MONTHLY_MAX = EI_WEEKLY_MAX * 52 / 12

PROFILE_CACHE = CACHE_DIR / "profile.parquet"
PROFILE_COLUMNS = [
    "account_id", "I", "S", "F", "H", "B", "P", "surplus", "runway_base", "no_shortfall_base",
    "months_of_data", "days_below_zero_6m", "has_loan", "loan_running", "defaulted",
]


# --------------------------------------------------------------------------- data types

@dataclass(frozen=True)
class Profile:
    account_id: int
    I: float
    S: float
    F: float
    H: float
    B: float
    P: float
    months_of_data: int
    days_below_zero_6m: float
    has_loan: bool
    loan_running: bool
    defaulted: bool

    @property
    def surplus(self) -> float:
        return self.I - self.S


@dataclass(frozen=True)
class Shock:
    income_factor: float = 1.0      # 1.0 = no change, 0.55 = EI
    income_months: int | None = None  # EI length; shown in the plan, NOT used by the judges' runway
    bills_pct: float = 0.0          # +x% of H added to spending (0.15 = +15%)
    spend_delta: float = 0.0        # other monthly increase in CAD (e.g. rent)
    one_off: float = 0.0            # one-off cost in CAD
    one_off_x_S: float = 0.0        # one-off cost as a multiple of S (1.0 = a full month of spending)
    ei_cap_on: bool = False         # False = judges' factor x I; True = also cap at the EI weekly max

    def one_off_cad(self, p: Profile) -> float:
        return self.one_off + self.one_off_x_S * p.S


NO_SHOCK = Shock()

# The three example twist cards.
PRESETS: dict[str, Shock] = {
    "ei_6m": Shock(income_factor=0.55, income_months=6),          # EI 55% for 6 months
    "one_month": Shock(one_off_x_S=1.0),                          # one-off = a full month of spending
    "ei_bills": Shock(income_factor=0.55, bills_pct=0.15),        # EI 55% with bills +15%
}


@dataclass(frozen=True)
class RunwayResult:
    months: float           # 0.0 .. 120.0; equals 120.0 when there is no shortfall
    no_shortfall: bool
    buffer_left: float
    income: float
    spending: float
    gap: float

    @property
    def label(self) -> str:
        return NO_SHORTFALL_LABEL if self.no_shortfall else f"{self.months:.1f} months"


@dataclass(frozen=True)
class BreakingPoint:
    target_months: float
    income_factor: float | None   # f*: income factor at which runway falls to T (None if I = 0)
    one_off: float                # X*: largest one-off (CAD) that still leaves T months
    bills_pct: float | None       # b*: largest bills increase (fraction of H) for T months (None if H = 0)
    already_broken: bool          # the current shock already gives runway < T


# --------------------------------------------------------------------------- the judges' formula

def _income(p: Profile, s: Shock) -> float:
    income = s.income_factor * p.I
    if s.ei_cap_on and s.income_factor < 1.0:
        income = min(income, EI_MONTHLY_MAX)
    return income


def _spending(p: Profile, s: Shock) -> float:
    return p.S + s.bills_pct * p.H + s.spend_delta


def runway(p: Profile, s: Shock = NO_SHOCK) -> RunwayResult:
    """Months of runway, exactly as the judges define it."""
    buffer_left = p.B - s.one_off_cad(p)
    income = _income(p, s)
    spending = _spending(p, s)
    gap = spending - income
    if buffer_left <= 0:
        months, none = 0.0, False
    elif gap <= 0:
        months, none = RUNWAY_CAP, True
    else:
        months, none = round(min(buffer_left / gap, RUNWAY_CAP), 1), False
    return RunwayResult(months, none, buffer_left, income, spending, gap)


def runway_vec(df: pd.DataFrame, s: Shock = NO_SHOCK) -> pd.DataFrame:
    """Vectorised runway over a profiles DataFrame (columns I, S, H, B). Same rules as runway()."""
    I, S, H, B = (df[c].to_numpy(float) for c in ("I", "S", "H", "B"))
    buffer_left = B - (s.one_off + s.one_off_x_S * S)
    income = s.income_factor * I
    if s.ei_cap_on and s.income_factor < 1.0:
        income = np.minimum(income, EI_MONTHLY_MAX)
    gap = S + s.bills_pct * H + s.spend_delta - income
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.round(np.minimum(buffer_left / gap, RUNWAY_CAP), 1)
    no_shortfall = (buffer_left > 0) & (gap <= 0)
    months = np.where(buffer_left <= 0, 0.0, np.where(gap <= 0, RUNWAY_CAP, ratio))
    return pd.DataFrame(
        {"account_id": df["account_id"].to_numpy(), "runway": months, "no_shortfall": no_shortfall,
         "buffer_left": buffer_left, "income": income, "gap": gap},
        index=df.index,
    )


def breaking_point(p: Profile, s: Shock = NO_SHOCK, T: float = 6.0) -> BreakingPoint:
    """The formula in reverse (D4): how much more shock the customer can take and still last T months.

    Each limit varies one lever and holds the rest of the shock fixed:
        f* = (S' - (B - one_off) / T) / I            S' = shocked spending
        X* = B - T * gap                             gap = shocked spending - shocked income
        b* = ((B - one_off) / T + income - S - spend_delta) / H
    """
    if T <= 0:
        raise ValueError("target months T must be positive")
    one_off = s.one_off_cad(p)
    buffer_left = p.B - one_off
    income = _income(p, s)
    spending = _spending(p, s)
    gap = spending - income

    f_star = (spending - buffer_left / T) / p.I if p.I > 0 else None
    # With no shortfall the buffer only has to stay positive, so the most they can take is B itself.
    x_star = p.B - T * max(gap, 0.0)
    b_star = (buffer_left / T + income - p.S - s.spend_delta) / p.H if p.H > 0 else None

    rw = runway(p, s)
    already_broken = not rw.no_shortfall and rw.months < T
    return BreakingPoint(T, f_star, x_star, b_star, already_broken)


# --------------------------------------------------------------------------- profiles

def _loan_table() -> pd.DataFrame:
    loans = load_table("loans")
    end = loans["loan_start"].dt.to_period("M") + loans["duration_months"]
    loans = loans.assign(loan_running=end > REFERENCE_MONTH)
    return loans.set_index("account_id")[["monthly_payment", "loan_running", "defaulted", "status"]]


def loan_status_check() -> pd.DataFrame:
    """Loans where the date rule (start + duration past 2025-12) disagrees with status C/D."""
    loans = _loan_table()
    by_status = loans["status"].isin(["C", "D"])
    return loans.loc[loans["loan_running"] != by_status].reset_index()


def _build_profiles(monthly: pd.DataFrame, loans: pd.DataFrame, accounts: pd.Index | None = None) -> pd.DataFrame:
    """Profiles for every account in `monthly` (sorted by account_id, month)."""
    m = monthly.sort_values(["account_id", "month"], kind="stable")
    m = m.assign(fixed=m["household_bills"] + m["insurance"] + m["loan_payments"])
    g = m.groupby("account_id", sort=True)
    last6 = g.tail(BUFFER_MONTHS).groupby("account_id", sort=True)

    prof = pd.DataFrame({
        "I": g["money_in"].median(),
        "S": g["money_out"].median(),
        "F": g["fixed"].median(),
        "H": g["household_bills"].median(),
        "B": last6["avg_daily_balance"].mean(),
        "months_of_data": g.size(),
        "days_below_zero_6m": last6["days_below_zero"].sum(),
    })
    if accounts is not None:
        prof = prof.reindex(accounts)   # accounts with no monthly rows get NaN, filled below

    lj = loans.reindex(prof.index)
    prof["has_loan"] = lj["monthly_payment"].notna()
    prof["loan_running"] = lj["loan_running"].fillna(False).astype(bool)
    prof["P"] = np.where(prof["loan_running"], lj["monthly_payment"], 0.0)
    prof["defaulted"] = lj["defaulted"].fillna(0).astype(bool)

    # An account with no rows at all: no income, spending or buffer.
    for c in ("I", "S", "F", "H", "B", "days_below_zero_6m"):
        prof[c] = prof[c].fillna(0.0).astype(float)
    prof["months_of_data"] = prof["months_of_data"].fillna(0).astype(int)

    prof = prof.rename_axis("account_id").reset_index()
    prof["surplus"] = prof["I"] - prof["S"]
    rw = runway_vec(prof)
    prof["runway_base"] = rw["runway"]
    prof["no_shortfall_base"] = rw["no_shortfall"]
    return prof[PROFILE_COLUMNS]


@lru_cache(maxsize=1)
def profiles_all(rebuild: bool = False) -> pd.DataFrame:
    """Profiles for all 4,500 accounts, cached in memory and in cache/profile.parquet."""
    if not rebuild and PROFILE_CACHE.exists():
        sources = [CACHE_DIR / f"{t}.parquet" for t in ("monthly_summary", "loans", "accounts")]
        if all(PROFILE_CACHE.stat().st_mtime >= src.stat().st_mtime for src in sources if src.exists()):
            return pd.read_parquet(PROFILE_CACHE)
    cols = ["account_id", "month", "money_in", "money_out", "household_bills", "insurance",
            "loan_payments", "avg_daily_balance", "days_below_zero"]
    accounts = pd.Index(load_table("accounts", columns=["account_id"])["account_id"].sort_values(), name="account_id")
    prof = _build_profiles(load_table("monthly_summary", columns=cols), _loan_table(), accounts)
    prof.to_parquet(PROFILE_CACHE, index=False)
    return prof


@lru_cache(maxsize=1)
def _profile_index() -> pd.DataFrame:
    return profiles_all().set_index("account_id")


def profile(account_id: int) -> Profile:
    """The judges' profile for one account."""
    try:
        row = _profile_index().loc[int(account_id)]
    except KeyError:
        raise KeyError(f"Unknown account_id {account_id}") from None
    return profile_from_row(int(account_id), row)


def profile_from_row(account_id: int, row) -> Profile:
    return Profile(
        account_id=account_id,
        I=float(row["I"]), S=float(row["S"]), F=float(row["F"]), H=float(row["H"]),
        B=float(row["B"]), P=float(row["P"]),
        months_of_data=int(row["months_of_data"]),
        days_below_zero_6m=float(row["days_below_zero_6m"]),
        has_loan=bool(row["has_loan"]), loan_running=bool(row["loan_running"]),
        defaulted=bool(row["defaulted"]),
    )


def profile_from_monthly(account_id: int, monthly: pd.DataFrame, loans: pd.DataFrame | None = None) -> Profile:
    """Profile straight from one account's monthly rows (used for edge-case tests and live data)."""
    if loans is None:
        loans = pd.DataFrame(columns=["monthly_payment", "loan_running", "defaulted"],
                             index=pd.Index([], name="account_id"))
    rows = monthly.assign(account_id=account_id)
    prof = _build_profiles(rows, loans, pd.Index([account_id], name="account_id"))
    return profile_from_row(account_id, prof.iloc[0])


# --------------------------------------------------------------------------- CLI

def _fmt_money(x: float) -> str:
    return f"${x:,.2f}"


def _report(p: Profile, s: Shock, T: float) -> str:
    base, shocked = runway(p), runway(p, s)
    bp = breaking_point(p, s, T)
    lines = [
        f"Account {p.account_id}  ({p.months_of_data} months of data"
        f"{', loan running' if p.loan_running else ''}{', DEFAULTED' if p.defaulted else ''})",
        f"  I income      {_fmt_money(p.I):>14}    S spending   {_fmt_money(p.S):>14}",
        f"  F fixed       {_fmt_money(p.F):>14}    H bills      {_fmt_money(p.H):>14}",
        f"  B buffer      {_fmt_money(p.B):>14}    P loan       {_fmt_money(p.P):>14}",
        f"  surplus       {_fmt_money(p.surplus):>14}    days < 0 (6m) {p.days_below_zero_6m:>13.0f}",
        f"Runway, no shock: {base.label}",
    ]
    if s != NO_SHOCK:
        parts = {k: v for k, v in asdict(s).items() if v != getattr(NO_SHOCK, k)}
        lines += [
            f"Shock {parts}",
            f"  buffer left {_fmt_money(shocked.buffer_left)}, income {_fmt_money(shocked.income)}, "
            f"spending {_fmt_money(shocked.spending)}, gap {_fmt_money(shocked.gap)}",
            f"Runway, shocked:  {shocked.label}",
        ]
        if s.income_months:
            ok = shocked.no_shortfall or shocked.months >= s.income_months
            lines.append(f"  Lasts the {s.income_months} months of EI? {'yes' if ok else 'NO'}")
    f = "n/a (no income)" if bp.income_factor is None else f"{bp.income_factor:.1%}"
    b = "n/a (no bills)" if bp.bills_pct is None else f"{bp.bills_pct:+.1%}"
    x = "none (short even with no one-off)" if bp.one_off < 0 else _fmt_money(bp.one_off)
    lines += [
        f"Breaking point for {T:g} months{' (already below target)' if bp.already_broken else ''}:",
        f"  income factor below {f}   one-off above {x}   bills increase above {b}",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("account_id", nargs="?", type=int)
    ap.add_argument("--card", choices=sorted(PRESETS), help="start from a twist-card preset")
    ap.add_argument("--ei", type=float, help="income factor, e.g. 0.55")
    ap.add_argument("--months", type=int, help="EI length in months")
    ap.add_argument("--bills", type=float, help="bills increase as a fraction of H, e.g. 0.15")
    ap.add_argument("--spend", type=float, help="other monthly increase in CAD")
    ap.add_argument("--one-off", type=float, help="one-off cost in CAD")
    ap.add_argument("--one-off-s", type=float, help="one-off cost as a multiple of S")
    ap.add_argument("--cap", action="store_true", help="apply the EI weekly maximum")
    ap.add_argument("--target", type=float, default=6.0, help="target months for the breaking point")
    ap.add_argument("--all", action="store_true", help="rebuild and time profiles for every account")
    a = ap.parse_args(argv)

    if a.all:
        t0 = time.perf_counter()
        profiles_all.cache_clear()
        prof = profiles_all(rebuild=True)
        t1 = time.perf_counter()
        profiles_all.cache_clear()
        prof = profiles_all()
        results = [runway(profile_from_row(int(r.account_id), r._asdict()), PRESETS["ei_bills"])
                   for r in prof.itertuples(index=False)]
        t2 = time.perf_counter()
        print(f"Built {len(prof):,} profiles in {t1 - t0:.2f}s; "
              f"loaded from cache + runway for all in {t2 - t1:.3f}s")
        print(f"No-shock runway: {prof['no_shortfall_base'].sum():,} with no shortfall, "
              f"{(prof['runway_base'] < 3).sum():,} under 3 months")
        print(f"ei_bills twist: {sum(r.months < 3 for r in results):,} under 3 months")
        mism = loan_status_check()
        print(f"Loan running rule vs status C/D: {len(mism)} mismatches")
        return 0

    if a.account_id is None:
        ap.error("give an account_id, or --all")

    s = PRESETS[a.card] if a.card else NO_SHOCK
    overrides = {k: v for k, v in {
        "income_factor": a.ei, "income_months": a.months, "bills_pct": a.bills, "spend_delta": a.spend,
        "one_off": a.one_off, "one_off_x_S": a.one_off_s,
    }.items() if v is not None}
    if a.cap:
        overrides["ei_cap_on"] = True
    s = replace(s, **overrides)

    try:
        p = profile(a.account_id)
    except KeyError as e:
        print(e.args[0], file=sys.stderr)
        return 1
    print(_report(p, s, a.target))
    return 0


if __name__ == "__main__":
    sys.exit(main())
