"""Phase 1: the engine must match the judges' definitions exactly.

Hand-check values were worked out from data/monthly_summary.csv and data/loans.csv with only
the csv and statistics modules (no pandas), following docs/ROADMAP.md's Data Model.
"""

from __future__ import annotations

import time

import numpy as np
import pandas as pd
import pytest

import engine
from engine import NO_SHOCK, PRESETS, Profile, Shock, breaking_point, runway

# --------------------------------------------------------------------------- hand-checked accounts

HAND = {
    # running loan that defaulted, no household bills
    20111: dict(I=6339.39, S=8599.605, F=2330.06, H=0.0, B=17611.863333333335, P=2330.19, months=38,
                runway={"base": 7.8, "ei_6m": 3.4, "ei_bills": 3.4, "one_month": 4.0}),
    # no loan, F differs from H (insurance), finite runway
    20396: dict(I=12153.16, S=12624.8, F=2637.9, H=1899.77, B=13931.973333333333, P=0.0, months=53,
                runway={"base": 29.5, "ei_6m": 2.3, "ei_bills": 2.2, "one_month": 2.8}),
    # buffer already negative -> runway 0 under every shock
    36407: dict(I=5419.91, S=6176.03, F=3460.98, H=3460.98, B=-4221.588333333333, P=0.0, months=55,
                runway={"base": 0.0, "ei_6m": 0.0, "ei_bills": 0.0, "one_month": 0.0}),
}


@pytest.mark.parametrize("account_id", sorted(HAND))
def test_profile_matches_hand_calculation(account_id):
    exp, p = HAND[account_id], engine.profile(account_id)
    for k in ("I", "S", "F", "H", "B", "P"):
        assert getattr(p, k) == pytest.approx(exp[k], abs=1e-6), k
    assert p.months_of_data == exp["months"]


@pytest.mark.parametrize("account_id", sorted(HAND))
@pytest.mark.parametrize("card", ["base", "ei_6m", "ei_bills", "one_month"])
def test_runway_matches_hand_calculation(account_id, card):
    shock = NO_SHOCK if card == "base" else PRESETS[card]
    assert runway(engine.profile(account_id), shock).months == HAND[account_id]["runway"][card]


def test_hand_account_flags():
    p = engine.profile(20111)
    assert p.has_loan and p.loan_running and p.defaulted
    assert not engine.profile(20396).has_loan


# --------------------------------------------------------------------------- the runway formula

def make(I=1000.0, S=1200.0, H=300.0, B=1000.0, **kw) -> Profile:
    base = dict(account_id=1, F=H, P=0.0, months_of_data=24, days_below_zero_6m=0.0,
                has_loan=False, loan_running=False, defaulted=False)
    base.update(kw)
    return Profile(I=I, S=S, H=H, B=B, **base)


def test_basic_division_and_rounding():
    r = runway(make(I=1000, S=1300, B=1000))      # 1000 / 300 = 3.333...
    assert r.months == 3.3 and not r.no_shortfall
    assert r.gap == 300 and r.buffer_left == 1000


def test_cap_at_120():
    r = runway(make(I=1000, S=1001, B=1_000_000))
    assert r.months == 120.0 and not r.no_shortfall


def test_no_shortfall():
    r = runway(make(I=2000, S=1000, B=500))
    assert r.months == 120.0 and r.no_shortfall and r.label == "no shortfall (120+)"


def test_zero_gap_is_no_shortfall():
    assert runway(make(I=1000, S=1000, B=500)).no_shortfall


def test_buffer_zero_or_negative_is_zero_even_with_surplus():
    assert runway(make(I=5000, S=1000, B=0)).months == 0.0
    assert runway(make(I=5000, S=1000, B=-10)).months == 0.0
    assert not runway(make(I=5000, S=1000, B=0)).no_shortfall


def test_one_off_exhausting_buffer_is_zero():
    p = make(B=1000, S=1000)
    assert runway(p, Shock(one_off=1000)).months == 0.0
    assert runway(p, Shock(one_off_x_S=1.0)).months == 0.0
    assert runway(p, Shock(one_off=999)).months > 0


def test_shock_terms():
    p = make(I=1000, S=1000, H=200, B=1200)
    s = Shock(income_factor=0.5, bills_pct=0.5, spend_delta=100, one_off=200)
    r = runway(p, s)
    assert r.income == 500 and r.spending == 1000 + 100 + 100 and r.buffer_left == 1000
    assert r.months == round(1000 / 700, 1)


def test_income_months_does_not_change_judges_runway():
    p = make()
    assert runway(p, Shock(income_factor=0.55, income_months=6)) == runway(p, Shock(income_factor=0.55))


def test_ei_cap_only_when_switched_on():
    p = make(I=10_000, S=9_000, B=50_000)
    off = runway(p, Shock(income_factor=0.55))
    on = runway(p, Shock(income_factor=0.55, ei_cap_on=True))
    assert off.income == pytest.approx(5500)
    assert on.income == pytest.approx(engine.EI_MONTHLY_MAX)
    # no cap applied without an income cut
    assert runway(p, Shock(ei_cap_on=True)).income == 10_000


def test_presets():
    assert PRESETS["ei_6m"] == Shock(income_factor=0.55, income_months=6)
    assert PRESETS["one_month"].one_off_cad(make(S=1234)) == 1234
    assert PRESETS["ei_bills"] == Shock(income_factor=0.55, bills_pct=0.15)


# --------------------------------------------------------------------------- breaking point (D4)

def test_breaking_point_values():
    p = make(I=1000, S=1200, H=400, B=3000)
    bp = breaking_point(p, NO_SHOCK, T=6)
    assert bp.income_factor == pytest.approx((1200 - 3000 / 6) / 1000)      # 0.70
    assert bp.one_off == pytest.approx(3000 - 6 * 200)                       # 1800
    assert bp.bills_pct == pytest.approx((3000 / 6 + 1000 - 1200) / 400)     # 0.75
    assert not bp.already_broken


@pytest.mark.parametrize("account_id", sorted(HAND)[:2])
@pytest.mark.parametrize("card", ["ei_6m", "ei_bills", "one_month"])
def test_breaking_point_round_trips_through_runway(account_id, card):
    """Plugging each limit back into the formula gives exactly T months (before rounding)."""
    p, s, T = engine.profile(account_id), PRESETS[card], 4.0
    bp = breaking_point(p, s, T)

    def raw(shock):
        r = runway(p, shock)
        return r.buffer_left / r.gap

    from dataclasses import replace
    if bp.income_factor is not None:
        assert raw(replace(s, income_factor=bp.income_factor)) == pytest.approx(T)
    if bp.one_off > 0:
        assert raw(replace(s, one_off=bp.one_off, one_off_x_S=0.0)) == pytest.approx(T)
    if bp.bills_pct is not None:
        assert raw(replace(s, bills_pct=bp.bills_pct)) == pytest.approx(T)


def test_breaking_point_edge_cases():
    bp = breaking_point(make(I=0, H=0, S=500, B=3000), NO_SHOCK, T=6)
    assert bp.income_factor is None and bp.bills_pct is None
    assert bp.one_off == pytest.approx(0.0)
    # no shortfall: the most they can take is the whole buffer
    assert breaking_point(make(I=2000, S=1000, B=800)).one_off == 800
    assert breaking_point(make(I=1000, S=1300, B=1000), T=6).already_broken
    with pytest.raises(ValueError):
        breaking_point(make(), T=0)


# --------------------------------------------------------------------------- edge cases from monthly rows

def monthly(n, money_in=1000.0, money_out=800.0, bills=100.0, adb=None):
    months = pd.period_range("2025-01", periods=n, freq="M").astype(str)
    adb = adb if adb is not None else [float(i) for i in range(n)]
    return pd.DataFrame({
        "month": months, "money_in": money_in, "money_out": money_out, "household_bills": bills,
        "insurance": 10.0, "loan_payments": 0.0, "avg_daily_balance": adb, "days_below_zero": 0.0,
    })


def test_fewer_than_six_months_uses_all_rows():
    p = engine.profile_from_monthly(1, monthly(4, adb=[100.0, 200.0, 300.0, 400.0]))
    assert p.B == 250.0 and p.months_of_data == 4 and p.F == 110.0


def test_buffer_uses_last_six_months_sorted_by_month():
    df = monthly(8, adb=[float(i) for i in range(8)]).iloc[::-1]   # rows out of order
    assert engine.profile_from_monthly(1, df).B == np.mean([2, 3, 4, 5, 6, 7])


def test_zero_income():
    p = engine.profile_from_monthly(1, monthly(12, money_in=0.0, adb=[600.0] * 12))
    assert p.I == 0 and runway(p).months == round(600 / 800, 1)
    assert runway(p, PRESETS["ei_6m"]).months == round(600 / 800, 1)


def test_negative_buffer():
    p = engine.profile_from_monthly(1, monthly(12, adb=[-50.0] * 12))
    assert runway(p).months == 0.0


def test_no_money_out():
    p = engine.profile_from_monthly(1, monthly(12, money_out=0.0, bills=0.0, adb=[100.0] * 12))
    assert p.S == 0 and runway(p).no_shortfall


def test_no_monthly_rows_at_all():
    p = engine.profile_from_monthly(1, monthly(0))
    assert (p.I, p.S, p.B, p.months_of_data) == (0.0, 0.0, 0.0, 0)
    assert runway(p).months == 0.0


def test_unknown_account():
    with pytest.raises(KeyError):
        engine.profile(-1)


# --------------------------------------------------------------------------- all accounts

def test_profiles_all_shape_and_nulls():
    prof = engine.profiles_all()
    assert len(prof) == 4_500 and prof["account_id"].is_unique
    assert prof.isna().sum().sum() == 0
    assert list(prof.columns) == engine.PROFILE_COLUMNS
    assert (prof["P"] > 0).sum() == prof["loan_running"].sum()


def test_profiles_all_matches_rebuild():
    cached = engine.profiles_all()
    fresh = engine._build_profiles(
        engine.load_table("monthly_summary"), engine._loan_table(),
        pd.Index(sorted(cached["account_id"]), name="account_id"),
    )
    pd.testing.assert_frame_equal(cached.reset_index(drop=True), fresh.reset_index(drop=True))


def test_loan_rule_agrees_with_status():
    assert engine.loan_status_check().empty


@pytest.mark.parametrize("shock", [NO_SHOCK, *PRESETS.values(),
                                   Shock(income_factor=0.4, bills_pct=0.3, spend_delta=250, one_off=2000),
                                   Shock(income_factor=0.55, ei_cap_on=True)])
def test_vectorised_runway_equals_scalar_for_every_account(shock):
    prof = engine.profiles_all()
    vec = engine.runway_vec(prof, shock)
    scalar = [runway(engine.profile_from_row(int(r["account_id"]), r), shock)
              for r in prof.to_dict("records")]
    np.testing.assert_array_equal(vec["runway"].to_numpy(), [r.months for r in scalar])
    np.testing.assert_array_equal(vec["no_shortfall"].to_numpy(), [r.no_shortfall for r in scalar])


def test_all_accounts_under_one_second():
    engine.profiles_all.cache_clear()
    t0 = time.perf_counter()
    prof = engine.profiles_all()
    for r in prof.to_dict("records"):
        p = engine.profile_from_row(int(r["account_id"]), r)
        for s in (NO_SHOCK, *PRESETS.values()):
            runway(p, s)
        breaking_point(p, PRESETS["ei_6m"], 6)
    assert time.perf_counter() - t0 < 1.0


def test_cli_runs(capsys):
    assert engine.main(["20111", "--ei", "0.55", "--bills", "0.15"]) == 0
    out = capsys.readouterr().out
    assert "Runway, shocked:  3.4 months" in out
    assert engine.main(["-1"]) == 1
