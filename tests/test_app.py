"""The app: every page runs without an exception, offline, and the live twist works end to end."""

from __future__ import annotations

from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

import discovery

APP = str(Path(__file__).resolve().parents[1] / "app.py")

PAGES = ["app_pages/customer.py", "app_pages/bank.py", "app_pages/finding.py", "app_pages/time_machine.py",
         "app_pages/method.py"]


@pytest.fixture
def offline(monkeypatch):
    """Rehearse with the Wi-Fi off: Tiger Data unreachable."""
    import tiger_client
    monkeypatch.setattr(tiger_client, "_shared_conn", lambda: None)


def _app(page: str | None = None) -> AppTest:
    at = AppTest.from_file(APP, default_timeout=60)
    if page:
        at.switch_page(page)
    return at


@pytest.mark.parametrize("page", PAGES)
def test_every_page_runs_offline(page, offline):
    discovery.main_finding()  # discovery tables cached
    at = _app(page).run()
    assert not at.exception, at.exception


def test_live_twist_offline(offline):
    at = _app().run()
    at.session_state["account_id"] = 20396
    at.text_area(key="card_text").set_value("EI 55% for 6 months and bills up 15%")
    at.button(key="read_card").click().run()
    at.button(key="apply_card").click().run()
    assert not at.exception
    metrics = {m.label: m.value for m in at.metric}
    assert metrics["Runway today"] == "29.5 months"
    assert metrics["Runway after the shock"] == "2.2 months"
    assert metrics["Lasts the 6 months of EI?"] == "No"


def test_preset_buttons(offline):
    at = _app().run()
    at.button(key="preset_one_month").click().run()
    assert at.session_state["one_off_s"] == 1.0
    at.button(key="preset_reset").click().run()
    assert at.session_state["one_off_s"] == 0.0 and not at.exception


def test_unknown_account(offline):
    at = _app().run()
    at.number_input(key="account_id").set_value(1).run()
    assert at.error and "not in the data" in at.error[0].value
