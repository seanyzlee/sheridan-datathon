"""Risk factors for the Monte Carlo simulation (Phase 3b) and the simulation's input layout.

The simulation never replaces the judges' runway; it adds survival probabilities around it.
Sources for every constant are in SOURCES.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pandas as pd

import engine
from load import load_table

# --------------------------------------------------------------------------- Canadian constants (SOURCES.md)

EI_RATE = 0.55                      # EI pays 55% of insurable earnings
EI_WEEKLY_MAX = engine.EI_WEEKLY_MAX  # $729 in 2026 (canada.ca)
EI_MONTHLY_MAX = engine.EI_MONTHLY_MAX
CPI_ANNUAL = 0.028                  # CPI 12-month change, April 2026 (StatCan 18-10-0004-01)
BILLS_GROWTH_MONTHLY = (1 + CPI_ANNUAL) ** (1 / 12) - 1

EI_MONTHS_RANDOM = 6                # EI length after a random job loss
SD_WINDOW = 24                      # months used for each customer's own volatility

# Calibrated by discovery.backtest(): profiles as of Jun 2025, simulated to Dec 2025, compared with
# the real month-end balances. Real monthly flows are lumpy but mean-reverting, so drawing each month
# independently with the full volatility overstates risk (16% predicted vs 1.8% actual). Scaling the
# noise to 30% and keeping small repairs gave the best Brier score, beating the deterministic formula.
NOISE_SCALE = 0.3                   # share of each customer's raw month-to-month volatility used as noise
REPAIR_RATE = 0.01                  # chance per month of a one-off repair
REPAIR_LO, REPAIR_HI = 0.25, 1.0    # repair size as a multiple of S

# --------------------------------------------------------------------------- input layout shared by C++ and NumPy

# Per-account parameter columns (float64, C order). Keep in sync with hpc/src/resil.cpp.
PARAM_COLUMNS = ["I", "S", "H", "B", "sd_in", "sd_out", "p_job"]

# Scenario vector layout (float64). Keep in sync with hpc/src/resil.cpp (enum Shk).
SHOCK_FIELDS = [
    "income_factor",     # forced income factor from month 0 (1.0 = no forced shock)
    "income_months",     # months the forced factor lasts; then income is 0. <0 = whole horizon
    "bills_pct",         # + fraction of H added to spending
    "spend_delta",       # + CAD per month
    "one_off",           # CAD, taken from the buffer at month 0
    "one_off_x_S",       # multiple of S, taken from the buffer at month 0
    "ei_cap",            # monthly cap on EI income (inf = no cap)
    "noise",             # 1 = income/spending noise on, 0 = off
    "job_loss",          # 1 = random job loss on (only while not already on the forced shock)
    "ei_rate",           # income factor after a random job loss
    "ei_months_random",  # months of EI after a random job loss; then income is 0
    "bills_growth",      # monthly growth of the bills increase
    "repair_rate",       # chance of a one-off repair per month
    "repair_lo",         # repair size range, multiples of S
    "repair_hi",
]


@dataclass(frozen=True)
class SimSettings:
    noise: bool = True
    job_loss: bool = True
    repairs: bool = True
    bills_growth: bool = True

    @classmethod
    def judges(cls) -> "SimSettings":
        """Everything random switched off: the simulation must reproduce the judges' runway."""
        return cls(noise=False, job_loss=False, repairs=False, bills_growth=False)


def shock_vector(shock: engine.Shock, settings: SimSettings = SimSettings()) -> np.ndarray:
    forced = shock.income_factor != 1.0
    months = shock.income_months if (forced and shock.income_months) else -1
    cap = EI_MONTHLY_MAX if shock.ei_cap_on else np.inf
    v = {
        "income_factor": shock.income_factor, "income_months": months, "bills_pct": shock.bills_pct,
        "spend_delta": shock.spend_delta, "one_off": shock.one_off, "one_off_x_S": shock.one_off_x_S,
        "ei_cap": cap, "noise": float(settings.noise), "job_loss": float(settings.job_loss),
        "ei_rate": EI_RATE, "ei_months_random": EI_MONTHS_RANDOM,
        "bills_growth": BILLS_GROWTH_MONTHLY if settings.bills_growth else 0.0,
        "repair_rate": REPAIR_RATE if settings.repairs else 0.0, "repair_lo": REPAIR_LO, "repair_hi": REPAIR_HI,
    }
    return np.array([float(v[f]) for f in SHOCK_FIELDS], dtype=np.float64)


# --------------------------------------------------------------------------- risk factors

def _job_loss_monthly(unemployment_pct: pd.Series) -> pd.Series:
    """Turn a district's yearly unemployment rate into a monthly chance of losing the job."""
    u = (unemployment_pct.astype(float) / 100).clip(0, 0.99)
    return 1 - (1 - u) ** (1 / 12)


@lru_cache(maxsize=1)
def risk_factors_all() -> pd.DataFrame:
    """One row per account: sd_in, sd_out, flex_share, p_job (aligned with engine.profiles_all())."""
    m = load_table("monthly_summary", columns=["account_id", "month", "money_in", "money_out",
                                               "cash_withdrawals_genuine", "card_withdrawals",
                                               "transfers_out_other"])
    m = m.sort_values(["account_id", "month"]).groupby("account_id").tail(SD_WINDOW)
    g = m.groupby("account_id")
    out = pd.DataFrame({
        "sd_in": g["money_in"].std(ddof=1),
        "sd_out": g["money_out"].std(ddof=1),
        "flex_out": g[["cash_withdrawals_genuine", "card_withdrawals", "transfers_out_other"]].sum().sum(axis=1),
        "total_out": g["money_out"].sum(),
    })
    out["flex_share"] = np.where(out["total_out"] > 0, out["flex_out"] / out["total_out"].where(out["total_out"] > 0, 1), 0.0)
    out["flex_share"] = out["flex_share"].clip(0.0, 1.0)

    acc = load_table("accounts", columns=["account_id", "district_id"])
    dist = load_table("districts", columns=["district_id", "unemployment_rate_2023"])
    acc = acc.merge(dist, on="district_id", how="left", validate="m:1").set_index("account_id")

    prof = engine.profiles_all()[["account_id"]].set_index("account_id")
    out = prof.join(out[["sd_in", "sd_out", "flex_share"]]).join(acc[["district_id", "unemployment_rate_2023"]])
    out[["sd_in", "sd_out", "flex_share"]] = out[["sd_in", "sd_out", "flex_share"]].fillna(0.0)
    out["p_job"] = _job_loss_monthly(out["unemployment_rate_2023"].fillna(out["unemployment_rate_2023"].median()))
    return out.reset_index()


def params_array(profiles: pd.DataFrame | None = None, risk: pd.DataFrame | None = None) -> np.ndarray:
    """(n_accounts, 7) float64 array in PARAM_COLUMNS order, rows aligned with `profiles`."""
    profiles = engine.profiles_all() if profiles is None else profiles
    risk = risk_factors_all() if risk is None else risk
    df = profiles[["account_id", "I", "S", "H", "B"]].merge(
        risk[["account_id", "sd_in", "sd_out", "p_job"]], on="account_id", how="left", validate="1:1")
    df = df.fillna({"sd_in": 0.0, "sd_out": 0.0, "p_job": 0.0})
    df[["sd_in", "sd_out"]] *= NOISE_SCALE
    return np.ascontiguousarray(df[PARAM_COLUMNS].to_numpy(np.float64))


def params_one(p: engine.Profile, risk_row=None) -> np.ndarray:
    if risk_row is None:
        r = risk_factors_all().set_index("account_id")
        risk_row = r.loc[p.account_id] if p.account_id in r.index else {"sd_in": 0.0, "sd_out": 0.0, "p_job": 0.0}
    return np.array([p.I, p.S, p.H, p.B, NOISE_SCALE * risk_row["sd_in"], NOISE_SCALE * risk_row["sd_out"],
                     risk_row["p_job"]], dtype=np.float64)
