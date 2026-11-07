# Frontend Implementation Guide

Resilience Rewired · Tangerine track · Sheridan Datathon 2026

This document is split by role. Each section is self-contained: read **§0** and **§1**, then only the section for your role. File paths are relative to the repo root.

| § | Section | Read this if you are… |
|---|---------|------------------------|
| 0 | [Decision: React instead of Streamlit](#0-decision-react-instead-of-streamlit) | Anyone |
| 1 | [Overview and how to run](#1-overview-and-how-to-run) | Anyone |
| 2 | [Shared definitions](#2-shared-definitions) | Anyone touching numbers |
| 3 | [API contract](#3-api-contract-backend--fastapi-agent) | **Backend / FastAPI** (role A or B) |
| 4 | [Simulation outputs the UI needs](#4-simulation-outputs-the-ui-needs-hpc-agent) | **HPC / C++ / NumPy** (role D) |
| 5 | [Discovery outputs the UI needs](#5-discovery-outputs-the-ui-needs-discovery-agent) | **Discovery / notebook** (role C) |
| 6 | [Frontend architecture](#6-frontend-architecture-frontend-agents) | **Frontend** (role B) |
| 7 | [Mock layer](#7-mock-layer-frontend-agents) | Frontend, or anyone changing mock data |
| 8 | [Design system](#8-design-system-frontend-agents) | Frontend / UI polish |
| 9 | [Advisor Console panels](#9-advisor-console-panels) | Frontend |
| 10 | [Bank tab](#10-bank-tab-d3) | Frontend |
| 11 | [Discovery tab](#11-discovery-tab) | Frontend |
| 12 | [Demo and rehearsal](#12-demo-and-rehearsal-everyone) | Everyone (Phase 5) |
| 13 | [Assumptions and open questions](#13-assumptions-and-open-questions) | Anyone making a decision |
| 14 | [Status and next steps](#14-status-and-next-steps) | Whoever picks up the work |

---

## 0. Decision: React instead of Streamlit

The roadmap planned a Streamlit app. We built a React + Vite + TypeScript app that talks to a thin FastAPI layer.

| What matters for us | Streamlit | React + FastAPI | Winner |
|---|---|---|---|
| Time to first screen | Minutes, Python only | Hours, plus an API layer | Streamlit |
| Imports `engine.py` directly | Yes | Through FastAPI (≈150 lines of routes) | Streamlit |
| Slider latency | Every move reruns the whole script; debouncing and cancelling stale runs is awkward | 250 ms debounce, stale results dropped, previous result stays on screen | React |
| Animated fan chart and histogram (D2, D3) | Plotly figures are redrawn, not tweened | ECharts tweens from old values to new | React |
| Looks like a Tangerine product (Communication 25%) | Recognisable Streamlit look, limited theming | Full control of brand, layout and type | React |
| One screen for the live twist at 1440×900 | Hard to control density | Fixed 3-column console | React |
| Presenter tools (twist reader preview, keyboard shortcuts) | Limited | Easy | React |
| Frontend work can start before the engine exists | No | Yes, against in-browser mocks | React |
| Risk if the backend fails on stage | App is down | Same, but the mock mode is a full rehearsal fallback | React |

**Result:** React wins on everything the judges see (the live twist, the animations, the polish). Streamlit wins only on build speed, and that cost is already paid: the frontend is built, and the FastAPI layer is a thin wrapper around functions the roadmap already plans. The roadmap's rule still holds: the judges' formula in `engine.py` is the truth, and the frontend only displays it.

---

## 1. Overview and how to run

```
frontend/
  src/api/schemas.ts      ← THE contract (Zod). Every response is validated against it.
  src/api/client.ts       ← one typed function per route; mock or live transport
  src/api/hooks.ts        ← TanStack Query hooks used by the panels
  src/mock/*              ← in-browser mock of engine.py, sim_numpy.py and the API
  src/features/advisor/*  ← Advisor Console (default tab)
  src/features/bank/*     ← Bank tab (D3)
  src/features/discovery/*← Discovery tab (D5, D6, D8, tipping point, benchmark)
  src/lib/*               ← formatters, twist reader, advisor summary, shock helpers
  src/styles/*            ← design tokens (Tangerine palette)
```

**Run** (Node 20+; tested on Node 24):

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, mock data by default
```

**Switch to the real engine:** create `frontend/.env.local`:

```
VITE_DATA_SOURCE=live
VITE_API_PROXY_TARGET=http://127.0.0.1:8000
```

The Vite dev server forwards `/api/*` to FastAPI, so CORS doesn't matter during the demo. `npm run build` type-checks (strict) and builds to `frontend/dist/`; `npm run preview` serves the build with the same proxy.

| Env var | Values | Effect |
|---|---|---|
| `VITE_DATA_SOURCE` | `mock` (default), `live` | Mock runs everything in two Web Workers, with no network. Live calls FastAPI |
| `VITE_API_PROXY_TARGET` | URL | Where `/api` is forwarded in live mode |
| `VITE_MOCK_ENGINE` | `js` (default), `cpp`, `numpy` | Which engine the mock *reports*. Use `numpy` to rehearse the fallback badge |
| `VITE_DISABLED_FEATURES` | comma list of `time-machine, region-map, peers, twist-reader, bank` | Hides panels whose backend isn't ready (follows the roadmap's cut order) |

---

## 2. Shared definitions

These are the roadmap's definitions (`docs/ROADMAP.md` §3), repeated so this section stands alone. `engine.py` is the source of truth. The frontend mock (`frontend/src/mock/engine.ts`) mirrors it.

```
I = median(money_in)            S = median(money_out)
F = median(household_bills + insurance + loan_payments)   (sum each row, then median)
H = median(household_bills)
B = mean(avg_daily_balance) over the last 6 rows sorted by month (all rows if fewer than 6)
P = loans.monthly_payment if the loan is still running at 2025-12, else 0
surplus = I − S

one_off_total = one_off + one_off_x_s × S             ← see §3.2, needed for bank-wide "× S" shocks
buffer_left   = B − one_off_total
income        = income_factor × I    (if ei_cap_on and income_factor < 1: min(that, 729 × 52 / 12))
spending      = S + bills_pct × H + spend_delta
gap           = spending − income
runway: buffer_left ≤ 0 → 0;  gap ≤ 0 → "no shortfall (120+)";  else round(min(buffer_left / gap, 120), 1)
```

- **Rounding:** Python's `round()` (half to even). The mock copies this.
- **Breaking point for target T** (T = `income_months` if > 0, else 6):
  - `f* = (spending − buffer_left / T) / I`
  - `X* = B − T × gap`. If gap ≤ 0, the limit is B itself.
  - `b* = (buffer_left / T + income − S − spend_delta) / H`
- **Verdict** (only when `income_months > 0`): `makes_it` if the runway ≥ `income_months` or there's no shortfall, else `falls_short`.
- **Under 3 months:** runway status `zero`, or `finite` with months < 3. A runway of exactly 3.0 isn't under 3.

---

## 3. API contract (Backend / FastAPI agent)

**You build:** `api.py` (FastAPI) that wraps `engine.py`, `sim_numpy.py`, `resil_hpc` and the discovery outputs. **You don't need to read the frontend code.** The machine-readable contract is `frontend/src/api/schemas.ts` (Zod). If it and this section ever disagree, `schemas.ts` wins, because the UI validates every response against it.

### 3.1 Conventions

- JSON in and out, `snake_case`. Base path `/api`. No auth.
- **Units:** money is CAD per month unless the name says otherwise. Durations are months. `share_*`, `*_prob`, `*_rate`, `*_pct`, `*_factor` and `better_than` are **fractions 0–1**, not percentages. `compute_ms` is milliseconds. Months are `"YYYY-MM"` strings.
- **Runway object** (used everywhere a runway appears). The no-shortfall case is never encoded as the number 120:

  ```json
  {"status": "zero",         "months": 0}
  {"status": "finite",       "months": 4.2}    // 0 ≤ months < 120, already rounded to 1 dp
  {"status": "capped",       "months": 120}    // min(buffer_left / gap, 120) hit the cap
  {"status": "no_shortfall", "months": null}   // buffer_left > 0 and gap ≤ 0
  ```

- **Limit object** (breaking point): `{"status": "ok" | "always_safe" | "already_short" | "not_applicable", "value": number | null}`.
  - `not_applicable`: the formula divides by zero (I = 0 for f*, H = 0 for b*).
  - `always_safe`: f* ≤ 0, so they last T months even with no income.
  - `already_short`: they fall short of T with no extra shock (f* > 1, X* ≤ 0, b* < 0, or buffer_left ≤ 0).
- **Errors:** every non-2xx returns

  ```json
  {"error": {"code": "not_found" | "validation_error" | "internal", "message": "…", "field": "shock.income_factor"}}
  ```

  - **404** for an unknown `account_id` (`field: "account_id"`).
  - **422** for an out-of-range or missing request field. `field` is the dotted path. FastAPI's default 422 body is different, so override it (see §3.4).
  - **500** for `internal`.
- **Timeout:** the UI gives up after 5 s and shows an inline error in that panel only.

### 3.2 Shock (request input)

| Field | Type | Range | Meaning |
|---|---|---|---|
| `income_factor` | float | 0–1 | 1 = no change, 0.55 = EI |
| `income_months` | int | 0–24 | EI length. Used for the verdict, T and the simulation. **Not** used in the runway |
| `bills_pct` | float | 0–1 | Adds `bills_pct × H` to spending |
| `spend_delta` | float | 0–20,000 | Extra CAD per month (rent, etc.) |
| `one_off` | float | 0–1,000,000 | One-off cost in CAD |
| `one_off_x_s` | float | 0–24 | One-off as a multiple of **each account's** S. "A full month of spending" = 1. The total one-off is `one_off + one_off_x_s × S` |
| `ei_cap_on` | bool | | Also cap EI income at the weekly maximum ($729/week in 2026, i.e. $3,159/month) |

`one_off_x_s` is the only addition to the roadmap's shock. Without it, preset card 2 ("one-off = 1 × S") can't be applied bank-wide, because S is different for every customer. The UI sends either `one_off` or `one_off_x_s`, never both.

### 3.3 Routes

| # | Method & path | Wraps (Python) | Request | Response schema (`schemas.ts`) |
|---|---|---|---|---|
| 1 | `GET /api/health` | `resil_hpc` import check | — | `HealthSchema` |
| 2 | `GET /api/accounts/random` | `random.choice(profiles.index)` | — | `{account_id}` |
| 3 | `GET /api/accounts/{account_id}` | `engine.profile`, risk factors, history, peers | — | `AccountResponseSchema` |
| 4 | `POST /api/scenario` | `engine.runway`, `engine.breaking_point`, plans | `ScenarioRequestSchema` | `ScenarioResponseSchema` |
| 5 | `POST /api/simulate/account` | `resil_hpc.simulate_one` (or `sim_numpy`) | `SimAccountRequestSchema` | `SimAccountResponseSchema` |
| 6 | `POST /api/simulate/bank` | `resil_hpc.simulate_bank` + `engine.runway` for all | `SimBankRequestSchema` | `SimBankResponseSchema` |
| 7 | `GET /api/discovery/finding` | `discovery.ipynb` output | — | `FindingSchema` |
| 8 | `GET /api/discovery/defaults` | D5 table | — | `DefaultsSchema` |
| 9 | `GET /api/discovery/tipping` | `resil_hpc.sweep` (or `engine.runway` grid) | — | `TippingSchema` |
| 10 | `GET /api/discovery/ei-cap` | D8 comparison | — | `EiCapSchema` |
| 11 | `GET /api/discovery/benchmark` | `bench.py` saved JSON | — | `BenchmarkSchema` |
| 12 | `GET /api/time-machine` | D6 list of defaulted accounts | — | `TimeMachineListSchema` |
| 13 | `GET /api/time-machine/{account_id}` | D6 replay | — | `TimeMachineReplaySchema` |

Routes 7–13 return fixed results, so compute them once at startup and cache them. Routes 4–6 run on every slider move (debounced to 250 ms). Route 4 must be pure `engine.py`, and the UI's "do they make it?" depends on it.

#### 1. `GET /api/health`
```json
{"status":"ok","engine":"cpp","threads":10,"accounts":4500,"data_first_month":"2024-01","data_last_month":"2025-12","version":"0.1.0"}
```
`engine` is `"cpp"` if `resil_hpc` imported, else `"numpy"` (`"js"` is only used by the mock). The header badge shows **C++ core · N threads**, **NumPy mode** (amber) or **Engine offline** (red, if this call fails).

#### 3. `GET /api/accounts/{account_id}` → `AccountResponse`
```
profile: { account_id, district_id, district_name, region, income_quintile (1–5, across all accounts by I),
           I, S, F, H, B, P, surplus, runway_base: Runway (no shock),
           months_of_data, limited_history (months_of_data < 6), days_below_zero_6m,
           ever_below_zero (any month with days_below_zero > 0), has_loan, defaulted }
risk:    { sd_in, sd_out, flex_share (0–1), flex_monthly (median of card + cash + other transfers out),
           p_jobloss_month, bills_growth_annual, repair_rate, repair_size_min_x_s, repair_size_max_x_s, ei_weekly_max }
history: [ { month, money_in, money_out, avg_daily_balance, days_below_zero } ]   // ≤ 24 rows, ascending
breakdown: { household_bills, insurance, loan_payments, card_withdrawals, cash_withdrawals, other_transfers_out }  // medians
peers:   { group_size, better_than (0–1 or null if no peers), peer_median_runway: Runway | null }
```
- **Peers** are the other accounts in the same `district_id` **and** the same `income_quintile`, not counting this account. `better_than` = the share of peers whose `runway_base` ranks strictly lower. For ranking, zero = 0, finite = months, capped = 120, no_shortfall = 121.
- `flex_monthly` uses "genuine" cash withdrawals as the roadmap defines them. It drives the backup plan.

#### 4. `POST /api/scenario`
Request: `{"account_id": 1787, "shock": {…Shock}, "target_months": 6}`. The UI sends `target_months` = `income_months` if > 0, else 6.

Response:
```
account_id, shock (echo), target_months,
components: { buffer_left, income, spending, gap, ei_capped }      // the numbers inside the formula
runway_base: Runway, runway_shocked: Runway,
verdict: "makes_it" | "falls_short" | null                          // null when income_months = 0
breaking_point: { target_months, income_factor: Limit, one_off: Limit, bills_pct: Limit }
waterfall: [ {key:"base",runway}, {key:"income",runway}, {key:"bills",runway}, {key:"other",runway}, {key:"one_off",runway} ]
burn_down: { balance: number[25] (month 0..24 = buffer_left − gap × t), zero_month: number | null }
goal_plan: { target, multiple (3|6), current_buffer, shortfall, status: "reached"|"on_track"|"needs_cut",
             months_to_target (round 1dp) | null, monthly_cut_needed | null, cut_horizon_months (12) }
backup_plan: { flexible_monthly, target_months (6), status: "not_needed"|"cut_works"|"not_enough"|"buffer_gone"|"no_flexible",
               cut_pct (0–1, rounded UP to whole %) | null, monthly_saving | null, runway_after: Runway }
```
Rules (the reference implementation is `frontend/src/mock/engine.ts`. Copy the logic into `engine.py`):
- **Waterfall:** apply the shock cumulatively in this order: income (`income_factor`, `income_months`, `ei_cap_on`) → bills (`bills_pct`) → other (`spend_delta`) → one-off (`one_off`, `one_off_x_s`). Return the runway after each step. Step 0 is the base, and the last step equals `runway_shocked`.
- **Burn-down** `zero_month` = `buffer_left / gap` if that's ≤ 24 (0 if buffer_left ≤ 0), else null.
- **Goal plan:** target = 3 × S, or 6 × S if `days_below_zero_6m > 0` or `ever_below_zero`. Shortfall = max(target − B, 0). `on_track` if surplus > 0: months = shortfall / surplus. Otherwise `needs_cut`: `monthly_cut_needed = shortfall / 12 − surplus`. It always uses today's I and S, not the shock.
- **Backup plan:** under the shock, the cut fraction c of `flexible_monthly` needed to reach 6 months: `c = (gap − buffer_left / 6) / flexible_monthly`.
  - `buffer_gone` if buffer_left ≤ 0.
  - `not_needed` if they already last 6.
  - `no_flexible` if flexible is 0.
  - `not_enough` if c > 1. Report `runway_after` at a 100% cut.
  - Otherwise `cut_works` with `cut_pct = ceil(c × 100) / 100` and `runway_after` at that cut.

#### 5. `POST /api/simulate/account`
Request: `{account_id, shock, n_paths: 10000, months: 24, seed: 42, target_months}`.
Response: `{account_id, engine, compute_ms, n_paths, months, seed, target_months, survival_prob, first_negative: {p10,p50,p90}, fan: {p10[], p50[], p90[]}}`.
- `fan.*` have `months + 1` points (month 0 = balance after the one-off).
- `first_negative.*` is the fractional month the balance first goes ≤ 0, as percentiles across paths. Use null when that percentile never goes negative within the horizon.
- `compute_ms` is the simulation time only (not JSON encoding). It's shown on screen, so measure it honestly.
- **`n_paths` in the response is the number of paths actually run.**

#### 6. `POST /api/simulate/bank`
Request: `{shock, n_paths: 2000, months: 24, seed: 42, target_months}`.
Response:
```
engine, compute_ms, n_paths, months, seed, target_months, n_accounts,
share_under_3, count_under_3, base_share_under_3,        // judges' runway, shocked vs no shock
mean_survival_prob, share_survival_below_50,             // simulation
histogram: [ {label, lo, hi, count, under_3} ],          // judges' runway under the shock, bins below
regions:   [ {region, income_quintile, accounts, share_under_3} ]   // every region × quintile 1–5
```
Histogram bins, in this order and with these labels: `"0"` (status zero), `"0–1"`, `"1–2"`, `"2–3"` (all `under_3: true`), then `"3–4"`, `"4–5"`, `"5–6"`, `"6–9"`, `"9–12"`, `"12–24"`, `"24–120"`, `"120+"` (capped + no_shortfall). Bins include `lo` and exclude `hi`. Seed each account with `mix(seed, account_id)` so a customer's bank-wide result matches its single-account run.

### 3.4 FastAPI skeleton

```python
# api.py — run: uvicorn api:app --port 8000
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import time, engine
try:
    import resil_hpc as sim; ENGINE = "cpp"
except ImportError:
    import sim_numpy as sim; ENGINE = "numpy"

app = FastAPI()

class Shock(BaseModel):
    income_factor: float = Field(ge=0, le=1)
    income_months: int = Field(ge=0, le=24)
    bills_pct: float = Field(ge=0, le=1)
    spend_delta: float = Field(ge=0, le=20000)
    one_off: float = Field(ge=0, le=1_000_000)
    one_off_x_s: float = Field(ge=0, le=24)
    ei_cap_on: bool

class ScenarioReq(BaseModel):
    account_id: int
    shock: Shock
    target_months: int = Field(ge=1, le=24)

@app.exception_handler(RequestValidationError)
async def _422(_: Request, exc: RequestValidationError):
    e = exc.errors()[0]
    field = ".".join(str(p) for p in e["loc"] if p != "body")
    return JSONResponse(status_code=422, content={"error": {"code": "validation_error", "message": f"{field}: {e['msg']}", "field": field}})

@app.exception_handler(HTTPException)
async def _http(_: Request, exc: HTTPException):
    code = "not_found" if exc.status_code == 404 else "internal"
    err = {"code": code, "message": str(exc.detail)}
    if code == "not_found":
        err["field"] = "account_id"          # `field` is optional: omit it, never send null
    return JSONResponse(status_code=exc.status_code, content={"error": err})

PROFILES = engine.profiles_all()          # load once at startup (replaces st.cache_resource)

@app.post("/api/scenario")
def scenario(req: ScenarioReq):
    if req.account_id not in PROFILES.index:
        raise HTTPException(404, f"No account with ID {req.account_id}")
    return engine.scenario(PROFILES.loc[req.account_id], req.shock.model_dump(), req.target_months)  # returns the dict in §3.3 #4
```

Return the response models with `response_model_exclude_none=False`: nullable fields such as `verdict` or `months` must be present as `null`, not omitted. The only optional field in the contract is `error.field`.

### 3.5 Check your server against the UI

1. Run FastAPI on :8000, then `VITE_DATA_SOURCE=live npm run dev` in `frontend/`.
2. Any schema mismatch shows inside the affected panel as *"The engine returned data in an unexpected shape (field.path)"*, and the browser console names the route and the field.
3. Compare against the mock: the mock gives the expected output for any request.

---

## 4. Simulation outputs the UI needs (HPC agent)

**You build:** `sim_numpy.py` and `hpc/` (`resil_hpc`), as in the roadmap. This section covers only what the UI depends on.

- **Shape:** `simulate_one` must give everything in route 5 (`survival_prob`, `first_negative` p10/p50/p90, `fan` p10/p50/p90 over months 0..24). `simulate_bank` must give each account's survival probability for T months. The FastAPI layer aggregates it into route 6.
- **One-off:** start each path at `B − (one_off + one_off_x_s × S)`.
- **Survival target T** comes in the request (`target_months`). Simulate `max(months, T)` months internally.
- **EI after it ends:** the roadmap says income is 0 after EI ends. The mock does that for the *shocked* EI (`income_factor < 1`). For *random* job loss, the mock pays EI for 6 months and then goes back to work. Pick a rule and record it in the write-up. The UI doesn't depend on it.
- **Noise-off check:** with sd = 0, no random job loss, no repairs and no bill growth, the median first-negative month must be within 0.1 of the judges' runway. The mock passes this (see §7.4). This only holds when `income_months = 0` or ≥ the runway, because the judges' formula ignores EI length.
- **Determinism:** the same request and seed must give identical numbers. The UI caches by request.
- **Report honestly:** `engine` (`cpp`/`numpy`), `compute_ms` and the real `n_paths`. The UI prints "4,500 customers × 2,000 futures in 0.4 s" from these.
- **Speed budget:** single account under 50 ms, bank under 1 s. Both run on each debounced slider change.
- **Benchmark:** `bench.py` should write `results/bench.json` in `BenchmarkSchema` form:
  ```json
  {"measured": true, "machine": "MacBook Pro M1 Pro, 10 cores", "threads": 10,
   "workload": {"accounts": 4500, "paths": 2000, "months": 24},
   "rows": [{"engine":"python","label":"Python loop","seconds":184.0,"speedup":1},
            {"engine":"numpy","label":"NumPy","seconds":4.6,"speedup":40},
            {"engine":"cpp_1","label":"C++ · 1 thread","seconds":1.9,"speedup":97},
            {"engine":"cpp_all","label":"C++ · all threads","seconds":0.24,"speedup":767}]}
  ```
  `speedup` = Python seconds ÷ row seconds. Until `measured` is true, the UI labels the chart **Placeholder**.

---

## 5. Discovery outputs the UI needs (Discovery agent)

**You build:** `discovery.ipynb`. Save each result as JSON in the shape below (for example under `results/`), and the FastAPI routes 7–13 simply return the files.

| Route | Schema | What to put in it |
|---|---|---|
| `/api/discovery/finding` | `FindingSchema` | `headline` (one line a judge remembers), `sentence` (2–3 sentences with the numbers), `chart` (one bar chart: `categories[]`, `values[]`, `y_format` = `percent`/`months`/`number`, `highlight_index` for the orange bar), `method` (one line). **This is the top of the Discovery tab. Pick the single strongest finding** |
| `/api/discovery/defaults` (D5) | `DefaultsSchema` | `bands[]` of runway bands with `loans`, `defaults`, `default_rate`; `bottom_band_rate`, `top_band_rate`, `ratio` (bottom ÷ top, null if top is 0), `overall_rate`, totals. The mock bands the runway under EI 55% (the stress runway), because most base runways are "no shortfall". Use whichever runway you can defend |
| `/api/discovery/tipping` | `TippingSchema` | `axis` (`key`, `label`, `values[]`, e.g. `income_factor` 1.0→0.4), `series[]` (`label`, `share_under_3[]`, one value per axis point), `headline_series`, `tipping_index` (the largest jump), `sentence`, `engine`, `compute_ms`. From the C++ sweep |
| `/api/discovery/ei-cap` (D8) | `EiCapSchema` | Judges' EI (55% × I) vs capped EI: `accounts_affected`, `avg_runway_lost` (among those affected; count no-shortfall as 120), `under_3_judges` → `under_3_capped`, `by_quintile[]` medians, `source_url` |
| `/api/time-machine` (D6) | `TimeMachineListSchema` | Every defaulted account with `default_month` and `lead_months` (null if never flagged before default). Sort by lead time, best first. The first one is shown by default |
| `/api/time-machine/{id}` | `TimeMachineReplaySchema` | `months[]`: for each month, the runway computed **only from rows up to that month**, plus `B`, `I`, `S` and `flagged`. Also `first_flag_month`, `lead_months` and `flag_threshold_months`. The mock flags when the runway under EI 55% is under 3 months, with at least 6 months of history |

Use the same sources the roadmap lists (`SOURCES.md`). EI maximum: **$729/week in 2026** ([canada.ca](https://www.canada.ca/en/services/benefits/ei/ei-regular-benefit/benefit-amount.html)).

---

## 6. Frontend architecture (Frontend agents)

**Stack:** React 19, TypeScript strict (`noUncheckedIndexedAccess` on), Vite 6, TanStack Query 5, Zod 4, ECharts 6 (tree-shaken, SVG renderer), CSS Modules with design tokens, Inter (bundled, so it works offline).

**Data flow:**

```
ScenarioProvider (src/state/scenario.tsx)
  accountId, draft (slider state, instant) ──250 ms debounce──► shock (API shape) + target T
        │
        ▼
hooks.ts: useAccount(id) · useScenario(id, shock, T) · useSimAccount(…) · useSimBank(shock, T)
        │   queryKey includes the shock → older responses are never shown for a newer shock
        │   placeholderData keeps the previous result visible while the new one loads (same account only)
        ▼
client.ts: request(op, schema, method, path, body)
        ├─ mock: postMessage to a Web Worker ("core" lane: account/scenario/sim; "heavy" lane: bank/discovery)
        └─ live: fetch('/api/…') with a 5 s timeout
        → Zod-validate → typed data or ApiError {op, status, code, field}
```

- **Two workers** keep the bank-wide run (≈250 ms in JS) from blocking slider updates for one customer.
- **Account switching:** `AccountBox` calls `queryClient.fetchQuery` first and only sets `accountId` if that succeeds. A bad ID shows "No account with ID …" and leaves the current customer on screen.
- **Tabs** stay mounted (`hidden`), so the account and shock carry across tabs. Bank and Discovery mount on first open.
- **Errors** stay inside each panel (`ErrorNote`), and a chart that fails to draw shows a message in its own box. Nothing blanks the whole app.

**Conventions:**
- All formatting goes through `src/lib/format.ts`: `cad()` (no cents, thousands separators, true minus sign), `pct()` (whole %), `runwayNumber()` (`4.2` / `120` / `120+`) and `runwayPhrase()`. The advisor summary uses the same functions, so text and panels always match.
- Charts use `Chart` + `chartTheme.ts`. Give every series a stable `id`: ECharts then tweens from the previous values (400 ms ease-out), which is how the fan chart and histogram animate.
- New API data: add a Zod schema in `schemas.ts`, a function in `client.ts`, a hook in `hooks.ts`, and a mock route in `mock/router.ts`. The TypeScript types come from the schema.
- No component calls `fetch` directly.

**Adding a panel:** create it in the feature folder, take data via props from the tab component (`AdvisorConsole.tsx`, which owns the queries), wrap it in `Card` (`title`, `tag`, `sub`, `busy`), show `SkeletonBlock` when there's no data yet, and gate it with `featureOn()` if it's on the cut list.

---

## 7. Mock layer (Frontend agents)

Files: `src/mock/{prng,dataset,engine,sim,discovery,router,worker}.ts`. Everything is seeded (`DATA_SEED = 20261107`), so every reload gives the same numbers.

### 7.1 Synthetic data
- 4,500 accounts with 24 months each (2024-01 … 2025-12). About 4% have 3–23 months. IDs are ascending and non-contiguous, as in PKDD.
- 32 districts in 8 regions (PKDD region names) with unemployment and salary factors.
- 682 loans (P only if running at 2025-12) and 76 defaults, weighted towards a low stress runway. Defaulters drift into trouble 6–10 months before default (this feeds D5 and D6).
- Rows have every monthly_summary column the engine needs. `breakdown` and `flex_monthly` come from them.

### 7.2 Fixed edge-case accounts (use them in rehearsal)

| ID | Case | Expected |
|---|---|---|
| 1 | Typical, surplus | Base runway no shortfall (120+) |
| 2 | I = 0 | Finite base runway. Breaking point f* "Not applicable" |
| 3 | B ≤ 0 | Runway 0 under every shock |
| 4 | No money_out (S = H = 0) | No shortfall. b* "Not applicable" |
| 5 | 4 months of data | "Limited history" flag. B = mean of all rows |
| 6 | Huge buffer, tiny gap | Runway 120 (the cap) |
| 7 | Spends more than they earn, thin buffer | Base runway < 3 months |
| 8 | Small deficit | Base runway 3–120 (≈ 36.7) |
| 9 | High earner (I ≈ $12.5k) | Loses runway when the EI cap is on |
| 10 | Defaulted loan, thin buffer | Risk flags, B ≤ 0 by the end |

### 7.3 Honesty rules
- The header shows a **Mock data** badge and a **JS mock engine** badge (or the engine forced by `VITE_MOCK_ENGINE`).
- The bank-wide mock runs **150 paths per account** (not 2,000) to stay under 1 s in the browser, reports `n_paths: 150`, and the Bank tab says so.
- `compute_ms` is the real time measured in the worker.
- The benchmark returns `measured: false` placeholders, and the UI labels them **Placeholder**.

### 7.4 What was checked (one-off scripts, not committed)
- Judges' formula: zero, no-shortfall, rounding (3.33 → 3.3, half to even), the 120 cap. Independent recomputation across 12 accounts × 3 presets.
- Breaking point round-trip: plugging f*, X* or b* back into the runway gives T (±0.05).
- Waterfall starts at the base runway and ends at the shocked runway. The backup plan's `cut_works` always reaches ≥ 6 months.
- Noise-off simulation = judges' runway within 0.1 months on 8 accounts.
- The same seed gives identical fan charts. 404 and 422 bodies (`field: "shock.income_factor"`) are correct.
- The twist reader turns each preset card's text into exactly that preset's slider values.
- Every response passes its Zod schema.

---

## 8. Design system (Frontend agents)

Tokens are in `src/styles/tokens.css`.

| Token | Hex | Use |
|---|---|---|
| `--orange-500` | `#EA7024` | Tangerine brand orange (rgb 234,112,36): fills, chart accents, active tab bar, headline numbers ≥ 24 px |
| `--orange-600` | `#C2540F` | Primary buttons (white text 4.6:1), orange text at body size, headline runway |
| `--orange-700` | `#9A420B` | Orange text on tinted backgrounds (6.3:1 on `--orange-50`) |
| `--green-700` | `#175235` | Tangerine leaf green: "Makes it", money in, positive steps |
| `--red-600` | `#B42318` | "Falls short", under-3-month bars, risk flags |
| `--ink-800/600` | `#333333` / `#555B63` | Body text / muted text (both AA on white) |
| `--bg` | `#F7F5F2` | Warm page background, white cards |

- **Contrast:** `#EA7024` on white is 3.1:1, which passes AA only for large text. Never use it for body-size text. Use `--orange-600` or `--orange-700` instead.
- **Type:** Inter variable, with tabular figures for every number. Sizes come from `--fs-*` and spacing from `--sp-*` (4 px base).
- **Charts:** the palette is orange, leaf green, ink, grey and red for risk. Chart elements use the same meaning everywhere: orange = the customer or median, red = risk or below zero, green = safe.
- **Motion:** 400 ms ease-out tweens for charts and headline counters, and a 2 px loading bar on busy cards. `prefers-reduced-motion` turns them off.
- **Layout:** at 1440×900 the account box, KPI row, shock panel, headline runway with verdict, survival card, breaking point and summary are all above the fold.

---

## 9. Advisor Console panels

The order follows the roadmap's live-twist script: judges' runway → survival → breaking point → plan → bank.

| Panel | File | Data | Notes |
|---|---|---|---|
| Account box | `AccountStrip.tsx` | `GET /accounts/{id}`, `/accounts/random` | Validates whole numbers before any request. Loads `#account=ID` from the URL, otherwise a random account. Keys: **A** focuses, **R** loads a random account |
| KPI row | `AccountStrip.tsx` | profile | I, S, F, B and base runway (largest, orange). Hints show surplus, H, P and how B was computed |
| Shock panel | `ShockPanel.tsx` | local draft | Income kept 0–100%, EI length 0–24, bills +0–100% of H, rent/other $ (slider to $3k plus a box up to $20k), one-off in $ or × S (shows the CAD equivalent; switching units keeps the CAD amount), EI cap switch, 3 preset cards (**1–3**), Reset (**0**) |
| Twist card reader (D7) | `ShockPanel.tsx`, `lib/twistReader.ts` | none (rule-based) | **/** focuses it, Enter reads, Enter again applies. It shows every parsed value **with the phrase it came from**, lists anything it didn't understand, and resets anything not mentioned. It recognises EI N%, bare EI or job loss (55%), "income drops to/by N%", "N% pay cut", "for N months", "bills up N%", "N% increase in bills", "rent/spending up $N", "$N more rent", "a full month of spending", "N months of spending", "one-off/repair/emergency/car… $N", "$N … repair", "$2k", and "EI cap / weekly maximum / capped" |
| Runway after the shock | `Results.tsx` | scenario | 64 px headline. Before → after. Verdict pill (only when EI length > 0). A line showing the formula with the actual numbers, so a judge can check it by hand |
| Chance of making it (D2) | `Results.tsx` | simulate/account | Survival % for T, animated fan (p10–p90 band, median, the judges' straight-line path dashed, $0 line, T marker), compute timer ("10,000 futures × 24 months in 38 ms · C++"). Labelled as a simulation that adds to the runway |
| Breaking point (D4) | `Results.tsx` | scenario.breaking_point | Each limit has a plain-language note for the special statuses |
| What to tell the customer | `Results.tsx`, `lib/summary.ts` | scenario + sim | 2–3 rule-based sentences: runway and verdict → simulation and breaking point → plan. Has a Copy button |
| Bank mini | `Results.tsx` | simulate/bank | Share under 3 months. Click to open the Bank tab |
| Explain the change | `Explain.tsx` | scenario.waterfall | Today → income → bills → other → one-off → after. Steps that start from "no shortfall" are labelled with where they land (e.g. "→ 6.3"), not a fake difference from 120 |
| Buffer burn-down | `Explain.tsx` | scenario.burn_down | Marks where the balance hits $0 and where EI ends, with a red area below $0 |
| Goal plan | `Plans.tsx` | scenario.goal_plan | Target, progress bar, months to reach it or the cut needed |
| Backup plan | `Plans.tsx` | scenario.backup_plan | Flexible amount, cut %, the runway it reaches, and all special statuses |
| Money in and out | `Customer.tsx` | history | Bars for in and out, a balance line, and a dashed B line |
| Spending breakdown | `Customer.tsx` | breakdown | Fixed (ink) vs flexible (orange) |
| Risk flags and peers | `Customer.tsx`, `lib/flags.ts` | profile, peers | Flags: no income, defaulted, days below zero, buffer < 1 × S, limited history, no spending, loan running. Peers: "Better than N% of customers with similar income in the same district" |
| Definitions | `Definitions.tsx` | — | Every formula, plus "the simulation adds to the runway and never replaces it" |

---

## 10. Bank tab (D3)

File: `src/features/bank/BankTab.tsx`. It uses the same debounced shock as the console, and preset buttons let the presenter switch twists without leaving the tab.

- Share under 3 months (large, animated), count, and the change from no shock.
- Mean survival probability for T, and the share with under a 50% chance (both labelled as simulation).
- Dark compute-timer card: "4,500 customers × N futures in X ms", engine and seed. In mock mode it states that the mock runs fewer paths.
- Runway histogram with fixed bins (§3.3 #6): red under 3, orange 3–120, green 120+. Bars tween between shocks.
- Region × income-quintile heatmap (`region-map`, cut rank 2). Text colour flips on dark cells.

---

## 11. Discovery tab

File: `src/features/discovery/DiscoveryTab.tsx`. Every card renders whatever its endpoint returns. The sentences come from the backend, so the discovery agent controls the wording.

- **Main finding:** headline, sentence, method and one bar chart with the highlighted bar in orange.
- **D5 defaults:** default rate by runway band, a dashed "all loans" line, and "the lowest band defaulted at N× the rate of the highest".
- **Tipping point:** share under 3 months against the size of the shock, for each series, with the tipping point marked.
- **D8 EI cap:** customers who lose runway, average runway lost, under-3 counts (judges' EI → capped), and median runway by quintile, with a link to canada.ca.
- **Benchmark (D1):** horizontal bars on a log scale with seconds and speed-up, and a Placeholder or Measured badge.
- **D6 time machine** (`time-machine`, cut rank 1): pick a defaulted account; Play, step and scrub through the months. The runway line draws up to the current month, with the flag threshold, first flag and default month marked, and a sentence giving the lead time.

---

## 12. Demo and rehearsal (everyone)

**Keyboard** (when not typing in a field): **R** random account · **A** account box · **/** twist reader · **1 2 3** preset twists · **0** reset.

**Live-twist flow (about 30 s):**
1. Press **R**, or type the judge's account ID and press Enter.
2. Press **/**, paste the twist card, press **Enter** and read the parsed values aloud ("EI 55% from 'EI 55%'…"), then press **Enter** to apply.
3. Point at the headline runway and the formula line under it (it matches the judges' number), then the verdict.
4. Survival % and the fan chart: "31% of 10,000 futures make it", then the compute timer.
5. Breaking point, then the backup plan, then read "What to tell the customer".
6. Click the bank mini card to open the Bank tab: share under 3 months, histogram, timer.

**Fallbacks:**
- If the C++ build fails, the API reports `numpy` and the badge turns amber ("NumPy mode"). Nothing else changes.
- If the API is down, run with `VITE_DATA_SOURCE=mock` and rehearse on the mock (say so if you show it).
- If a feature's backend isn't ready, add it to `VITE_DISABLED_FEATURES` in this order: time-machine → region-map → peers → twist-reader → bank. The runway, shock panel, plans, default check and fallback badge can't be turned off.

**Measured in the mock** (headless Chromium, 1440×900, this Mac): first full render of the console ≈ 0.4–0.9 s; single-account simulation of 10,000 × 24 ≈ 40 ms; bank-wide run of 4,500 × 150 × T ≈ 190–260 ms; no console errors. Measure again on the demo laptop.

---

## 13. Assumptions and open questions

| Assumption | Where | Change it by |
|---|---|---|
| Survival / breaking-point target T = EI length if > 0, else 6 | `lib/shock.ts targetMonths` | Edit there; the API takes `target_months` |
| Preset 3 ("EI 55% with bills +15%") leaves EI length at 0, so it gets no verdict | `lib/shock.ts PRESETS` | Set `income_months: 6` if the team prefers. The twist reader then needs "for 6 months" in the card |
| A twist card is a whole scenario: anything not mentioned resets | `lib/twistReader.ts` | Start from `draft` instead of `NO_DRAFT` |
| Peers = same district + same income quintile | API route 3 | Backend |
| D5 and D6 use the runway under EI 55% (most base runways are "no shortfall") | mock `discovery.ts` | Discovery agent |
| Goal plan "needs_cut" works over 12 months | `GOAL_CUT_HORIZON` | Backend + mock |
| Goal plan uses 6 × S if `days_below_zero_6m > 0` or `ever_below_zero` | API route 4 | Backend |
| EI weekly maximum $729 (2026) = $3,159/month | `mock/engine.ts`, footnote | Backend config |
| The roadmap's open questions (F definition, loan "running" rule, B with fewer than 6 rows) | engine | Engine owner. The UI just shows what the API returns |

---

## 14. Status and next steps

**Done:** everything in §9–§11 runs against the mock and builds cleanly under strict TypeScript.

**Next, in order:**
1. **Backend:** build `api.py` from §3. Start with routes 1, 3, 4 and 2 (the console works with those), then 5 and 6, then 7–13.
2. **HPC:** make `simulate_one` and `simulate_bank` return the §4 fields. Write `bench.json`.
3. **Discovery:** write the §5 JSON files and choose the main finding.
4. **Frontend:** in live mode, fix any schema mismatches the panels report. Take README screenshots. Rehearse with §12.
