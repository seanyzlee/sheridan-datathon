from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import discovery
import simulate
import ui

ROOT = Path(__file__).resolve().parents[1]

st.title("How it works", anchor=False)

st.markdown("""
**1. The judges' number, exactly.** `engine.py` computes I, S, F, H, B and P from the monthly summary and applies
the runway formula with the same rounding and 120-month cap. It's tested against hand-worked accounts and against
all 4,500 customers.

**2. Live from Tiger Data.** Transactions sit in a TimescaleDB hypertable (columnstore, segmented by account).
A real-time continuous aggregate rebuilds every monthly total, and the `profile_live` view computes the exact
medians with `percentile_cont`. It reproduces the challenge's monthly table on all 185,326 account-months and the
engine's profile on every customer. `replay.py` streams a customer's transactions back in and the numbers move live.

**3. A C++ simulation core.** Around the judges' number, 10,000 simulated futures per customer add income and
spending swings (each customer's own volatility), random job loss (from their district's unemployment rate), EI
running out, one-off repairs and bill inflation (Canadian CPI). With all of that switched off, the simulation lands
exactly on the judges' runway. It's written in C++17 with OpenMP and called from Python with pybind11, with a
NumPy version of the same model as the fallback.
""")

bench = ROOT / "docs" / "bench.csv"
if bench.exists():
    b = pd.read_csv(bench)
    b["label"] = b["method"] + b["threads"].map(lambda t: f" x{t}" if t > 1 else "")
    fig = go.Figure(go.Bar(x=b["seconds"], y=b["label"], orientation="h",
                           marker_color=[ui.GREY, ui.GREY] + [ui.ORANGE] * (len(b) - 2),
                           text=[f"{s:.2f} s ({x:,.0f}x)" for s, x in zip(b["seconds"], b["speedup_vs_python"])],
                           textposition="auto"))
    fig.update_xaxes(type="log", title="Seconds (log scale)")
    st.plotly_chart(ui._layout(fig, height=300, title="Whole bank: 4,500 customers x 2,000 futures x 24 months",
                               hovermode="closest"), alt="Benchmark of Python, NumPy and C++")
st.caption(f"Running now on: {simulate.BACKEND}. Pure Python and NumPy times are scaled up from a sample.")

st.subheader("Is the simulation calibrated?", anchor=False)
bt = discovery.backtest()
st.markdown(f"We built every profile from data up to June 2025, simulated the next 6 months, and compared with "
            f"what really happened: **{bt['actual_share'].iloc[0]:.1%}** of {bt['accounts'].iloc[0]:,} customers "
            f"ended a month at or below zero. Drawing each month's swings with each customer's full volatility "
            f"overstates risk, because real spending is lumpy but evens out. Scaling the swings to 30% gives the best "
            f"score, and beats the judges' formula on its own.")
st.dataframe(bt[["model", "predicted_share", "actual_share", "brier"]], hide_index=True,
             alt="Backtest of the simulation against real outcomes",
             column_config={"model": "Model", "predicted_share": st.column_config.NumberColumn("Predicted to run out", format="percent"),
                            "actual_share": st.column_config.NumberColumn("Actually ran out", format="percent"),
                            "brier": st.column_config.NumberColumn("Brier score (lower is better)", format="%.4f")})

st.subheader("Definitions", anchor=False)
st.markdown("""
| | Definition |
|---|---|
| I | median monthly money in |
| S | median monthly money out |
| F | median of (household bills + insurance + loan payments), summed per month first |
| H | median household bills |
| B | mean average daily balance over the last 6 months |
| P | monthly loan payment if the loan runs past Dec 2025, else 0 |
| Runway | (B − one-off) / (S + bills % × H + other − income factor × I); 0 if the buffer is gone, 120+ if there's no gap |
""")

st.subheader("Sources", anchor=False)
st.markdown("""
- Bank data: PKDD'99 Financial dataset (Czech bank), as provided by the challenge
- EI maximum weekly benefit 2026: $729 (maximum insurable earnings $68,900), canada.ca
- CPI 12-month change: 2.8% (April 2026), Statistics Canada table 18-10-0004-01
""")
