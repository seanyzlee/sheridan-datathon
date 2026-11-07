"""Benchmark the bank-wide stress test: pure Python vs NumPy vs C++ (1 thread) vs C++ (all threads).

Usage:
    python bench.py              # writes docs/bench.csv and docs/bench.md

Workload: 4,500 customers x 2,000 futures x 24 months = 216M simulated months, the EI + bills twist.
Pure Python and NumPy are too slow to run on the full bank in a demo, so they run on a sample of
customers and the time is scaled to 4,500 (marked "scaled" in the table).
"""

from __future__ import annotations

import math
import random
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

import engine
import risk
import sim_numpy

ROOT = Path(__file__).resolve().parent
OUT_CSV, OUT_MD = ROOT / "docs" / "bench.csv", ROOT / "docs" / "bench.md"
N_PATHS, MONTHS, SEED, TARGET = 2_000, 24, 42, 6.0


def python_loop(params: np.ndarray, shock: np.ndarray, n_paths: int, months: int) -> list[float]:
    """The same model as sim_numpy, written as plain Python loops (the 'before' picture)."""
    f = dict(zip(risk.SHOCK_FIELDS, shock.tolist()))
    rnd = random.Random(SEED)
    out = []
    for I, S, H, B, sd_in, sd_out, p_job in params.tolist():
        alive = 0
        for _ in range(n_paths):
            bal = B - f["one_off"] - f["one_off_x_S"] * S
            ruin = 0.0 if bal <= 0 else math.inf
            employed, ei_left = True, 0.0
            for t in range(months):
                if f["income_factor"] != 1.0:
                    on = f["income_months"] < 0 or t < f["income_months"]
                    income = min(f["income_factor"] * I, f["ei_cap"]) if on else 0.0
                else:
                    if f["job_loss"] and employed and rnd.random() < p_job:
                        employed, ei_left = False, f["ei_months_random"]
                    if employed:
                        income = I
                    elif ei_left > 0:
                        income, ei_left = min(f["ei_rate"] * I, f["ei_cap"]), ei_left - 1
                    else:
                        income = 0.0
                spend = S + f["bills_pct"] * H * (1 + f["bills_growth"]) ** t + f["spend_delta"]
                if f["noise"]:
                    income = max(income * (1 + (sd_in / I if I > 0 else 0) * rnd.gauss(0, 1)), 0.0)
                    spend = max(spend * (1 + (sd_out / S if S > 0 else 0) * rnd.gauss(0, 1)), 0.0)
                u = rnd.random()
                if u < f["repair_rate"]:
                    spend += (f["repair_lo"] + (f["repair_hi"] - f["repair_lo"]) * u / f["repair_rate"]) * S
                new = bal + income - spend
                if ruin == math.inf and new <= 0:
                    ruin = t + bal / (bal - new)
                bal = new
            alive += ruin >= TARGET - 0.05
        out.append(alive / n_paths)
    return out


def timed(fn, *args) -> float:
    t0 = time.perf_counter()
    fn(*args)
    return time.perf_counter() - t0


def main() -> int:
    params = risk.params_array()
    shock = risk.shock_vector(engine.PRESETS["ei_bills"])
    n = len(params)
    steps = n * N_PATHS * MONTHS
    rows = []

    sample = params[:: n // 5][:5]
    secs = timed(python_loop, sample, shock, N_PATHS, MONTHS) * n / len(sample)
    rows.append(("Pure Python loop", 1, secs, "scaled from 5 customers"))
    print(f"python  {secs:8.1f}s (scaled)")

    sample = params[:450]
    secs = timed(sim_numpy.simulate_bank, sample, shock, N_PATHS, MONTHS, SEED, TARGET) * n / len(sample)
    rows.append(("NumPy (vectorised)", 1, secs, "scaled from 450 customers"))
    print(f"numpy   {secs:8.2f}s (scaled)")

    try:
        import resil_hpc as hpc
    except ImportError:
        print("resil_hpc not built: C++ rows skipped")
        hpc = None
    if hpc is not None:
        all_threads = hpc.threads()
        hpc.simulate_bank(params, shock, 100, MONTHS, SEED, TARGET)  # warm up
        for threads in sorted({1, all_threads // 2, all_threads} - {0}):
            hpc.set_threads(threads)
            best = min(timed(hpc.simulate_bank, params, shock, N_PATHS, MONTHS, SEED, TARGET) for _ in range(3))
            rows.append((f"C++ OpenMP", threads, best, "full run, best of 3"))
            print(f"c++ x{threads:<3} {best:8.3f}s")
        hpc.set_threads(all_threads)

    df = pd.DataFrame(rows, columns=["method", "threads", "seconds", "note"])
    df["speedup_vs_python"] = df["seconds"].iloc[0] / df["seconds"]
    df["million_steps_per_s"] = steps / df["seconds"] / 1e6
    OUT_CSV.parent.mkdir(exist_ok=True)
    df.to_csv(OUT_CSV, index=False)

    lines = [f"# Benchmark: bank-wide stress test", "",
             f"{n:,} customers x {N_PATHS:,} futures x {MONTHS} months = **{steps / 1e6:.0f}M simulated months** "
             f"(EI 55% + bills +15%). Machine: {hpc.threads() if hpc else '?'} logical cores.", "",
             "| Method | Threads | Time | Speed-up vs Python | M steps/s | Note |", "|---|---|---|---|---|---|"]
    for r in df.itertuples():
        t = f"{r.seconds:.2f} s" if r.seconds < 100 else f"{r.seconds / 60:.1f} min"
        lines.append(f"| {r.method} | {r.threads} | {t} | {r.speedup_vs_python:,.0f}x | {r.million_steps_per_s:,.1f} | {r.note} |")
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT_CSV.relative_to(ROOT)} and {OUT_MD.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
