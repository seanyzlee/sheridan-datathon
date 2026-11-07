"""Phase 3b: the C++ core matches the judges with noise off, and matches NumPy with noise on."""

from __future__ import annotations

import time

import numpy as np
import pytest

import engine
import risk
import sim_numpy

hpc = pytest.importorskip("resil_hpc")

JUDGES = risk.SimSettings.judges()
# income_months is left out: the judges' formula never stops EI income, the simulation does.
SHOCKS = [engine.NO_SHOCK, engine.PRESETS["one_month"], engine.PRESETS["ei_bills"],
          engine.Shock(income_factor=0.55), engine.Shock(income_factor=0.4, bills_pct=0.3, spend_delta=250,
                                                         one_off=2000)]


@pytest.fixture(scope="module")
def params():
    return risk.params_array()


@pytest.fixture(scope="module")
def prof():
    return engine.profiles_all()


def test_layouts_agree():
    assert len(risk.SHOCK_FIELDS) == 15 and len(risk.PARAM_COLUMNS) == 7
    with pytest.raises(ValueError):
        hpc.simulate_bank(np.zeros((2, 7)), np.zeros(14), 10, 12, 1, 6.0)


def test_risk_factors(prof):
    r = risk.risk_factors_all()
    assert len(r) == len(prof) and (r["account_id"].to_numpy() == prof["account_id"].to_numpy()).all()
    assert r[["sd_in", "sd_out", "flex_share", "p_job"]].notna().all().all()
    assert r["flex_share"].between(0, 1).all() and r["p_job"].between(0, 0.01).all()


@pytest.mark.parametrize("backend", ["cpp", "numpy"])
@pytest.mark.parametrize("shock", SHOCKS, ids=lambda s: str(s)[:60])
def test_noise_off_equals_judges_runway(backend, shock, params, prof):
    impl = hpc if backend == "cpp" else sim_numpy
    _, med = impl.simulate_bank(params, risk.shock_vector(shock, JUDGES), 1, 120, 7, 6.0)
    med = np.asarray(med)
    rw = engine.runway_vec(prof, shock)
    finite = ~rw["no_shortfall"].to_numpy() & (rw["runway"].to_numpy() < engine.RUNWAY_CAP)
    assert np.abs(med[finite] - rw["runway"].to_numpy()[finite]).max() <= 0.05 + 1e-9
    assert np.isinf(med[rw["no_shortfall"].to_numpy()]).all()


def test_noise_off_survival_is_the_judges_verdict(params, prof):
    s = engine.PRESETS["ei_bills"]
    surv, _ = hpc.simulate_bank(params, risk.shock_vector(s, JUDGES), 1, 24, 7, 6.0)
    rw = engine.runway_vec(prof, s)
    makes_it = rw["no_shortfall"].to_numpy() | (rw["runway"].to_numpy() >= 6.0)
    assert (np.asarray(surv) == makes_it.astype(float)).all()


@pytest.mark.parametrize("shock", [engine.NO_SHOCK, engine.PRESETS["ei_6m"], engine.PRESETS["ei_bills"]],
                         ids=["base", "ei_6m", "ei_bills"])
def test_cpp_matches_numpy_with_noise(shock, params):
    v = risk.shock_vector(shock)
    sub = params[::45]                                    # 100 customers
    c, _ = hpc.simulate_bank(sub, v, 4000, 12, 11, 6.0)
    n, _ = sim_numpy.simulate_bank(sub, v, 4000, 12, 11, 6.0)
    assert abs(np.mean(c) - np.mean(n)) < 0.01            # bank-wide within 1 point
    assert np.abs(np.asarray(c) - n).max() < 0.05         # each customer within sampling noise


def test_simulate_one_matches_numpy():
    p = risk.params_one(engine.profile(20396))
    v = risk.shock_vector(engine.PRESETS["ei_6m"])
    c = hpc.simulate_one(p, v, 40_000, 24, 3, 6.0)
    n = sim_numpy.simulate_one(p, v, 40_000, 24, 3, 6.0)
    assert abs(c["survival"] - n["survival"]) < 0.01
    assert np.asarray(c["fan"]).shape == (3, 25)
    assert np.allclose(np.asarray(c["fan"])[1], n["fan"][1], rtol=0.03, atol=50)


def test_deterministic_and_thread_independent(params):
    v = risk.shock_vector(engine.PRESETS["ei_bills"])
    a = np.asarray(hpc.simulate_bank(params[:300], v, 500, 12, 5, 6.0)[0])
    n = hpc.threads()
    hpc.set_threads(1)
    try:
        b = np.asarray(hpc.simulate_bank(params[:300], v, 500, 12, 5, 6.0)[0])
    finally:
        hpc.set_threads(n)
    assert (a == b).all()


def test_sweep_shape(params):
    grid = np.stack([risk.shock_vector(s) for s in SHOCKS[:3]])
    out = np.asarray(hpc.sweep(params[:50], grid, 100, 6, 1, 6.0))
    assert out.shape == (3, 50) and ((0 <= out) & (out <= 1)).all()


def test_bank_wide_under_one_second(params):
    v = risk.shock_vector(engine.PRESETS["ei_bills"])
    hpc.simulate_bank(params, v, 2000, 6, 42, 6.0)        # warm up
    t0 = time.perf_counter()
    hpc.simulate_bank(params, v, 2000, 24, 42, 6.0)       # 4,500 x 2,000 x 24 = 216M steps
    assert time.perf_counter() - t0 < 1.0


def test_one_customer_under_50ms():
    p = risk.params_one(engine.profile(20111))
    v = risk.shock_vector(engine.PRESETS["ei_6m"])
    hpc.simulate_one(p, v, 10_000, 24, 42, 6.0)
    t0 = time.perf_counter()
    hpc.simulate_one(p, v, 10_000, 24, 42, 6.0)
    assert time.perf_counter() - t0 < 0.05


def test_numpy_fallback_switch(monkeypatch):
    import importlib
    import simulate
    monkeypatch.setenv("RESIL_FORCE_NUMPY", "1")
    fallback = importlib.reload(simulate)
    try:
        assert fallback.BACKEND == "NumPy"
        res = fallback.one(engine.profile(20111), engine.PRESETS["ei_6m"], n_paths=500)
        assert 0 <= res["survival"] <= 1
    finally:
        monkeypatch.delenv("RESIL_FORCE_NUMPY")
        importlib.reload(simulate)
