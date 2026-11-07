import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import discovery
import engine
import ui

st.title("Time machine", anchor=False)
st.caption("Replay a customer whose loan defaulted, month by month, using only the data the bank had at the time.")

ew = discovery.early_warning()
defaulted = ew[ew["defaulted"] == 1].sort_values("lead_months", ascending=False)
# Start on a finished loan (default date known) warned close to the median lead time: a typical story.
finished = defaulted[(defaulted["status"] == "B") & defaulted["lead_months"].notna()]
typical = finished.iloc[(finished["lead_months"] - finished["lead_months"].median()).abs().argsort()].head(1)
defaulted = pd.concat([typical, defaulted.drop(typical.index)])
labels = {int(r.account_id): (f"{int(r.account_id)} · warned {int(r.lead_months)} months ahead" if pd.notna(r.lead_months)
                              else f"{int(r.account_id)} · not flagged") for r in defaulted.itertuples()}
account_id = st.selectbox("Customer with a defaulted loan", list(labels), format_func=labels.get, key="tm_account")

row = ew.set_index("account_id").loc[account_id]
tm = discovery.time_machine(account_id)
loan = engine.load_table("loans").set_index("account_id").loc[account_id]
start = pd.Timestamp(loan["loan_start"]).to_period("M").to_timestamp()
known = row["known"].to_timestamp()
months = tm["month"].dt.strftime("%Y-%m").tolist()
upto = st.select_slider("Replay up to", options=months, value=months[-1], key="tm_upto")
view = tm[tm["month"] <= pd.Timestamp(upto + "-01")]

now = view.iloc[-1]
with st.container(horizontal=True):
    st.metric("Runway then (no shock)", "120+" if now["runway_base_lt3"] >= 120 else f"{now['runway_base_lt3']:.1f} months",
              border=True)
    st.metric("Runway then, on EI", "120+" if now["runway_stress_ei_lt2"] >= 120 else f"{now['runway_stress_ei_lt2']:.1f} months",
              border=True)
    flagged = view["runway_stress_ei_lt2"] < 2
    first = view.loc[flagged, "month"].min()
    st.metric("Early warning", "Not yet" if pd.isna(first) else f"Since {first:%b %Y}", border=True,
              help="Fires when runway under the EI twist drops below 2 months")
    st.metric("Default on record", f"{known:%b %Y}", border=True,
              help="Loan end for finished loans (status B), Dec 2025 for running loans in debt (status D)")

fig = go.Figure()
fig.add_scatter(x=view["month"], y=view["runway_base_lt3"].clip(upper=24), name="Runway, no shock",
                line=dict(color=ui.BLUE, width=3))
fig.add_scatter(x=view["month"], y=view["runway_stress_ei_lt2"].clip(upper=24), name="Runway on EI (stress test)",
                line=dict(color=ui.ORANGE, width=3))
fig.add_hline(y=2, line=dict(color=ui.RED, dash="dash"), annotation_text="Warning: under 2 months on EI")
fig.add_vline(x=start, line=dict(color=ui.GREY, dash="dot"))
fig.add_annotation(x=start, y=24, text="Loan starts", showarrow=False, yanchor="bottom")
if known <= view["month"].max():
    fig.add_vline(x=known, line=dict(color=ui.RED))
    fig.add_annotation(x=known, y=24, text="Default on record", showarrow=False, yanchor="bottom")
st.plotly_chart(ui._layout(fig, height=380, title="What the engine would have shown each month (capped at 24)",
                           yaxis_title="Months of runway", yaxis_range=[0, 26]),
                alt="Runway month by month for a customer who defaulted")

st.caption("For a live version, run `python replay.py --account <id> --from <YYYY-MM>` with Tiger Data and "
           "turn on 'Follow live feed' on the Customer page: each month lands in the hypertable and the "
           "continuous aggregate moves the numbers within a second.")
