"""Gemini is language only: it reads cards and rewords numbers, never computes them, and the app works without it."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import api
import engine
import gemini_client
from engine import Shock

CARD_40 = "Spouse loses their job, household income drops 40% for a year"


@pytest.fixture(scope="module")
def client():
    with TestClient(api.app) as c:
        yield c


@pytest.fixture
def offline(monkeypatch):
    import tiger_client
    monkeypatch.setattr(tiger_client, "_shared_conn", lambda: None)


@pytest.fixture
def no_gemini(monkeypatch):
    monkeypatch.setattr(gemini_client, "read_twist", lambda text: None)
    monkeypatch.setattr(gemini_client, "advisor_note", lambda facts: None)


def test_reader_falls_back_to_rules(client, no_gemini):
    r = client.post("/api/twist/parse", json={"text": "EI 55% for 6 months and bills up 15%"}).json()
    assert r["source"] == "rules" and r["gemini"] is None and r["agree"] is None
    assert r["shock"]["income_factor"] == 0.55 and r["shock"]["bills_pct"] == 0.15


def test_gemini_reading_shown_with_rules_comparison(client, monkeypatch):
    monkeypatch.setattr(gemini_client, "read_twist",
                        lambda text: (Shock(income_factor=0.6, income_months=12), ("Income drops 40% for 12 months",)))
    r = client.post("/api/twist/parse", json={"text": CARD_40}).json()
    assert r["source"] == "gemini" and r["shock"]["income_factor"] == 0.6
    assert r["rules"]["understood"] and r["agree"] is False          # the rules only caught "a year"


def test_agreement_and_nothing_to_compare(client, monkeypatch):
    monkeypatch.setattr(gemini_client, "read_twist",
                        lambda text: (Shock(income_factor=0.55, income_months=6, bills_pct=0.15), ("EI",)))
    assert client.post("/api/twist/parse", json={"text": "EI 55% for 6 months and bills up 15%"}).json()["agree"] is True
    monkeypatch.setattr(gemini_client, "read_twist", lambda text: (Shock(one_off_x_S=1.5), ("Repair",)))
    r = client.post("/api/twist/parse", json={"text": "Car transmission dies, a month and a half of spending"}).json()
    assert r["source"] == "gemini" and r["agree"] is None


def test_parsed_values_stay_within_slider_limits(client, no_gemini):
    r = client.post("/api/twist/parse", json={"text": "a one-off cost of $999999999"}).json()
    assert r["shock"]["one_off"] == 10_000_000
    assert client.post("/api/customer/20111/shock?live=false", json=r["shock"]).status_code == 200


def test_number_guard():
    facts = "Savings would last: 2.2 months (today: 29.5 months)\nChance: 0%\nCut by 39%, about $3,904 a month"
    assert gemini_client._grounded("You'd last 2.2 months, not 29.5. Cutting 39% ($3,904 a month) helps.", facts)
    assert not gemini_client._grounded("You'd last 2.5 months.", facts)            # recomputed
    assert not gemini_client._grounded("Cut about $4,000 a month.", facts)         # rounded


def test_note_falls_back_to_rule_summary(client, offline, no_gemini):
    shock = {"income_factor": 0.55, "income_months": 6}
    r = client.post("/api/customer/20396/note?live=false", json=shock).json()
    s = client.post("/api/customer/20396/shock?live=false", json=shock).json()
    assert r["source"] == "rules" and r["text"] == s["summary"]


def test_note_facts_hold_only_engine_numbers():
    import plan
    p = engine.profile(20396)
    s = Shock(income_factor=0.55, income_months=6)
    facts = gemini_client.note_facts(p, s, 0.04, 6, plan.backup_plan(p, s), plan.goal_plan(p), "summary")
    assert f"{engine.runway(p, s).months:.1f} months" in facts and "4%" in facts


@pytest.mark.skipif(not gemini_client.available(), reason="no GEMINI_API_KEY")
def test_live_gemini_reads_a_card_the_rules_miss():
    gemini_client.read_twist.cache_clear()
    out = gemini_client.read_twist(CARD_40)
    if out is None:
        pytest.skip("Gemini unreachable")
    shock, notes = out
    assert shock.income_factor == pytest.approx(0.6, abs=0.01) and shock.income_months == 12 and notes
