"""Phase 1b: Tiger Data computes the same profile numbers as the engine.

Skipped automatically when TIGER_DATABASE_URL is missing or the service is unreachable.
"""

from __future__ import annotations

import subprocess
import sys

import numpy as np
import pandas as pd
import pytest

import engine
import tiger_client as tc

ROOT = engine.CACHE_DIR.parent


@pytest.fixture(scope="module")
def conn():
    try:
        c = tc.connect()
    except Exception as exc:  # not configured, or offline
        pytest.skip(f"Tiger Data unreachable: {exc}")
    yield c
    c.close()


@pytest.fixture(scope="module")
def sample_ids():
    ids = engine.profiles_all()["account_id"].to_numpy()
    rng = np.random.default_rng(2026)
    return sorted(int(a) for a in rng.choice(ids, size=50, replace=False)) + [20111, 20396, 36407]


def test_row_counts(conn):
    for table, n in {"transactions": 1_056_320, "monthly_summary": 185_326, "loans": 682, "accounts": 4_500}.items():
        assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == n, table


def test_transactions_is_a_columnstore_hypertable(conn):
    row = conn.execute(
        "SELECT compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_name = 'transactions'"
    ).fetchone()
    assert row is not None and row[0]
    assert conn.execute(
        "SELECT count(*) FROM timescaledb_information.continuous_aggregates WHERE view_name = 'monthly_flows'"
    ).fetchone()[0] == 1


def test_profile_live_matches_engine_on_50_random_accounts(sample_ids):
    for a in sample_ids:
        live, source = tc.live_profile(a)
        assert source == tc.LIVE
        e = engine.profile(a)
        for k in ("I", "S", "F", "H", "B", "P"):
            assert getattr(live, k) == pytest.approx(getattr(e, k), abs=1e-6), (a, k)
        assert (live.months_of_data, live.days_below_zero_6m) == (e.months_of_data, e.days_below_zero_6m), a
        assert (live.has_loan, live.loan_running, live.defaulted) == (e.has_loan, e.loan_running, e.defaulted), a
        for s in (engine.NO_SHOCK, *engine.PRESETS.values()):
            assert engine.runway(live, s).months == engine.runway(e, s).months, (a, s)


def test_monthly_live_reproduces_monthly_summary(sample_ids):
    flows = ["money_in", "money_out", "cash_deposits", "transfers_in", "pension_in", "interest_in", "household_bills",
             "insurance", "loan_payments", "bank_fees", "cash_withdrawals_genuine", "card_withdrawals",
             "transfers_out_other"]
    for a in sample_ids[:20]:
        live, source = tc.live_monthly(a)
        cached = tc.cached_monthly(a)
        assert source == tc.LIVE and len(live) == len(cached), a
        assert (live["month"].to_numpy() == cached["month"].to_numpy()).all()
        np.testing.assert_allclose(live[flows].to_numpy(), cached[flows].to_numpy(), atol=1e-9, err_msg=str(a))
        np.testing.assert_array_equal(live["days_below_zero"], cached["days_below_zero"])
        # balances are rebuilt from transactions: within a cent except on ambiguous days
        close = np.isclose(live["avg_daily_balance"], cached["avg_daily_balance"], atol=0.011)
        assert close.mean() > 0.95, a


def test_offline_fallback(monkeypatch):
    monkeypatch.setattr(tc, "_shared_conn", lambda: None)
    p, source = tc.live_profile(20111)
    assert source == tc.OFFLINE and p == engine.profile(20111)
    df, source = tc.live_monthly(20111)
    assert source == tc.OFFLINE and len(df) == engine.profile(20111).months_of_data


def test_replay_moves_the_profile_and_restores_it(conn):
    """Replay the last 2 months of one account at full speed; the profile changes, then returns."""
    out = subprocess.run([sys.executable, "replay.py", "--account", "20396", "--from", "2025-11", "--speed", "0"],
                         cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    lines = [l for l in out.stdout.splitlines() if "through" in l]
    assert "through 2025-10" in lines[0] and "through 2025-12" in lines[-1]
    live, _ = tc.live_profile(20396)
    e = engine.profile(20396)
    assert (live.I, live.S, live.B) == pytest.approx((e.I, e.S, e.B))
    assert conn.execute("SELECT count(*) FROM transactions WHERE account_id = 20396").fetchone()[0] == \
        int((engine.load_table("transactions", columns=["account_id"])["account_id"] == 20396).sum())
