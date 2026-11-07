"""Discovery (Phase 4): every table behind a chart or a claim, as a named, repeatable function.

    python discovery.py          # recompute everything, cache to cache/discovery/*.parquet, print the findings

The app and discovery.ipynb read the cached tables (so the discovery tab works offline) and fall
back to computing them. Everything is built on engine.py, so it uses the judges' definitions.
"""

from __future__ import annotations

import sys
import time
from functools import lru_cache

import numpy as np
import pandas as pd

import engine
import risk
from engine import PRESETS, Shock
from load import CACHE_DIR, load_table

OUT = CACHE_DIR / "discovery"
AS_OF = pd.Period("2025-12", "M")

# Early-warning rules, checked month by month using only data available at that month.
RULES = {
    "stress_ei_lt2": ("Runway under the EI twist below 2 months", Shock(income_factor=0.55), 2.0),
    "base_lt3": ("Runway with no shock below 3 months", Shock(), 3.0),
    "base_lt6": ("Runway with no shock below 6 months", Shock(), 6.0),
    "stress_one_month_lt3": ("Runway after a one-month one-off below 3 months", PRESETS["one_month"], 3.0),
}
MAIN_RULE = "stress_ei_lt2"


def _cached(name: str, build, refresh: bool = False) -> pd.DataFrame:
    path = OUT / f"{name}.parquet"
    if path.exists() and not refresh:
        return pd.read_parquet(path)
    df = build()
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    return df


# --------------------------------------------------------------------------- customer attributes

@lru_cache(maxsize=1)
def customers() -> pd.DataFrame:
    """Profiles plus region, district, owner's age and income band."""
    prof = engine.profiles_all()
    acc = load_table("accounts", columns=["account_id", "district_id", "account_opened"])
    dist = load_table("districts", columns=["district_id", "district_name", "region", "average_salary",
                                            "unemployment_rate_2023"])
    disp = load_table("dispositions")
    cli = load_table("clients", columns=["client_id", "birth_date"])
    owner = disp[disp["type"] == "owner"].merge(cli, on="client_id").drop_duplicates("account_id")
    owner["age"] = (pd.Timestamp("2025-12-31") - owner["birth_date"]).dt.days / 365.25
    df = (prof.merge(acc, on="account_id", how="left", validate="1:1")
          .merge(dist, on="district_id", how="left", validate="m:1")
          .merge(owner[["account_id", "age"]], on="account_id", how="left", validate="1:1"))
    df["income_band"] = pd.qcut(df["I"].rank(method="first"), 5, labels=["Lowest", "Low", "Middle", "High", "Highest"])
    df["age_band"] = pd.cut(df["age"], [0, 30, 45, 60, 120], labels=["Under 30", "30-44", "45-59", "60+"])
    return df


# --------------------------------------------------------------------------- twists across the bank

def twist_impact(refresh: bool = False) -> pd.DataFrame:
    """For each example twist: share of all customers under 3 / under 6 months and out of money."""
    def build():
        c = customers()
        rows = []
        for name, s in [("No shock", Shock()), ("EI 55% for 6 months", PRESETS["ei_6m"]),
                        ("One-off = a month of spending", PRESETS["one_month"]),
                        ("EI 55% + bills +15%", PRESETS["ei_bills"])]:
            r = engine.runway_vec(c, s)["runway"]
            rows.append({"twist": name, "under_3": (r < 3).mean(), "under_6": (r < 6).mean(),
                         "out_of_money": (r == 0).mean(), "median_runway": r.median()})
        return pd.DataFrame(rows)
    return _cached("twist_impact", build, refresh)


def fragile_groups(refresh: bool = False) -> pd.DataFrame:
    """Share not lasting 6 months on EI (55%), by income band, age band and region."""
    def build():
        c = customers().copy()
        c["fails"] = engine.runway_vec(c, PRESETS["ei_6m"])["runway"] < 6
        parts = []
        for col in ("income_band", "age_band", "region"):
            g = c.groupby(col, observed=True)["fails"].agg(["mean", "size"]).reset_index()
            parts.append(g.rename(columns={col: "group", "mean": "share_fail_6m_ei", "size": "customers"})
                         .assign(dimension=col))
        return pd.concat(parts, ignore_index=True)[["dimension", "group", "share_fail_6m_ei", "customers"]]
    return _cached("fragile_groups", build, refresh)


def tipping_point(refresh: bool = False) -> pd.DataFrame:
    """Share under 3 months as bills rise 0-50%, with and without the EI twist (judges' formula)."""
    def build():
        c = customers()
        rows = []
        for income, label in [(1.0, "Employed"), (0.55, "On EI (55%)")]:
            for b in range(0, 51, 2):
                r = engine.runway_vec(c, Shock(income_factor=income, bills_pct=b / 100))["runway"]
                rows.append({"income": label, "bills_pct": b / 100, "under_3": (r < 3).mean(), "under_6": (r < 6).mean()})
        return pd.DataFrame(rows)
    return _cached("tipping_point", build, refresh)


def survival_sweep(refresh: bool = False) -> pd.DataFrame:
    """C++ sweep: average chance of making 6 months on EI as bills rise (Monte Carlo, D1 + D3)."""
    def build():
        import simulate
        bills = np.arange(0, 0.51, 0.05)
        shocks = [Shock(income_factor=0.55, income_months=6, bills_pct=float(b)) for b in bills]
        t0 = time.perf_counter()
        surv = simulate.sweep(shocks, target=6.0, n_paths=500, months=6)
        secs = time.perf_counter() - t0
        return pd.DataFrame({"bills_pct": bills, "mean_survival": surv.mean(axis=1),
                             "share_likely_fail": (surv < 0.5).mean(axis=1), "seconds_total": secs,
                             "backend": simulate.BACKEND})
    return _cached("survival_sweep", build, refresh)


def regional(refresh: bool = False) -> pd.DataFrame:
    """Per district: share failing 6 months on EI against unemployment and average salary."""
    def build():
        c = customers().copy()
        c["fails"] = engine.runway_vec(c, PRESETS["ei_6m"])["runway"] < 6
        return (c.groupby(["district_id", "district_name", "region"], observed=True)
                .agg(share_fail=("fails", "mean"), customers=("fails", "size"),
                     unemployment=("unemployment_rate_2023", "first"), salary=("average_salary", "first"),
                     median_buffer=("B", "median"))
                .reset_index())
    return _cached("regional", build, refresh)


def ei_cap_effect(refresh: bool = False) -> pd.DataFrame:
    """D8: the judges' EI (55% x I) against EI capped at the real 2026 weekly maximum."""
    def build():
        c = customers()
        judges = engine.runway_vec(c, Shock(income_factor=0.55))
        capped = engine.runway_vec(c, Shock(income_factor=0.55, ei_cap_on=True))
        return pd.DataFrame({
            "account_id": c["account_id"], "I": c["I"], "runway_judges": judges["runway"],
            "runway_capped": capped["runway"], "hit_by_cap": 0.55 * c["I"] > engine.EI_MONTHLY_MAX})
    return _cached("ei_cap_effect", build, refresh)


# --------------------------------------------------------------------------- proof against real defaults (D5, D6)

def default_by_band(refresh: bool = False) -> pd.DataFrame:
    """Default rate of the 682 loans by today's runway band (concurrent view; see early_warning for timing)."""
    def build():
        loans = load_table("loans", columns=["account_id", "defaulted"])
        d = loans.merge(engine.profiles_all().drop(columns="defaulted"), on="account_id")
        d["band"] = pd.cut(d["runway_base"], [-0.1, 3, 6, 12, 119.99, 120],
                           labels=["Under 3", "3-6", "6-12", "12-120", "No shortfall / 120+"])
        return (d.groupby("band", observed=False)["defaulted"].agg(["mean", "sum", "size"]).reset_index()
                .rename(columns={"mean": "default_rate", "sum": "defaults", "size": "loans"}))
    return _cached("default_by_band", build, refresh)


@lru_cache(maxsize=1)
def loan_history() -> pd.DataFrame:
    """Every month of every loan account, with the profile as it looked using only data up to that month."""
    loans = load_table("loans")
    m = load_table("monthly_summary")
    m = m[m["account_id"].isin(loans["account_id"])].sort_values(["account_id", "month"]).copy()
    g = m.groupby("account_id")
    m["I"] = g["money_in"].transform(lambda s: s.expanding().median())
    m["S"] = g["money_out"].transform(lambda s: s.expanding().median())
    m["H"] = g["household_bills"].transform(lambda s: s.expanding().median())
    m["B"] = g["avg_daily_balance"].transform(lambda s: s.rolling(engine.BUFFER_MONTHS, min_periods=1).mean())
    m["period"] = pd.PeriodIndex(m["month"], freq="M")
    for key, (_, shock, _) in RULES.items():
        m[f"runway_{key}"] = engine.runway_vec(m, shock)["runway"].to_numpy()
    lo = loans.set_index("account_id")
    start = lo["loan_start"].dt.to_period("M")
    end = start + lo["duration_months"]
    # When the default is on record: the loan's end for finished loans, Dec 2025 for running ones.
    lo["known"] = [e if s == "B" else AS_OF for s, e in zip(lo["status"], end)]
    lo["start_m"] = start
    return m.join(lo[["start_m", "known", "defaulted", "status"]], on="account_id")


def early_warning(rule: str = MAIN_RULE) -> pd.DataFrame:
    """Per loan: the first month the rule fires during the loan, and how long before the default was on record."""
    _, _, threshold = RULES[rule]
    h = loan_history()
    win = h[(h["period"] >= h["start_m"]) & (h["period"] <= h["known"])]
    first = win[win[f"runway_{rule}"] < threshold].groupby("account_id")["period"].min()
    lo = h.groupby("account_id")[["known", "defaulted", "status"]].first()
    lo["first_flag"] = first
    lo["lead_months"] = [(k - f).n if pd.notna(f) else np.nan for k, f in zip(lo["known"], lo["first_flag"])]
    return lo.reset_index()


def early_warning_summary(refresh: bool = False) -> pd.DataFrame:
    def build():
        rows = []
        for rule, (label, _, _) in RULES.items():
            ew = early_warning(rule)
            flagged = ew["first_flag"].notna()
            d = ew["defaulted"] == 1
            rate_f = d[flagged].mean()
            rate_n = d[~flagged].mean()
            rows.append({"rule": rule, "label": label, "caught": (flagged & d).sum() / d.sum(),
                         "false_alarms": (flagged & ~d).sum() / (~d).sum(), "default_rate_flagged": rate_f,
                         "default_rate_not_flagged": rate_n, "ratio": rate_f / rate_n if rate_n else np.nan,
                         "median_lead_months": ew.loc[flagged & d, "lead_months"].median(),
                         "flagged": int(flagged.sum()), "defaults": int(d.sum()), "loans": len(ew)})
        return pd.DataFrame(rows)
    return _cached("early_warning_summary", build, refresh)


def time_machine(account_id: int) -> pd.DataFrame:
    """Month by month for one customer: the runway (and stress runway) the engine would have shown then."""
    m = load_table("monthly_summary")
    m = m[m["account_id"] == int(account_id)].sort_values("month").copy()
    m["I"] = m["money_in"].expanding().median()
    m["S"] = m["money_out"].expanding().median()
    m["H"] = m["household_bills"].expanding().median()
    m["B"] = m["avg_daily_balance"].rolling(engine.BUFFER_MONTHS, min_periods=1).mean()
    for key, (_, shock, _) in RULES.items():
        m[f"runway_{key}"] = engine.runway_vec(m, shock)["runway"].to_numpy()
    m["month"] = pd.to_datetime(m["month"] + "-01")
    return m[["month", "I", "S", "H", "B", "avg_daily_balance", "days_below_zero"] +
             [f"runway_{k}" for k in RULES]].reset_index(drop=True)


# --------------------------------------------------------------------------- simulation backtest

def backtest(refresh: bool = False, cut: str = "2025-06") -> pd.DataFrame:
    """Calibrate the simulation: profiles from data up to `cut`, simulate 6 months, compare with reality.

    One row per noise setting: predicted share running out vs the actual share whose month-end
    balance hit zero, and the Brier score (lower is better). risk.NOISE_SCALE comes from this table.
    """
    def build():
        import simulate
        m = load_table("monthly_summary")
        hist, fut = m[m["month"] <= cut], m[m["month"] > cut]
        n_hist = hist.groupby("account_id").size()
        ids = n_hist[n_hist >= 12].index.intersection(fut["account_id"].unique())
        hist = hist[hist["account_id"].isin(ids)]
        prof = engine._build_profiles(hist, engine._loan_table(), pd.Index(sorted(ids), name="account_id"))
        g = hist.sort_values(["account_id", "month"]).groupby("account_id").tail(risk.SD_WINDOW).groupby("account_id")
        rf = pd.DataFrame({"account_id": prof["account_id"],
                           "sd_in": g["money_in"].std().reindex(prof["account_id"]).to_numpy(),
                           "sd_out": g["money_out"].std().reindex(prof["account_id"]).to_numpy()})
        rf = rf.merge(risk.risk_factors_all()[["account_id", "p_job"]], on="account_id")
        base = risk.params_array(prof, rf) / np.r_[1, 1, 1, 1, risk.NOISE_SCALE, risk.NOISE_SCALE, 1]
        actual = fut.groupby("account_id")["month_end_balance"].min().reindex(prof["account_id"]).le(0).to_numpy()
        rows = []
        for label, scale, rep in [("Judges' formula only (no randomness)", 0.0, 0.0), ("Full volatility", 1.0, 0.0),
                                  ("Half volatility", 0.5, 0.0), ("Calibrated (used)", risk.NOISE_SCALE, risk.REPAIR_RATE)]:
            p = base.copy()
            p[:, 4:6] *= scale
            settings = risk.SimSettings(noise=scale > 0, job_loss=scale > 0, repairs=rep > 0, bills_growth=False)
            v = risk.shock_vector(Shock(), settings)
            surv, _ = simulate._impl.simulate_bank(p, v, 2000, 6, simulate.SEED, 6.0)
            pred = 1 - np.asarray(surv)
            rows.append({"model": label, "noise_scale": scale, "predicted_share": pred.mean(),
                         "actual_share": actual.mean(), "brier": np.mean((pred - actual) ** 2),
                         "accounts": len(actual)})
        return pd.DataFrame(rows)
    return _cached("backtest", build, refresh)


# --------------------------------------------------------------------------- the main finding

def main_finding() -> dict:
    s = early_warning_summary().set_index("rule").loc[MAIN_RULE]
    t = twist_impact().set_index("twist")
    db = default_by_band().set_index("band")
    return {
        "headline": (f"Stress-testing every customer against the EI twist each month flags "
                     f"{s['caught']:.0%} of the loans that later defaulted, a median of "
                     f"{s['median_lead_months']:.0f} months before the default was on record. "
                     f"Flagged customers defaulted {s['ratio']:.0f}x as often "
                     f"({s['default_rate_flagged']:.0%} vs {s['default_rate_not_flagged']:.1%})."),
        "caught": float(s["caught"]), "false_alarms": float(s["false_alarms"]), "ratio": float(s["ratio"]),
        "median_lead": float(s["median_lead_months"]), "rate_flagged": float(s["default_rate_flagged"]),
        "rate_not_flagged": float(s["default_rate_not_flagged"]),
        "ei_under6": float(t.loc["EI 55% for 6 months", "under_6"]),
        "under3_default_rate": float(db.loc["Under 3", "default_rate"]),
        "no_shortfall_default_rate": float(db.loc["No shortfall / 120+", "default_rate"]),
    }


def refresh_all() -> None:
    for fn in (twist_impact, fragile_groups, tipping_point, survival_sweep, regional, ei_cap_effect,
               default_by_band, early_warning_summary, backtest):
        t0 = time.perf_counter()
        fn(refresh=True)
        print(f"  {fn.__name__:<24} {time.perf_counter() - t0:5.1f}s")


def main() -> int:
    print("Computing discovery tables:")
    refresh_all()
    pd.set_option("display.width", 160)
    print("\nTwists across the bank:\n", twist_impact().round(3).to_string(index=False))
    print("\nDefault rate by today's runway:\n", default_by_band().round(3).to_string(index=False))
    print("\nEarly warning rules:\n", early_warning_summary().drop(columns="label").round(3).to_string(index=False))
    print("\nFragile groups (share not lasting 6 months on EI):\n", fragile_groups().round(3).to_string(index=False))
    r = regional()
    print(f"\nDistricts: corr(share failing, unemployment) = {r['share_fail'].corr(r['unemployment']):.2f}, "
          f"corr(share failing, salary) = {r['share_fail'].corr(r['salary']):.2f}")
    e = ei_cap_effect()
    lost = e["hit_by_cap"] & (e["runway_capped"] < e["runway_judges"])
    crossed = (e["runway_judges"] >= 6) & (e["runway_capped"] < 6)
    print(f"\nEI cap: {e['hit_by_cap'].mean():.1%} of customers earn above the cap; {lost.mean():.1%} lose runway; "
          f"{crossed.mean():.1%} fall below 6 months only because of the cap")
    tp = tipping_point()
    print("\nTipping point (on EI):\n", tp[tp["income"] == "On EI (55%)"].iloc[::5].round(3).to_string(index=False))
    print("\nSurvival sweep (C++):\n", survival_sweep().round(3).to_string(index=False))
    print("\nSimulation backtest (Jun -> Dec 2025):\n", backtest().round(4).to_string(index=False))
    print("\nMAIN FINDING:", main_finding()["headline"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
