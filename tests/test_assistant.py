"""The assistant: its tools return the engine's numbers, its actions are validated, and invented figures are flagged."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import api
import assistant
import engine
import gemini_client
import plan
from engine import Shock

CTX = assistant.context_from(20396, Shock())


@pytest.fixture(scope="module")
def client():
    with TestClient(api.app) as c:
        yield c


def test_get_customer_matches_engine():
    out = assistant.tool_get_customer(CTX)
    p = engine.profile(20396)
    assert out["income_I_median_month"] == f"${p.I:,.0f}" and out["buffer_B_savings"] == f"${p.B:,.0f}"
    assert out["runway_today_no_shock"] == f"{engine.runway(p).months:.1f} months"


def test_run_shock_matches_engine_and_leaves_screen_alone():
    out = assistant.tool_run_shock(CTX, income_pct=55, income_months=6)
    p, s = engine.profile(20396), Shock(income_factor=0.55, income_months=6)
    assert out["runway_after_shock"] == f"{engine.runway(p, s).months:.1f} months"
    b = plan.backup_plan(p, s)
    assert f"${b.cut_amount:,.0f}" in out["backup_plan"]
    assert CTX["shock"] == Shock()                       # a what-if never changes the screen


def test_bank_stress_matches_engine():
    out = assistant.tool_bank_stress(CTX, bills_pct=20)
    rw = engine.runway_vec(engine.profiles_all(), Shock(bills_pct=0.2))["runway"]
    assert out["share_under_3_months"] == f"{(rw < 3).mean() * 100:.1f}%"


def test_actions_are_validated():
    assert assistant.act_open_account(CTX, 20111)["action"] == {"type": "open_account", "account_id": 20111}
    with pytest.raises(ValueError):
        assistant.act_open_account(CTX, 1)
    with pytest.raises(ValueError):
        assistant.act_set_view(CTX, "expert")
    with pytest.raises(ValueError):
        assistant.act_go_to_page(CTX, "admin")
    a = assistant.act_set_shock({**CTX, "shock": Shock(bills_pct=0.15)}, income_pct=55)["action"]
    assert a["shock"]["income_factor"] == 0.55 and a["shock"]["bills_pct"] == 0.15     # keeps the other levers
    a = assistant.act_set_shock(CTX, one_off=99_999_999_999)["action"]
    assert a["shock"]["one_off"] == 10_000_000                                          # clamped to slider range


def test_guard_flags_invented_figures():
    src = ['{"runway_after_shock": "2.3 months", "backup_plan": "cut by 36%, about $3,619 a month"}']
    assert assistant.unchecked_figures("They'd last 2.3 months; cut 36% ($3,619 a month).", src) == []
    assert assistant.unchecked_figures("They'd last 2.5 months and need $4,000.", src) == ["2.5", "4000"]


def test_chat_without_a_key(client, monkeypatch):
    monkeypatch.setattr(gemini_client, "available", lambda: False)
    r = client.post("/api/chat", json={"messages": [{"role": "user", "text": "hi"}], "account_id": 20396}).json()
    assert r["ok"] is False and r["actions"] == [] and "GEMINI_API_KEY" in r["reply"]


def test_chat_rejects_bad_requests(client):
    assert client.post("/api/chat", json={"messages": [], "account_id": 20396}).status_code == 422
    assert client.post("/api/chat", json={"messages": [{"role": "assistant", "text": "x"}], "account_id": 20396}).status_code == 422
    assert client.post("/api/chat", json={"messages": [{"role": "system", "text": "x"}], "account_id": 20396}).status_code == 422


@pytest.mark.skipif(not gemini_client.available(), reason="no GEMINI_API_KEY")
def test_live_chat_answers_from_tools_and_changes_settings(client):
    r = client.post("/api/chat", json={"messages": [{"role": "user", "text": "Switch to the advanced view and tell me this customer's runway today"}],
                                       "account_id": 20396}).json()
    if not r["ok"]:
        pytest.skip(f"Gemini unavailable: {r['reply']}")
    assert {"type": "set_view", "view": "advanced"} in r["actions"]
    assert "29.5" in r["reply"] and r["unchecked"] == []
