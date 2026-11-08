"""Toonie (Streamlit rehearsal fallback): how long can a customer last, and how likely are they to make it?

    streamlit run app.py
"""

import streamlit as st

import ui

st.set_page_config(page_title="Toonie", page_icon=":material/savings:", layout="wide")
ui.init_state()
ui.warm_up()

pages = [
    st.Page("app_pages/customer.py", title="Customer", icon=":material/person:", default=True),
    st.Page("app_pages/bank.py", title="Whole bank", icon=":material/account_balance:"),
    st.Page("app_pages/finding.py", title="Main finding", icon=":material/insights:"),
    st.Page("app_pages/time_machine.py", title="Time machine", icon=":material/history:"),
    st.Page("app_pages/method.py", title="How it works", icon=":material/menu_book:"),
]
nav = st.navigation(pages)
st.session_state.shock = ui.shock_sidebar()
nav.run()
