import streamlit as st

import engine
import plan
import simulate
import ui

shock: engine.Shock = st.session_state.shock
target = float(shock.income_months or plan.TARGET_RUNWAY)

st.title("The whole bank under this shock", anchor=False)
st.caption(f"Shock: {ui.describe_shock(shock)} · every one of the 4,500 customers, rerun on every change")

bank, secs = ui.bank_run(ui.shock_key(shock), target)
base_under3 = float((bank["runway_base"] < 3).mean())
under3 = float((bank["runway"] < 3).mean())
zero = float((bank["runway"] == 0).mean())

with st.container(horizontal=True):
    st.metric("Customers under 3 months", f"{under3:.1%}", delta=f"{under3 - base_under3:+.1%} vs no shock",
              delta_color="inverse", border=True, help="Judges' runway under this shock")
    st.metric("Already out of money", f"{zero:.1%}", border=True, help="Buffer gone after the one-off cost")
    st.metric(f"Expected to run out within {target:g} months", f"{1 - bank['survival'].mean():.1%}", border=True,
              help="Average simulated chance of running out (Monte Carlo)")
    st.metric("Customers more likely than not to run out", f"{(bank['survival'] < 0.5).mean():.1%}", border=True)
    st.metric("Compute time", f"{secs:.2f} s", border=True,
              help=f"4,500 customers x {simulate.BANK_PATHS:,} futures x {simulate.BANK_MONTHS} months "
                   f"= {4500 * simulate.BANK_PATHS * simulate.BANK_MONTHS / 1e6:.0f}M simulated months on "
                   f"{simulate.BACKEND}")

left, right = st.columns(2)
with left:
    st.plotly_chart(ui.runway_histogram(bank), alt="Histogram of runway across all customers")
with right:
    st.plotly_chart(ui.region_heatmap(bank), alt="Share under 3 months by region and income band")

st.subheader("Most fragile customers", anchor=False)
st.caption("Lowest chance of making it, then shortest runway. Type an ID on the Customer page to open one.")
worst = (bank.sort_values(["survival", "runway"]).head(25)
         [["account_id", "region", "district_name", "I", "S", "B", "runway", "survival"]])
st.dataframe(
    worst, hide_index=True, alt="The 25 most fragile customers under this shock",
    column_config={
        "account_id": st.column_config.NumberColumn("Account", format="%d"),
        "district_name": "District", "region": "Region",
        "I": st.column_config.NumberColumn("Income", format="dollar"),
        "S": st.column_config.NumberColumn("Spending", format="dollar"),
        "B": st.column_config.NumberColumn("Buffer", format="dollar"),
        "runway": st.column_config.NumberColumn("Runway (months)", format="%.1f"),
        "survival": st.column_config.ProgressColumn(f"Chance of making {target:g} months", min_value=0, max_value=1,
                                                    format="percent"),
    })
