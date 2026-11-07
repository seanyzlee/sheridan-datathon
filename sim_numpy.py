"""Monte Carlo survival simulation in vectorised NumPy: the reference and the fallback for resil_hpc.

Functions have the same names, arguments and return shapes as the C++ module:

    simulate_one(params, shock, n_paths, months, seed, target)  -> dict
    simulate_bank(params, shock, n_paths, months, seed, target) -> (survival[n], median_ruin[n])
    sweep(params, shocks, n_paths, months, seed, target)        -> survival[k, n]

`params` rows follow risk.PARAM_COLUMNS, `shock` follows risk.SHOCK_FIELDS.

One path, one month t (0-based):
    balance[0] = B - one_off - one_off_x_S * S                     (<= 0 means ruined at time 0)
    income:  forced shock: min(factor * I, ei_cap) for income_months, then 0
             otherwise employed (I) until a random job loss (chance p_job), then
             min(ei_rate * I, ei_cap) for ei_months_random months, then 0
             with noise: income * (1 + sd_in / I * z1), never below 0
    spend:   (S + bills_pct * H * (1 + bills_growth)^t + spend_delta) * (1 + sd_out / S * z2), never below 0
             plus, with chance repair_rate, a repair of U(repair_lo, repair_hi) * S
    balance[t+1] = balance[t] + income - spend
Ruin time is the moment the balance first reaches 0, interpolated linearly inside the month,
so with every random part switched off it equals the judges' buffer / gap exactly.
A path survives T months if its ruin time >= T - 0.05 (the judges round runway to 0.1).
"""

from __future__ import annotations

import numpy as np

from risk import SHOCK_FIELDS

SURVIVE_EPS = 0.05
_F = {name: i for i, name in enumerate(SHOCK_FIELDS)}


def _lower_pct(x: np.ndarray, q: float, axis: int = -1) -> np.ndarray:
    """Percentile as sorted[floor(q * (n - 1))], the same rule the C++ core uses."""
    return np.percentile(x, q * 100, axis=axis, method="lower")


def _run(params: np.ndarray, shock: np.ndarray, n_paths: int, months: int, rng: np.random.Generator,
         keep_balances: bool):
    """Simulate a block of accounts. Returns ruin times (n, paths) and optionally balances (n, paths, months+1)."""
    p = np.asarray(params, dtype=np.float64)
    s = np.asarray(shock, dtype=np.float64)
    n = p.shape[0]
    I, S, H, B, sd_in, sd_out, p_job = (p[:, j:j + 1] for j in range(7))

    factor, inc_months = s[_F["income_factor"]], s[_F["income_months"]]
    forced = factor != 1.0
    ei_cap = s[_F["ei_cap"]]
    noise, job_loss = s[_F["noise"]] > 0, s[_F["job_loss"]] > 0
    ei_rate, ei_rand = s[_F["ei_rate"]], s[_F["ei_months_random"]]
    growth, rep_rate = s[_F["bills_growth"]], s[_F["repair_rate"]]
    rep_lo, rep_hi = s[_F["repair_lo"]], s[_F["repair_hi"]]

    forced_income = factor * I
    if factor < 1.0:
        forced_income = np.minimum(forced_income, ei_cap)
    ei_income = np.minimum(ei_rate * I, ei_cap)
    in_scale = np.where(I > 0, sd_in / np.where(I > 0, I, 1), 0.0)
    out_scale = np.where(S > 0, sd_out / np.where(S > 0, S, 1), 0.0)

    bal = np.broadcast_to(B - s[_F["one_off"]] - s[_F["one_off_x_S"]] * S, (n, n_paths)).copy()
    ruin = np.where(bal <= 0, 0.0, np.inf)
    employed = np.ones((n, n_paths), dtype=bool)
    ei_left = np.zeros((n, n_paths))
    balances = np.empty((n, n_paths, months + 1)) if keep_balances else None
    if keep_balances:
        balances[:, :, 0] = bal

    for t in range(months):
        if forced:
            on = (inc_months < 0) or (t < inc_months)
            income = np.broadcast_to(forced_income if on else 0.0 * I, (n, n_paths)).copy()
        else:
            if job_loss:
                lose = employed & (rng.random((n, n_paths)) < p_job)
                employed &= ~lose
                ei_left = np.where(lose, ei_rand, ei_left)
            on_ei = ~employed & (ei_left > 0)
            income = np.where(employed, I, np.where(on_ei, ei_income, 0.0))
            ei_left = np.where(on_ei, ei_left - 1, ei_left)
        spend = S + s[_F["bills_pct"]] * H * (1 + growth) ** t + s[_F["spend_delta"]]
        spend = np.broadcast_to(spend, (n, n_paths)).copy()
        if noise:
            z = rng.standard_normal((2, n, n_paths))
            income = np.maximum(income * (1 + in_scale * z[0]), 0.0)
            spend = np.maximum(spend * (1 + out_scale * z[1]), 0.0)
        if rep_rate > 0:
            u = rng.random((n, n_paths))     # one draw: whether a repair happens and, rescaled, its size
            spend = spend + np.where(u < rep_rate, (rep_lo + (rep_hi - rep_lo) * (u / rep_rate)) * S, 0.0)
        new = bal + income - spend
        hit = np.isinf(ruin) & (new <= 0)
        with np.errstate(divide="ignore", invalid="ignore"):
            ruin = np.where(hit, t + bal / (bal - new), ruin)
        bal = new
        if keep_balances:
            balances[:, :, t + 1] = bal
    return ruin, balances


def simulate_one(params, shock, n_paths=10_000, months=24, seed=42, target=6.0) -> dict:
    """One customer: survival probability, ruin-time percentiles and the p10/p50/p90 balance fan."""
    rng = np.random.default_rng(seed)
    ruin, bal = _run(np.asarray(params, dtype=np.float64).reshape(1, -1), shock, n_paths, months, rng, True)
    ruin, bal = ruin[0], bal[0]
    return {
        "survival": float(np.mean(ruin >= target - SURVIVE_EPS)),
        "ruin_p10": float(_lower_pct(ruin, 0.10)),
        "ruin_p50": float(_lower_pct(ruin, 0.50)),
        "ruin_p90": float(_lower_pct(ruin, 0.90)),
        "fan": np.stack([_lower_pct(bal, q, axis=0) for q in (0.10, 0.50, 0.90)]),
    }


def simulate_bank(params, shock, n_paths=2_000, months=24, seed=42, target=6.0, block=256):
    """Every customer: survival probability and median ruin time (inf when most paths never run out)."""
    params = np.asarray(params, dtype=np.float64)
    rng = np.random.default_rng(seed)
    n = params.shape[0]
    surv, med = np.empty(n), np.empty(n)
    for lo in range(0, n, block):
        ruin, _ = _run(params[lo:lo + block], shock, n_paths, months, rng, False)
        surv[lo:lo + block] = np.mean(ruin >= target - SURVIVE_EPS, axis=1)
        med[lo:lo + block] = _lower_pct(ruin, 0.5, axis=1)
    return surv, med


def sweep(params, shocks, n_paths=500, months=12, seed=42, target=6.0):
    """Survival probability for every (shock, customer) pair: shape (n_shocks, n_accounts)."""
    shocks = np.atleast_2d(np.asarray(shocks, dtype=np.float64))
    return np.stack([simulate_bank(params, s, n_paths, months, seed + k, target)[0] for k, s in enumerate(shocks)])
