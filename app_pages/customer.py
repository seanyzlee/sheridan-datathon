import streamlit as st

import engine
import plan
import tiger_client
import ui

shock: engine.Shock = st.session_state.shock
ids = set(engine.profiles_all()["account_id"].tolist())

st.title("Know the customer", anchor=False)
with st.container(horizontal=True, vertical_alignment="bottom"):
    st.number_input("Account ID", min_value=0, step=1, key="account_id", width=180)
    st.button("Random account", icon=":material/casino:", on_click=ui.random_account)
    st.toggle("Use Tiger Data", key="use_live", help="Off = read everything from the local Parquet cache.")
    follow = st.toggle("Follow live feed", key="follow_live",
                       help="Re-reads Tiger Data every 2 seconds while replay.py streams transactions in.")

account_id = int(st.session_state.account_id)
if account_id not in ids:
    st.error(f"Account {account_id} is not in the data. Try 20111, or press Random account.",
             icon=":material/search_off:")
    st.stop()

target = float(shock.income_months or plan.TARGET_RUNWAY)


@st.fragment(run_every=2 if follow else None)
def customer_view(account_id: int, shock: engine.Shock) -> None:
    p, monthly, source = ui.get_profile(account_id)
    base, shocked = engine.runway(p), engine.runway(p, shock)
    f = plan.facts(account_id)

    with st.container(horizontal=True, vertical_alignment="center"):
        if source == tiger_client.LIVE:
            st.badge("Tiger Data live", icon=":material/cloud_done:", color="green")
        else:
            st.badge("Offline cache", icon=":material/cloud_off:", color="gray")
        st.caption(f"{f['district_name']}, {f['region']} · {p.months_of_data} months of data, through "
                   f"{monthly['month'].max():%b %Y}"
                   + (" · loan running" if p.loan_running else "") + (" · loan defaulted" if p.defaulted else ""))

    # ------------------------------------------------------------------ position today
    with st.container(horizontal=True):
        st.metric("Income (I)", ui.money(p.I), help="Median monthly money in", border=True)
        st.metric("Spending (S)", ui.money(p.S), help="Median monthly money out", border=True)
        st.metric("Fixed costs (F)", ui.money(p.F), help="Median of bills + insurance + loan payments", border=True)
        st.metric("Buffer (B)", ui.money(p.B), help="Mean average daily balance, last 6 months", border=True)
        st.metric("Runway today", ui.months_label(base), help="Judges' formula with no shock", border=True)

    left, right = st.columns([3, 2])
    with left:
        st.plotly_chart(ui.monthly_chart(monthly), alt="Monthly money in and out with the balance line")
    with right:
        st.plotly_chart(ui.spending_chart(monthly), alt="Average monthly spending by category")

    left, right = st.columns(2)
    with left:
        with st.container(border=True):
            st.markdown("**Risk flags**")
            for flag in plan.risk_flags(p):
                icon = {"high": ":material/error:", "medium": ":material/warning:", "ok": ":material/check_circle:"}
                color = {"high": "red", "medium": "orange", "ok": "green"}[flag.level]
                st.markdown(f":{color}[{icon[flag.level]}] {flag.text}")
    with right:
        with st.container(border=True):
            pr = plan.peers(account_id)
            st.markdown("**Compared with similar customers**")
            st.markdown(f"Their buffer covers **{pr['buffer_months']:.1f} months** of spending. That's more than "
                        f"**{pr['pct_better']:.0%}** of the {pr['n_peers']} customers in {pr['region']} with "
                        f"similar income (band {pr['income_band']} of 5), where the median is "
                        f"{pr['peer_median_buffer_months']:.1f} months.")

    # ------------------------------------------------------------------ the shock
    st.header("Take the shock", anchor=False)
    if shock == engine.Shock():
        st.info("Pick a twist card, a preset or the sliders in the sidebar to see what a shock does.",
                icon=":material/arrow_back:")
        return
    st.caption(f"Shock: {ui.describe_shock(shock)}")

    sim = ui.survival(p, shock, target)
    bp = engine.breaking_point(p, shock, target)
    change = shocked.months - base.months
    delta = None if base.no_shortfall or shocked.no_shortfall or change == 0 else f"{change:+.1f} months"
    with st.container(horizontal=True):
        st.metric("Runway after the shock", ui.months_label(shocked), delta=delta, delta_color="normal",
                  help="The judges' formula: (B - one-off) / (spending - income), capped at 120", border=True)
        if shock.income_months:
            ok = shocked.no_shortfall or shocked.months >= shock.income_months
            st.metric(f"Lasts the {shock.income_months} months of EI?", "Yes" if ok else "No", border=True,
                      help="Runway compared with the EI length")
        st.metric(f"Chance of making {target:g} months", f"{sim['survival']:.0%}", border=True,
                  help=f"{sim['n_paths']:,} simulated futures with income and spending noise, job loss, "
                       f"repairs and bill inflation. Computed in {sim['seconds'] * 1000:.0f} ms ({sim['backend']}).")
        if bp.income_factor is not None and not bp.already_broken:
            st.metric("Breaks if income falls below", f"{max(bp.income_factor, 0):.0%}", border=True,
                      help=f"Income factor that brings runway down to {target:g} months, holding the rest of the shock")
        else:
            st.metric("Breaks if income falls below", "Already below target" if bp.already_broken else "n/a",
                      border=True)

    st.info(plan.summary(p, shock, sim["survival"], target), title="Advisor summary", icon=":material/support_agent:")

    left, right = st.columns(2)
    with left:
        st.plotly_chart(ui.burn_down_chart(plan.burn_down(p, shock, 24), sim["fan"]),
                        alt="Balance after the shock: judges' line and simulated range")
    with right:
        st.plotly_chart(ui.waterfall_chart(plan.waterfall(p, shock)), alt="Waterfall of runway changes")

    with st.container(border=True):
        st.markdown(f"**Breaking point** · what keeps them at {target:g} months")
        parts = []
        if bp.already_broken:
            parts.append(f"Already short of {target:g} months under this shock.")
        if bp.income_factor is not None and bp.income_factor > 0 and not bp.already_broken:
            parts.append(f"income doesn't fall below **{bp.income_factor:.0%}** of normal")
        if bp.one_off > 0:
            parts.append(f"a one-off cost stays under **{ui.money(bp.one_off)}**")
        if bp.bills_pct is not None and bp.bills_pct > 0:
            parts.append(f"bills rise less than **{bp.bills_pct:.0%}**")
        if not bp.already_broken:
            st.markdown("They stay above target as long as " + ", or ".join(parts) + "." if parts else
                        "No single lever breaks them.")
        else:
            st.markdown(parts[0])
        st.caption("Each limit moves one lever and holds the rest of the shock as it is.")

    # ------------------------------------------------------------------ plans
    st.header("Make a plan", anchor=False)
    left, right = st.columns(2)
    goal = plan.goal_plan(p)
    with left:
        with st.container(border=True, height="stretch"):
            st.markdown("**Goal: an emergency fund**")
            st.markdown(f"Target **{ui.money(goal.target)}** ({goal.reason}). They have {ui.money(p.B)}.")
            if goal.months_to_target == 0:
                st.success("Already there.", icon=":material/check_circle:")
            elif goal.months_to_target is not None:
                st.markdown(f"Saving their usual surplus of {ui.money(p.surplus)} a month gets there in "
                            f"**{goal.months_to_target:.1f} months**.")
            else:
                pct = f" ({goal.cut_pct_of_flexible:.0%} of flexible spending)" if goal.cut_pct_of_flexible else ""
                st.markdown(f"They don't have a surplus today. Cutting **{ui.money(goal.monthly_cut_needed)} a month**"
                            f"{pct} reaches it in 12 months.")
    backup = plan.backup_plan(p, shock)
    with right:
        with st.container(border=True, height="stretch"):
            st.markdown("**Backup plan: if this shock hits**")
            if backup.already_ok:
                st.success(f"No cuts needed: runway is already at least {backup.target_months:g} months.",
                           icon=":material/check_circle:")
            elif backup.possible:
                st.markdown(f"Cut flexible spending (card, cash, other transfers) by **{backup.cut_pct:.0%}**, "
                            f"about **{ui.money(backup.cut_amount)} a month** of {ui.money(backup.flexible)}. "
                            f"Runway becomes **{backup.new_runway:.1f} months**. Bills, insurance and loans stay as they are.")
            else:
                st.warning("Cutting flexible spending alone can't reach 6 months. Talk about a payment plan, "
                           "deferring the loan, or a top-up to their emergency fund.", icon=":material/warning:")


customer_view(account_id, shock)

# ------------------------------------------------------------------ bank-wide strip (D3)
st.divider()
bank, secs = ui.bank_run(ui.shock_key(shock), target)
under3 = float((bank["runway"] < 3).mean())
with st.container(horizontal=True, vertical_alignment="center"):
    st.metric("Whole bank: customers under 3 months", f"{under3:.0%}",
              delta=f"{under3 - float((bank['runway_base'] < 3).mean()):+.0%} vs no shock", delta_color="inverse",
              border=True)
    st.metric(f"Expected to run out within {target:g} months", f"{1 - bank['survival'].mean():.0%}", border=True,
              help="Average over all customers of the simulated chance of running out")
    st.caption(f"4,500 customers x {ui.simulate.BANK_PATHS:,} futures x {ui.simulate.BANK_MONTHS} months "
               f"in {secs:.2f} s ({ui.simulate.BACKEND})")
    st.page_link("app_pages/bank.py", label="Open the whole-bank view", icon=":material/arrow_forward:")

with st.expander("How each number is defined"):
    st.markdown("""
- **I** = median monthly money in · **S** = median monthly money out
- **F** = median of (household bills + insurance + loan payments), summed per month first
- **H** = median household bills · **B** = mean of the average daily balance over the last 6 months
- **P** = monthly loan payment if the loan is still running in Dec 2025, else 0
- **Runway** = (B − one-off) / (spending − income), where income = income factor × I and spending = S + bills % × H + other increase.
  0 if the buffer is used up; "120+" if there's no shortfall or it's over 120 months; rounded to 0.1.
- **Chance of making it** comes from the Monte Carlo simulation (C++ core). With every random part switched off it gives
  exactly the judges' runway; it never replaces it.
""")
