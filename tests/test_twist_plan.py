"""Phase 3a: the twist card reader and the plans."""

from __future__ import annotations

import pytest

import engine
import plan
import twist
from engine import Shock


@pytest.mark.parametrize("text, expected", [
    ("EI 55% for 6 months", Shock(income_factor=0.55, income_months=6)),
    ("The customer faces a one-off expense equal to a full month of spending", Shock(one_off_x_S=1.0)),
    ("Lost job, on EI (55%) while household bills go up 15%", Shock(income_factor=0.55, bills_pct=0.15)),
    ("Laid off for 4 months, plus a $3,500 car repair", Shock(income_factor=0.55, income_months=4, one_off=3500)),
    ("Rent goes up by $300 a month and bills rise 10%", Shock(bills_pct=0.10, spend_delta=300)),
    ("Pay cut of 20% for twelve months", Shock(income_factor=0.8, income_months=12)),
    ("Furnace breaks: $5k", Shock(one_off=5000)),
    ("EI at 55% with the weekly maximum for 26 weeks", Shock(income_factor=0.55, income_months=6, ei_cap_on=True)),
    ("Two months of spending as a surprise cost", Shock(one_off_x_S=2.0)),
])
def test_twist_cards(text, expected):
    p = twist.parse(text)
    assert p.understood and p.shock == expected


def test_unreadable_card_changes_nothing():
    p = twist.parse("The weather is nice")
    assert not p.understood and p.shock == Shock()


def test_waterfall_ends_at_the_judges_runway():
    p = engine.profile(20396)
    for s in engine.PRESETS.values():
        wf = plan.waterfall(p, s)
        assert wf["months"].iloc[0] == engine.runway(p).months
        assert wf["months"].iloc[-1] == engine.runway(p, s).months
        assert wf["months"].iloc[0] + wf["months"].iloc[1:-1].sum() == pytest.approx(wf["months"].iloc[-1])


def test_backup_plan_reaches_target():
    p = engine.profile(20396)
    bp = plan.backup_plan(p, engine.PRESETS["ei_6m"])
    assert not bp.already_ok and bp.possible and 0 < bp.cut_pct <= 1
    assert bp.new_runway == pytest.approx(6.0, abs=0.05)


def test_backup_plan_impossible_when_buffer_gone():
    bp = plan.backup_plan(engine.profile(36407), engine.PRESETS["ei_6m"])
    assert not bp.possible and not bp.already_ok


def test_goal_plan():
    p = engine.profile(20111)                        # has gone below zero before -> 6 x S
    g = plan.goal_plan(p)
    assert g.target == pytest.approx(6 * p.S)
    assert g.months_to_target is None and g.monthly_cut_needed > 0  # spends more than they earn


def test_burn_down_matches_runway():
    p, s = engine.profile(20396), engine.PRESETS["ei_6m"]
    bd = plan.burn_down(p, s, 24)
    r = engine.runway(p, s)
    first_negative = bd.loc[bd["balance"] <= 0, "month"].min()
    assert first_negative == int(-(-r.months // 1)) or abs(first_negative - r.months) < 1


def test_peers_and_flags():
    pr = plan.peers(20111)
    assert 0 <= pr["pct_better"] <= 1 and pr["n_peers"] > 10
    texts = " ".join(f.text for f in plan.risk_flags(engine.profile(20111)))
    assert "default" in texts


def test_summary_mentions_the_runway():
    p, s = engine.profile(20396), engine.PRESETS["ei_6m"]
    text = plan.summary(p, s, 0.4, 6)
    assert "2.3 months" in text and "40%" in text
