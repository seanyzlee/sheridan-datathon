"""Shared pieces for the Streamlit pages: shock state, cached computations and charts.

Pages stay as plain scripts; everything reusable lives here.
"""

from __future__ import annotations

import random

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import engine
import plan
import risk
import simulate
import tiger_client
import twist
from engine import Profile, Shock

ORANGE, BLUE, GREY, RED, GREEN = "#F57C00", "#2E6FD8", "#8A8F98", "#D64545", "#2E9E5B"
FAN_FILL = "rgba(245,124,0,0.18)"

# --------------------------------------------------------------------------- session state

SHOCK_DEFAULTS = {"income_pct": 100, "ei_months": 0, "bills_pct": 0, "spend_delta": 0.0, "one_off": 0.0,
                  "one_off_s": 0.0, "ei_cap": False}
PRESET_LABELS = {"ei_6m": "EI 55% for 6 months", "one_month": "One-off = a month of spending",
                 "ei_bills": "EI 55% + bills +15%"}


def init_state() -> None:
    for k, v in SHOCK_DEFAULTS.items():
        st.session_state.setdefault(k, v)
    st.session_state.setdefault("account_id", 20111)
    st.session_state.setdefault("use_live", True)
    st.session_state.setdefault("parsed_card", None)
    # Shareable demo links: ?account=20396&twist=EI 55% for 6 months (applied once, on the first run)
    if not st.session_state.get("_query_applied"):
        st.session_state._query_applied = True
        qp = st.query_params
        if qp.get("account", "").isdigit():
            st.session_state.account_id = int(qp["account"])
        if qp.get("twist"):
            st.session_state.card_text = qp["twist"]
            parsed = twist.parse(qp["twist"])
            st.session_state.parsed_card = parsed
            if parsed.understood:
                set_shock(parsed.shock)


def set_shock(s: Shock) -> None:
    st.session_state.update(
        income_pct=int(round(s.income_factor * 100)), ei_months=int(s.income_months or 0),
        bills_pct=int(round(s.bills_pct * 100)), spend_delta=float(s.spend_delta), one_off=float(s.one_off),
        one_off_s=float(s.one_off_x_S), ei_cap=bool(s.ei_cap_on))


def current_shock() -> Shock:
    ss = st.session_state
    return Shock(income_factor=ss.income_pct / 100, income_months=ss.ei_months or None,
                 bills_pct=ss.bills_pct / 100, spend_delta=float(ss.spend_delta), one_off=float(ss.one_off),
                 one_off_x_S=float(ss.one_off_s), ei_cap_on=bool(ss.ei_cap))


def shock_key(s: Shock) -> tuple:
    return (s.income_factor, s.income_months, s.bills_pct, s.spend_delta, s.one_off, s.one_off_x_S, s.ei_cap_on)


def describe_shock(s: Shock) -> str:
    if s == Shock():
        return "No shock"
    parts = []
    if s.income_factor != 1:
        parts.append(f"income {s.income_factor:.0%}" + (f" for {s.income_months} mo" if s.income_months else ""))
    if s.bills_pct:
        parts.append(f"bills +{s.bills_pct:.0%}")
    if s.spend_delta:
        parts.append(f"other +${s.spend_delta:,.0f}/mo")
    if s.one_off:
        parts.append(f"one-off ${s.one_off:,.0f}")
    if s.one_off_x_S:
        parts.append(f"one-off {s.one_off_x_S:g} x spending")
    if s.ei_cap_on:
        parts.append("EI cap")
    return ", ".join(parts)


def _apply_preset(name: str) -> None:
    set_shock(engine.PRESETS[name])


def _reset_shock() -> None:
    st.session_state.update(SHOCK_DEFAULTS)


def _read_card() -> None:
    text = st.session_state.get("card_text", "")
    st.session_state.parsed_card = twist.parse(text) if text.strip() else None


def _apply_card() -> None:
    parsed = st.session_state.parsed_card
    if parsed is not None:
        set_shock(parsed.shock)


def random_account() -> None:
    ids = engine.profiles_all()["account_id"].tolist()
    st.session_state.account_id = int(random.choice(ids))


# --------------------------------------------------------------------------- sidebar

def shock_sidebar() -> Shock:
    with st.sidebar:
        st.subheader("Twist card", anchor=False)
        st.text_area("Paste the twist card", key="card_text", height=90,
                     placeholder="e.g. Lost job, EI at 55% for 6 months, and bills up 15%")
        with st.container(horizontal=True):
            st.button("Read card", icon=":material/document_scanner:", on_click=_read_card, key="read_card")
            parsed = st.session_state.parsed_card
            st.button("Apply", icon=":material/check:", on_click=_apply_card, key="apply_card",
                      disabled=parsed is None or not parsed.understood, type="primary")
        parsed = st.session_state.parsed_card
        if parsed is not None:
            if parsed.understood:
                st.caption("Understood: " + "; ".join(parsed.notes))
                st.json(parsed.as_dict(), expanded=False)
            else:
                st.warning("No shock found in that text. Set the sliders by hand.", icon=":material/help:")

        st.subheader("Presets", anchor=False)
        for name, label in PRESET_LABELS.items():
            st.button(label, key=f"preset_{name}", on_click=_apply_preset, args=(name,), width="stretch")
        st.button("Clear shock", key="preset_reset", on_click=_reset_shock, icon=":material/restart_alt:",
                  width="stretch")

        st.subheader("Shock", anchor=False)
        st.slider("Income (% of normal)", 0, 100, key="income_pct", step=5,
                  help="55% is the judges' EI rate.")
        st.number_input("EI length (months, 0 = not set)", 0, 24, key="ei_months",
                        help="Used for the 'do they make it' verdict and the simulation, not the judges' runway.")
        st.slider("Bills increase (% of H)", 0, 50, key="bills_pct")
        st.number_input("Rent / other increase ($ per month)", 0.0, 10_000.0, key="spend_delta", step=50.0)
        st.number_input("One-off cost ($)", 0.0, 100_000.0, key="one_off", step=250.0)
        st.slider("One-off cost (x a month's spending)", 0.0, 3.0, key="one_off_s", step=0.25)
        st.toggle("Apply the EI weekly maximum ($729)", key="ei_cap",
                  help="Off = the judges' 55% x income. On = also cap EI at the 2026 maximum.")
    return current_shock()


def status_badges(source: str) -> None:
    with st.sidebar:
        st.divider()
        with st.container(horizontal=True):
            if source == tiger_client.LIVE:
                st.badge("Tiger Data live", icon=":material/cloud_done:", color="green")
            else:
                st.badge("Offline cache", icon=":material/cloud_off:", color="gray")
            st.badge(simulate.BACKEND, icon=":material/memory:", color="orange" if simulate.IS_CPP else "gray")


# --------------------------------------------------------------------------- cached computations

@st.cache_resource(show_spinner="Loading profiles for all 4,500 customers...")
def warm_up() -> bool:
    """Preload everything the live twist needs so the first click is fast."""
    engine.profiles_all()
    risk.risk_factors_all()
    simulate.bank_params()
    plan._account_facts()
    plan._peer_table()
    tiger_client._monthly_cache()
    return True


@st.cache_data(max_entries=256, show_spinner=False)
def sim_one(profile_key: tuple, shock_k: tuple, target: float) -> dict:
    p = Profile(*profile_key)
    return simulate.one(p, Shock(*shock_k), target=target)


def survival(p: Profile, s: Shock, target: float) -> dict:
    from dataclasses import astuple
    return sim_one(astuple(p), shock_key(s), target)


@st.cache_data(max_entries=64, show_spinner=False)
def bank_run(shock_k: tuple, target: float) -> tuple[pd.DataFrame, float]:
    s = Shock(*shock_k)
    sim, secs = simulate.bank(s, target=target)
    prof = engine.profiles_all()
    rw = engine.runway_vec(prof, s)
    out = prof[["account_id", "I", "S", "B", "runway_base"]].copy()
    out["runway"] = rw["runway"].to_numpy()
    out["no_shortfall"] = rw["no_shortfall"].to_numpy()
    out["survival"] = sim["survival"].to_numpy()
    out = out.merge(plan._account_facts()[["region", "district_name", "unemployment_rate_2023"]],
                    left_on="account_id", right_index=True, how="left")
    out["income_band"] = pd.qcut(out["I"].rank(method="first"), 5, labels=["Lowest", "Low", "Middle", "High", "Highest"])
    return out, secs


def get_profile(account_id: int) -> tuple[Profile, pd.DataFrame, str]:
    live = st.session_state.get("use_live", True)
    p, src = tiger_client.live_profile(account_id, prefer_live=live)
    monthly, msrc = tiger_client.live_monthly(account_id, prefer_live=live and src == tiger_client.LIVE)
    return p, monthly, src if msrc == src else tiger_client.OFFLINE


# --------------------------------------------------------------------------- formatting

def money(x: float) -> str:
    return f"-${-x:,.0f}" if x < 0 else f"${x:,.0f}"


def months_label(r: engine.RunwayResult) -> str:
    return "120+ months" if r.no_shortfall or r.months >= engine.RUNWAY_CAP else f"{r.months:.1f} months"


def _layout(fig: go.Figure, height: int = 320, **kw) -> go.Figure:
    kw.setdefault("hovermode", "x unified")
    # Legend under the plot, below the x-axis title, so the two never overlap
    fig.update_layout(height=height, margin=dict(l=8, r=8, t=36, b=8),
                      legend=dict(orientation="h", yanchor="top", y=-0.22 if kw.get("xaxis_title") else -0.1), **kw)
    return fig


# --------------------------------------------------------------------------- charts

def monthly_chart(m: pd.DataFrame, months: int = 24) -> go.Figure:
    d = m.tail(months)
    fig = go.Figure()
    fig.add_bar(x=d["month"], y=d["money_in"], name="Money in", marker_color=BLUE)
    fig.add_bar(x=d["month"], y=-d["money_out"], name="Money out", marker_color=ORANGE)
    fig.add_scatter(x=d["month"], y=d["avg_daily_balance"], name="Average daily balance", yaxis="y2",
                    mode="lines+markers", line=dict(color="#333", width=2))
    return _layout(fig, title="Last 24 months", barmode="relative",
                   yaxis=dict(title="Monthly flow ($)"),
                   yaxis2=dict(title="Balance ($)", overlaying="y", side="right", showgrid=False))


SPEND_COLUMNS = {"household_bills": "Bills", "insurance": "Insurance", "loan_payments": "Loan",
                 "card_withdrawals": "Card", "cash_withdrawals_genuine": "Cash",
                 "transfers_out_other": "Other transfers", "bank_fees": "Fees"}


def spending_chart(m: pd.DataFrame) -> go.Figure:
    d = m.tail(12)[list(SPEND_COLUMNS)].mean().rename(SPEND_COLUMNS)
    d = d[d > 0].sort_values()
    fixed = {"Bills", "Insurance", "Loan", "Fees"}
    fig = go.Figure(go.Bar(x=d.values, y=d.index, orientation="h",
                           marker_color=[GREY if k in fixed else ORANGE for k in d.index],
                           text=[money(v) for v in d.values], textposition="auto"))
    return _layout(fig, height=300, title="Spending per month, last 12 months (orange = can be cut)",
                   xaxis_title="$ per month", hovermode="closest")


def waterfall_chart(wf: pd.DataFrame) -> go.Figure:
    fig = go.Figure(go.Waterfall(
        x=wf["step"], y=wf["months"], measure=wf["measure"],
        text=[f"{v:+.1f}" if m == "relative" else f"{v:.1f}" for v, m in zip(wf["months"], wf["measure"])],
        decreasing=dict(marker=dict(color=RED)), increasing=dict(marker=dict(color=GREEN)),
        totals=dict(marker=dict(color=ORANGE)), connector=dict(line=dict(color=GREY))))
    return _layout(fig, height=300, title="What moved the runway (months)", yaxis_title="Months",
                   hovermode="closest")


def burn_down_chart(bd: pd.DataFrame, fan: np.ndarray | None = None) -> go.Figure:
    fig = go.Figure()
    if fan is not None:
        t = np.arange(fan.shape[1])
        fig.add_scatter(x=t, y=fan[2], mode="lines", line=dict(width=0), showlegend=False, hoverinfo="skip")
        fig.add_scatter(x=t, y=fan[0], mode="lines", fill="tonexty", fillcolor=FAN_FILL, line=dict(width=0),
                        name="Simulated futures (10th to 90th percentile)")
        fig.add_scatter(x=t, y=fan[1], mode="lines", line=dict(color=ORANGE, dash="dot"), name="Simulated median")
    fig.add_scatter(x=bd["month"], y=bd["balance"], mode="lines", line=dict(color="#333", width=3), name="Judges' formula")
    if "balance_ei_ends" in bd:
        fig.add_scatter(x=bd["month"], y=bd["balance_ei_ends"], mode="lines", line=dict(color=RED, dash="dash"),
                        name="If EI ends and no new job")
    fig.add_hline(y=0, line=dict(color=RED, width=1))
    fig = _layout(fig, height=380, title="Balance after the shock, month by month", yaxis_title="Balance ($)")
    return fig


def runway_histogram(df: pd.DataFrame) -> go.Figure:
    r = df["runway"].clip(upper=36)
    fig = go.Figure()
    fig.add_histogram(x=r[df["runway"] < 3], xbins=dict(start=0, end=37, size=1), name="Under 3 months",
                      marker_color=RED)
    fig.add_histogram(x=r[df["runway"] >= 3], xbins=dict(start=0, end=37, size=1), name="3 months or more",
                      marker_color=BLUE)
    return _layout(fig, height=320, barmode="stack", title="Runway under this shock (36+ grouped at the right)",
                   xaxis_title="Months of runway", yaxis_title="Customers", hovermode="closest")


def region_heatmap(df: pd.DataFrame) -> go.Figure:
    pv = (df.assign(under3=df["runway"] < 3)
          .pivot_table(index="region", columns="income_band", values="under3", aggfunc="mean", observed=False))
    fig = go.Figure(go.Heatmap(z=pv.values * 100, x=[str(c) for c in pv.columns], y=pv.index,
                               colorscale=[[0, "#FFF4E8"], [1, RED]], zmin=0,
                               text=np.round(pv.values * 100).astype(int), texttemplate="%{text}%",
                               colorbar=dict(title="% under 3 mo")))
    return _layout(fig, height=360, title="Share under 3 months, by region and income band",
                   xaxis_title="Income band", hovermode="closest")
