"""Shock Autopilot: detection reads the customer's own months, and every ladder figure is the engine's."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import api
import autopilot
import engine
import tiger_client
from engine import Shock

EI = Shock(income_factor=0.55, income_months=6)


@pytest.fixture(scope="module")
def client():
    with TestClient(api.app) as c:
        yield c


def _monthly(acct):
    return tiger_client.cached_monthly(acct)


def test_detects_a_real_income_drop():
    d = autopilot.detect(engine.profile(26773), _monthly(26773))      # latest month about 20% of usual income
    assert d["detected"] and d["suggested_shock"]["income_factor"] < 0.6 and d["message"]


def test_no_alarm_when_income_is_normal():
    m = _monthly(20396)
    p = engine.profile(20396)
    assert m.sort_values("month").iloc[-1]["money_in"] / p.I >= autopilot.DETECT_BELOW
    assert not autopilot.detect(p, m)["detected"]


def test_ladder_steps_add_up_to_the_engine_runway():
    p, m = engine.profile(20396), _monthly(20396)
    rungs = autopilot.ladder(p, EI, m)
    assert rungs and all(r["saving"] > 0 for r in rungs)
    saved = sum(r["saving"] for r in rungs)
    final = engine.runway(p, Shock(**{**EI.__dict__, "spend_delta": -saved}))
    assert rungs[-1]["runway_after_text"] == autopilot._months(final)
    # taking every step never makes things worse
    assert all(r["adds"] >= 0 for r in rungs)


def test_evaluate_matches_engine_for_any_choice():
    p, m = engine.profile(20396), _monthly(20396)
    ids = [r["id"] for r in autopilot.steps(p, m)]
    for chosen in ([], ids[:1], ids):
        res = autopilot.evaluate(p, EI, m, chosen)
        saving = sum(st["saving"] for st in autopilot.steps(p, m) if st["id"] in chosen)
        r = engine.runway(p, Shock(**{**EI.__dict__, "spend_delta": -saving}))
        assert res["after"]["text"] == autopilot._months(r)
        assert 0 <= res["after"]["survival"] <= 1
    assert autopilot.evaluate(p, EI, m, ids)["after"]["months"] >= autopilot.evaluate(p, EI, m, [])["after"]["months"]


def test_endpoint(client, monkeypatch):
    monkeypatch.setattr(tiger_client, "_shared_conn", lambda: None)
    r = client.post("/api/customer/20396/autopilot?live=false", json={"shock": {"income_factor": 0.55, "income_months": 6}, "steps": ["trim_cash"]}).json()
    assert r["ladder"] and r["result"]["chosen"] == ["trim_cash"] and "detected" in r["detection"]
    assert client.post("/api/customer/1/autopilot", json={}).status_code == 404
    assert client.post("/api/customer/20396/autopilot", json={"steps": ["x"] * 11}).status_code == 422
