"""Monte Carlo front door: uses the C++ core (resil_hpc) if it imports, otherwise NumPy.

    import simulate
    res = simulate.one(profile, shock)          # dict: survival, ruin_p10/50/90, fan (3 x months+1)
    bank = simulate.bank(shock)                 # DataFrame: account_id, survival, median_ruin
    simulate.BACKEND                            # "C++ (8 threads)" or "NumPy"

Set RESIL_FORCE_NUMPY=1 to force the NumPy fallback (rehearsal of a failed build).
"""

from __future__ import annotations

import os
import time

import numpy as np
import pandas as pd

import engine
import risk
import sim_numpy

_core = None
if os.getenv("RESIL_FORCE_NUMPY", "") != "1":
    try:
        import resil_hpc as _core  # type: ignore
    except ImportError:
        _core = None

IS_CPP = _core is not None
BACKEND = f"C++ ({_core.threads()} threads)" if IS_CPP else "NumPy"
_impl = _core if IS_CPP else sim_numpy

SEED = 42                      # fixed: the same twist always gives the same answer on stage
ONE_PATHS, ONE_MONTHS = 10_000, 24
BANK_PATHS, BANK_MONTHS = 2_000, 24
if not IS_CPP:                 # keep the fallback responsive
    BANK_PATHS = 200


def default_target(shock: engine.Shock) -> float:
    return float(shock.income_months or 6)


def one(p: engine.Profile, shock: engine.Shock = engine.NO_SHOCK, target: float | None = None,
        settings: risk.SimSettings = risk.SimSettings(), n_paths: int = ONE_PATHS, months: int = ONE_MONTHS,
        seed: int = SEED) -> dict:
    target = default_target(shock) if target is None else target
    t0 = time.perf_counter()
    res = dict(_impl.simulate_one(risk.params_one(p), risk.shock_vector(shock, settings),
                                  n_paths, months, seed, target))
    res["fan"] = np.asarray(res["fan"])
    res.update(seconds=time.perf_counter() - t0, n_paths=n_paths, months=months, target=target, backend=BACKEND)
    return res


_params_cache: np.ndarray | None = None


def bank_params() -> np.ndarray:
    global _params_cache
    if _params_cache is None:
        _params_cache = risk.params_array()
    return _params_cache


def bank(shock: engine.Shock = engine.NO_SHOCK, target: float | None = None,
         settings: risk.SimSettings = risk.SimSettings(), n_paths: int = BANK_PATHS, months: int = BANK_MONTHS,
         seed: int = SEED) -> tuple[pd.DataFrame, float]:
    """(per-account survival and median ruin, seconds). Rows align with engine.profiles_all()."""
    target = default_target(shock) if target is None else target
    params = bank_params()
    t0 = time.perf_counter()
    surv, med = _impl.simulate_bank(params, risk.shock_vector(shock, settings), n_paths, months, seed, target)
    secs = time.perf_counter() - t0
    df = pd.DataFrame({"account_id": engine.profiles_all()["account_id"].to_numpy(),
                       "survival": np.asarray(surv), "median_ruin": np.asarray(med)})
    return df, secs


def sweep(shocks: list[engine.Shock], target: float = 6.0, settings: risk.SimSettings = risk.SimSettings(),
          n_paths: int = 500, months: int = 12, seed: int = SEED) -> np.ndarray:
    grid = np.stack([risk.shock_vector(s, settings) for s in shocks])
    return np.asarray(_impl.sweep(bank_params(), grid, n_paths, months, seed, target))
