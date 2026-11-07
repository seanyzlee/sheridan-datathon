import plotly.graph_objects as go
import streamlit as st

import discovery
import ui

st.title("The twist is the early warning", anchor=False)
f = discovery.main_finding()
st.markdown(f"#### {f['headline']}")
st.caption("Checked against the 682 real loan outcomes, using only the data the bank had at each month. "
           "The default is 'on record' at the loan's end for finished loans and in Dec 2025 for running ones, "
           "so the true warning time may be shorter.")

with st.container(horizontal=True):
    st.metric("Defaults caught", f"{f['caught']:.0%}", border=True)
    st.metric("Median warning", f"{f['median_lead']:.0f} months", border=True)
    st.metric("Default rate if flagged", f"{f['rate_flagged']:.0%}", border=True)
    st.metric("Default rate if not flagged", f"{f['rate_not_flagged']:.1%}", border=True)
    st.metric("Good loans flagged", f"{f['false_alarms']:.0%}", border=True, help="False alarms")

ew = discovery.early_warning_summary()
SHORT = {"stress_ei_lt2": "On EI<br>under 2 mo", "base_lt3": "No shock<br>under 3 mo", "base_lt6": "No shock<br>under 6 mo",
         "stress_one_month_lt3": "After a one-off<br>under 3 mo"}
ew["short"] = ew["rule"].map(SHORT)
left, right = st.columns(2)
with left:
    fig = go.Figure()
    fig.add_bar(x=ew["short"], y=ew["caught"] * 100, name="Defaults caught", marker_color=ui.ORANGE,
                text=[f"{v:.0%}" for v in ew["caught"]], textposition="outside")
    fig.add_bar(x=ew["short"], y=ew["false_alarms"] * 100, name="Good loans flagged", marker_color=ui.GREY,
                text=[f"{v:.0%}" for v in ew["false_alarms"]], textposition="outside")
    fig = ui._layout(fig, height=380, title="Which warning rule works best", yaxis_title="%",
                     barmode="group", hovermode="closest")
    fig.update_layout(legend=dict(yanchor="bottom", y=1.0, xanchor="right", x=1), xaxis_tickangle=0)
    st.plotly_chart(fig, alt="Early-warning rules compared")
with right:
    db = discovery.default_by_band()
    fig = go.Figure(go.Bar(x=db["band"].astype(str), y=db["default_rate"] * 100, marker_color=ui.RED,
                           text=[f"{r:.0%}<br>({d}/{n})" for r, d, n in zip(db["default_rate"], db["defaults"], db["loans"])],
                           textposition="outside"))
    st.plotly_chart(ui._layout(fig, height=380, title="Default rate by today's runway (months)",
                               yaxis_title="% of loans defaulted", hovermode="closest"),
                    alt="Default rate by runway band")

st.header("What else the data says", anchor=False)
left, right = st.columns(2)
with left:
    fg = discovery.fragile_groups()
    inc = fg[fg["dimension"] == "income_band"]
    fig = go.Figure(go.Bar(x=inc["group"], y=inc["share_fail_6m_ei"] * 100, marker_color=ui.BLUE,
                           text=[f"{v:.0%}" for v in inc["share_fail_6m_ei"]], textposition="outside"))
    st.plotly_chart(ui._layout(fig, height=340, title="Higher earners are the most exposed to losing their job",
                               yaxis_title="% who can't last 6 months on EI", xaxis_title="Income band",
                               hovermode="closest"), alt="Share failing 6 months on EI by income band")
    st.caption("Their spending is high relative to their buffer, so losing 45% of income opens a big monthly gap. "
               "Customers 60+ are the safest (9% fail), likely thanks to pensions.")
with right:
    e = discovery.ei_cap_effect()
    crossed = float(((e["runway_judges"] >= 6) & (e["runway_capped"] < 6)).mean())
    hit = float(e["hit_by_cap"].mean())
    tp = discovery.tipping_point()
    fig = go.Figure()
    for label, color in [("Employed", ui.BLUE), ("On EI (55%)", ui.ORANGE)]:
        d = tp[tp["income"] == label]
        fig.add_scatter(x=d["bills_pct"] * 100, y=d["under_3"] * 100, name=label, line=dict(color=color, width=3))
    st.plotly_chart(ui._layout(fig, height=340, title="No tipping point: bills rises add up slowly, job loss doesn't",
                               xaxis_title="Bills increase (%)", yaxis_title="% of customers under 3 months"),
                    alt="Share under 3 months as bills rise")
    st.caption(f"Canadian realism: {hit:.0%} of customers earn more than EI's $729/week cap covers. "
               f"Applying the real cap pushes another {crossed:.0%} of all customers below 6 months on EI.")

r = discovery.regional()
st.caption(f"Region doesn't explain fragility: across 77 districts the share failing 6 months on EI barely moves with "
           f"unemployment (r = {r['share_fail'].corr(r['unemployment']):.2f}) or salary "
           f"(r = {r['share_fail'].corr(r['salary']):.2f}). It's the household, not the postcode.")
