"""Build discovery.ipynb from the functions in discovery.py (so the notebook and the app never disagree).

    python tools/make_notebook.py && jupyter nbconvert --to notebook --execute --inplace discovery.ipynb
"""

from pathlib import Path

import nbformat as nbf

ROOT = Path(__file__).resolve().parents[1]

cells = [
    ("md", "# Discovery: Resilience Rewired\n\nEvery table here comes from `discovery.py`, which is built on "
           "`engine.py` (the judges' definitions). Run top to bottom; it takes about a minute."),
    ("code", "import sys, pathlib\nsys.path.insert(0, str(pathlib.Path.cwd()))\n"
             "import pandas as pd, plotly.express as px\nimport discovery, engine\n"
             "pd.set_option('display.float_format', '{:.3f}'.format)\n"
             "discovery.refresh_all()"),
    ("md", "## 1. The main finding: the twist is the early warning\n\nEach month, for every loan customer, we "
           "compute the runway the engine would have shown using only data up to that month. A customer is flagged "
           "when their runway under the EI twist (55% income) drops below 2 months."),
    ("code", "print(discovery.main_finding()['headline'])\ndiscovery.early_warning_summary()"),
    ("md", "## 2. Proof against real defaults (D5)\n\nDefault rate of the 682 loans by today's runway. "
           "This view is concurrent (today's buffer), so section 1 is the fair, forward-looking test."),
    ("code", "db = discovery.default_by_band()\npx.bar(db, x='band', y='default_rate', text='defaults', "
             "title='Default rate by runway band').show()\ndb"),
    ("md", "## 3. Each twist across all 4,500 customers"),
    ("code", "discovery.twist_impact()"),
    ("md", "## 4. Who is most fragile?\n\nShare of customers who can't last 6 months on EI, by group."),
    ("code", "fg = discovery.fragile_groups()\npx.bar(fg, x='group', y='share_fail_6m_ei', color='dimension', "
             "title='Share failing 6 months on EI').show()\nfg"),
    ("md", "## 5. Tipping point\n\nJudges' formula across the bank as bills rise, with and without EI; then the "
           "C++ Monte Carlo sweep of the chance of lasting 6 months."),
    ("code", "tp = discovery.tipping_point()\npx.line(tp, x='bills_pct', y='under_3', color='income', "
             "title='Share under 3 months as bills rise').show()\ndiscovery.survival_sweep()"),
    ("md", "## 6. Region\n\nDoes local unemployment or salary explain fragility?"),
    ("code", "r = discovery.regional()\nprint('corr with unemployment', round(r.share_fail.corr(r.unemployment), 3), "
             "'| corr with salary', round(r.share_fail.corr(r.salary), 3))\n"
             "px.scatter(r, x='unemployment', y='share_fail', size='customers', hover_name='district_name', "
             "title='Districts: unemployment vs share failing 6 months on EI').show()"),
    ("md", "## 7. Canadian realism (D8): the EI weekly maximum"),
    ("code", "e = discovery.ei_cap_effect()\nprint(f\"Earn above the cap: {e.hit_by_cap.mean():.1%}\")\n"
             "print(f\"Fall below 6 months only because of the cap: {((e.runway_judges >= 6) & (e.runway_capped < 6)).mean():.1%}\")"),
    ("md", "## 8. Is the simulation calibrated?\n\nProfiles from data up to June 2025, simulated to December, "
           "compared with real month-end balances."),
    ("code", "discovery.backtest()"),
    ("md", "## 9. Time machine for one defaulted customer"),
    ("code", "ew = discovery.early_warning()\nacc = int(ew[(ew.defaulted == 1) & ew.lead_months.notna()].iloc[0].account_id)\n"
             "tm = discovery.time_machine(acc)\npx.line(tm, x='month', y=['runway_base_lt3', 'runway_stress_ei_lt2'], "
             "title=f'Account {acc}: runway the engine would have shown').update_yaxes(range=[0, 24]).show()"),
]

nb = nbf.v4.new_notebook()
nb.cells = [nbf.v4.new_markdown_cell(src) if kind == "md" else nbf.v4.new_code_cell(src) for kind, src in cells]
nb.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
nbf.write(nb, ROOT / "discovery.ipynb")
print("wrote discovery.ipynb")
