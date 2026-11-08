"""The web API: every endpoint answers, the numbers are the engine's, and it all works offline."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import api
import engine


@pytest.fixture(scope="module")
def client():
    with TestClient(api.app) as c:
        yield c


@pytest.fixture
def offline(monkeypatch):
    """Rehearse with the Wi-Fi off: Tiger Data unreachable."""
    import tiger_client
    monkeypatch.setattr(tiger_client, "_shared_conn", lambda: None)


EI_6M = {"income_factor": 0.55, "income_months": 6}


def test_status_and_accounts(client):
    s = client.get("/api/status").json()
    assert s["accounts"] == 4500 and set(s["presets"]) == set(engine.PRESETS)
    assert len(client.get("/api/accounts").json()["ids"]) == 4500
    assert client.get("/api/accounts/random").json()["account_id"] in api.account_set()


@pytest.mark.parametrize("acct", [20111, 20396, 36407])
def test_customer_matches_engine(client, offline, acct):
    c = client.get(f"/api/customer/{acct}?live=false").json()
    p = engine.profile(acct)
    for k in ("I", "S", "F", "H", "B", "P"):
        assert c["profile"][k] == pytest.approx(getattr(p, k))
    assert c["runway_base"]["months"] == engine.runway(p).months
    assert c["source"] == "Offline cache"
    assert len(c["monthly"]) <= 24 and c["flags"] and c["peers"]["n_peers"] > 0


@pytest.mark.parametrize("shock", [EI_6M, {"one_off_x_S": 1.0}, {"income_factor": 0.55, "bills_pct": 0.15},
                                   {"spend_delta": 300, "one_off": 2500, "ei_cap_on": True}])
def test_shock_matches_engine(client, offline, shock):
    r = client.post("/api/customer/20396/shock?live=false", json=shock).json()
    p = engine.profile(20396)
    s = api.ShockIn(**shock).to_shock()
    assert r["runway"]["months"] == engine.runway(p, s).months
    assert 0 <= r["survival"]["p"] <= 1
    assert r["burn_down"][0]["balance"] == pytest.approx(engine.runway(p, s).buffer_left)
    assert r["waterfall"][0]["step"] == "Base runway" and r["summary"]


def test_bank(client):
    b = client.post("/api/bank", json=EI_6M).json()
    assert b["customers"] == 4500 and len(b["worst"]) == 25
    assert sum(h["under3"] + h["over3"] for h in b["histogram"]) == 4500
    rw = engine.runway_vec(engine.profiles_all(), api.ShockIn(**EI_6M).to_shock())["runway"]
    assert b["kpis"]["under3"] == pytest.approx(float((rw < 3).mean()))


def test_discovery_pages(client):
    f = client.get("/api/finding").json()
    assert 0 < f["main"]["caught"] <= 1 and len(f["rules"]) == 4
    items = client.get("/api/time-machine").json()["customers"]
    assert items
    tm = client.get(f"/api/time-machine/{items[0]['account_id']}").json()
    assert tm["months"] and tm["known"]
    assert client.get("/api/method").json()["backtest"]


def test_twist_reader(client, monkeypatch):
    import gemini_client
    monkeypatch.setattr(gemini_client, "read_twist", lambda text: None)   # rules only: no network in this test
    r = client.post("/api/twist/parse", json={"text": "EI 55% for 6 months and bills up 15%"}).json()
    assert r["understood"] and r["shock"]["income_factor"] == 0.55 and r["shock"]["bills_pct"] == 0.15
    assert not client.post("/api/twist/parse", json={"text": "hello"}).json()["understood"]


def test_errors(client):
    assert client.get("/api/customer/1").status_code == 404
    assert client.post("/api/customer/20111/shock", json={"income_factor": 2}).status_code == 422
    assert client.get("/api/time-machine/20134").status_code == 404     # loan didn't default
    assert client.get("/api/nope").status_code == 404


def test_stress_surface_is_the_judges_formula(client):
    s = client.post("/api/bank/surface", json=EI_6M).json()
    assert len(s["income"]) == 21 and len(s["bills"]) == 26 and len(s["under3"]) == 21
    prof = engine.profiles_all()
    for inc, bills in [(100, 0), (55, 0), (55, 20), (0, 50)]:
        rw = engine.runway_vec(prof, engine.Shock(income_factor=inc / 100, bills_pct=bills / 100))["runway"]
        assert s["under3"][s["income"].index(inc)][s["bills"].index(bills)] == pytest.approx(float((rw < 3).mean()), abs=1e-5)
    # the marker is the current shock's exact value, the same number the whole-bank view shows
    b = client.post("/api/bank", json=EI_6M).json()
    assert s["marker"]["under3"] == pytest.approx(b["kpis"]["under3"])
    held = client.post("/api/bank/surface", json={"one_off": 2500, "ei_cap_on": True}).json()["held"]
    assert held == ["the one-off cost", "the EI weekly maximum"]
