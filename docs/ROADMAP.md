# Resilience Rewired — 24-Hour Roadmap

Tangerine Track · Sheridan Datathon 2026 · November 7–8
Times are hours from the start (H+0). Shift them to the real kickoff time.

## 1. Vision

- **In one sentence:** Enter an `account_id`, see how long the customer can last and **how likely they are to make it**, apply any shock live, and watch both the customer and the whole bank update in real time, powered by a C++ simulation core.
- **Who it's for:** The judges during the 3-minute live twist first, then a bank advisor talking with a customer, and a risk team watching the whole book of customers.
- **Why it matters:** Banks see the transactions but not the runway. This turns 1M transactions into one number per customer, a survival probability, and a plan to improve it.
- **Constraints:** 24 hours. It has to run live and fast on any of the 4,500 accounts. Its numbers have to match the judges' definitions. The final product uses **Tiger Data** for the live feed. *(Snowflake was scrapped on 2026-11-07.)*
- **What wins (judging weights):** Discovery 35%, Data Use 25%, Communication 25%, Impact 15%.

### What makes us different

Most teams will show one runway number from the judges' formula. We show that number exactly, plus these:

| # | Differentiator | What the judge sees | Score it helps |
|---|----------------|---------------------|----------------|
| D1 | **C++ HPC simulation core** | Every slider move reruns 10,000 Monte Carlo futures for this customer, and for all 4,500 customers, in well under a second | Discovery, Data Use |
| D2 | **Survival probability** | "Runway 4.2 months, but a **31%** chance of making the full 6 months on EI", with a fan chart of possible balances | Discovery, Communication |
| D3 | **Live bank-wide stress test** | A panel showing how many of all 4,500 customers fall under 3 months, updating as the twist is applied | Impact, Discovery |
| D4 | **Breaking point** | "This customer breaks if income falls below 71%, or with a one-off cost over $4,180", worked out in reverse from the formula | Communication |
| D5 | **Proof against real defaults** | "Customers our engine flags defaulted at 4× the rate", checked against the 682 real loan outcomes | Discovery, Data Use |
| D6 | **Time machine and early warning** | Replay a customer who defaulted, month by month, and show the engine flagging them N months before | Discovery, Communication |
| D7 | **Twist card reader** | Paste the judge's twist text and it fills in the sliders, with the parsed values shown for the presenter to check | Communication |
| D8 | **Canadian realism** | EI with the real weekly maximum, rent shocks sized from CMHC, and inflation from CPI, shown next to the judges' numbers | Data Use, Impact |
| D9 | **Live transaction feed (Tiger Data)** | Transactions stream into a Tiger Data hypertable, and continuous aggregates update the customer's income, spending, buffer and runway within seconds of each new transaction | Data Use, Impact |

**The rule that protects us:** the judges' deterministic formula (Python, tested) is always the headline number. C++ and Monte Carlo add to it but never replace it. If the C++ build fails, the app falls back to NumPy. If Tiger Data or the Wi-Fi fails during judging, the app falls back to the local Parquet cache and still runs the live twist.

### How the pieces fit

```
CSVs ──► load.py ──► Parquet cache (local fallback)
                 └─► Tiger Data (time series: transactions + monthly_summary hypertables,
                                 continuous aggregates → live I, S, H, B per account)

replay.py ──► streams transactions in date order into Tiger Data  (live feed, D9 + time machine, D6)

app.py (Streamlit)
  ├─ profile + judges' runway ◄── Tiger Data (live) or Parquet (fallback)
  ├─ survival + bank-wide panels ◄── C++ core (resil_hpc) or NumPy fallback
  ├─ discovery tab ◄── discovery.py over engine.profiles_all() (cached to Parquet)
  └─ twist card reader ◄── rule-based parser (twist.py)
```

## 2. Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Data (local) | pandas + Parquet cache | The CSVs are small enough for memory. Parquet makes reloads instant and is the offline fallback |
| **Time series** | **Tiger Data (Tiger Cloud, TimescaleDB)** via `psycopg` | Hypertables for transactions and monthly_summary. Real-time continuous aggregates keep each account's monthly totals and balances current as transactions arrive |
| Secrets | `.env` file (git-ignored) + `python-dotenv` | Tiger Data credentials never go in the repo |
| Engine (truth) | Plain Python `engine.py` (pure functions) | The judges' formula, easy to test, imported by the app and the notebook |
| **HPC core** | **C++17 + OpenMP, exposed to Python with pybind11** (`hpc/`) | Monte Carlo across accounts × paths × months in parallel on every CPU core |
| HPC build | CMake + scikit-build-core, or `pip install -e hpc/` | One command to build. Test the build on every laptop at H+0 |
| HPC fallback | NumPy version `sim_numpy.py` with the same function signature | The demo never depends on the compiler working |
| App | Streamlit | Sliders and an account box in minutes. Works well for a live demo |
| Charts | Plotly | Fan charts and heatmaps that look good in the video |
| Discovery | Jupyter notebook `discovery.ipynb` | Runs the engine across all accounts |
| Tests | pytest (Python) and a C++ check run from pytest | C++ results must match Python on the same inputs |
| Repo | `seanyzlee/sheridan-datathon` | Private now. Make it public or zip it before submitting |

### Why HPC is earned here, not decoration

One customer with the judges' formula is a single division, so it doesn't need C++. The heavy work is:

- **Per customer:** 10,000 paths × 24 months, sampling job loss, EI, income and spending noise, bill inflation and one-off repairs = 240K steps on every slider move
- **Whole bank:** 4,500 customers × 2,000 paths × 24 months ≈ **216M steps** per scenario, needed for D3 and for the discovery charts
- **Discovery sweeps:** a grid of shock sizes (EI 40–70% × bills 0–30% × one-off 0–3 × S) across all customers, to find where the bank tips over

Pure Python takes minutes for the bank-wide run. The C++ core has to do it in under 1 second so it can update live. Show this as a benchmark slide (Python vs NumPy vs C++ on 1 core and all cores).

## 3. Data Model

The engine works from `monthly_summary.csv`, `loans.csv` and `accounts.csv`. Discovery also uses districts, clients and transactions.

### profile (one row per account, computed in Phase 1)
  account_id
  I  = median(money_in)
  S  = median(money_out)
  F  = median(household_bills + insurance + loan_payments)   ← sum each row, then take the median
  H  = median(household_bills)
  B  = mean(avg_daily_balance) over the last 6 rows, sorted by month
  P  = loans.monthly_payment if the loan is still running at 2025-12, else 0
  surplus = I - S
  runway_base (using the formula below, with no shock)
  months_of_data, days_below_zero_6m, has_loan, defaulted

### risk factors (one row per account, used by the simulation, Phase 3b)
  sd_in, sd_out          = standard deviation of money_in and money_out over the last 24 months (each customer's own volatility)
  flex_share             = (card + genuine cash + other transfers out) / money_out, the part that can be cut
  p_jobloss_month        = from the district's unemployment_rate_2023, turned into a monthly chance
  bills_growth           = from CPI (StatCan 18-10-0004-01)
  repair_rate, repair_size = chance and size of a one-off shock (default: 5% a month, 0.5–2 × S)
  ei_weekly_max          = current EI maximum weekly benefit from canada.ca (check the 2026 figure)

### shock (input)
  income_factor   (1.0 = none, 0.55 = EI)
  income_months   (how long EI lasts. Shown in the plan and used in the simulation, but not in the judges' runway formula)
  bills_pct       (+x% of H added to spending)
  spend_delta     (other monthly increase, e.g. rent in CAD)
  one_off         (CAD, or a multiple of S, e.g. "a full month of spending" = 1 × S)
  ei_cap_on       (false = judges' 55% × I; true = also apply the EI weekly maximum)

### Runway (exactly the judges' formula)
```
buffer_left = B - one_off
income      = income_factor * I
spending    = S + bills_pct * H + spend_delta
gap         = spending - income
if buffer_left <= 0: 0
elif gap <= 0:       "no shortfall (120+)"
else:                round(min(buffer_left / gap, 120), 1)
```

### Breaking point (D4: the formula worked in reverse)
```
income factor that breaks a target of T months:  f* = (S' - (B - one_off) / T) / I
largest one-off they can take for T months:      X* = B - T * gap
largest bills increase for T months:             b* = ((B - one_off) / T + income - S - spend_delta) / H
```

### Simulation (C++ core: one path, one month)
```
balance[0] = B - one_off
each month t:
  employed?   switch to EI with chance p_jobloss_month (or forced by the shock)
  income_t  = (employed ? I : min(ei_factor * I, ei_cap)) * (1 + sd_in/I * z1), and 0 after EI ends
  spend_t   = (S + bills_pct * H * (1 + bills_growth)^t + spend_delta) * (1 + sd_out/S * z2)
  one-off repair with chance repair_rate
  balance[t+1] = balance[t] + income_t - spend_t
outputs: P(balance stays above 0 for T months), month the balance first goes below 0 (percentiles), balance fan chart (p10/p50/p90)
```
Use a fixed random seed so the same twist always gives the same answer during the live demo.

### Where each table lives

| Table | Parquet | Tiger Data |
|-------|---------|------------|
| transactions | ✓ | ✓ hypertable on `date`, segmented by `account_id` |
| monthly_summary | ✓ | ✓ hypertable on `month` (loaded for checking) |
| monthly_live | | ✓ real-time continuous aggregate built from transactions (`time_bucket('1 month', date)`), same columns as monthly_summary |
| profile | ✓ | ✓ view: exact medians with `percentile_cont(0.5)` over `monthly_live` rows, last-6-month buffer |
| accounts, loans, districts, clients, dispositions, cards, standing_orders | ✓ | ✓ plain tables (loans and accounts only) |
| sim_results, sweep_results | ✓ written by the C++ core runs | |

**Exact numbers rule:** I, S, H and B must be exact medians and means, so compute them with `percentile_cont` over monthly rows, not with approximate toolkit percentiles. Use toolkit hyperfunctions (e.g. `stats_agg`) only for extra live statistics such as volatility. For the buffer, `avg_daily_balance` needs end-of-day balances carried forward over quiet days: build it with `time_weight('LOCF', ...)` over end-of-day balances, and if it doesn't match `monthly_summary.avg_daily_balance` exactly, take B from the loaded monthly_summary table for the judges' number.

**Check:** `monthly_live` must reproduce `monthly_summary.csv` for every account and month (money_in, money_out and the category columns) before the live feed is trusted.

### Joins used for discovery
- accounts → districts (unemployment, average_salary)
- accounts → loans (defaulted, as the ground truth)
- accounts → dispositions → clients (age, from birth_date)
- transactions (only for the time machine, D6)

## 4. Phases

Roles: **A** = engine, **B** = app, **C** = discovery and story, **D** = C++ HPC.

**Team of 2:** **Person 1 = A + D** (engine, Tiger Data, C++ core) and **Person 2 = B + C** (app, discovery and story). Pick who is who at kickoff. Phases 3a and 3c are shared; when one person is blocked, they take the next unchecked task from the other lane.

### Phase 0 — Setup · H+0 → H+1
*Goal: Everyone can load all the data in under 5 seconds, the C++ toolchain builds on the HPC laptop, and both cloud accounts accept a connection.*

- [x] Clone the repo and add `data/`, `cache/` and `.env` to `.gitignore` (don't commit the bank data unless the rules allow it)
- [x] `requirements.txt`: pandas, pyarrow, numpy, streamlit, plotly, pytest, jupyter, pybind11, scikit-build-core, psycopg[binary], python-dotenv
- [x] ~~Snowflake account~~ *(scrapped)*
- [x] **Tiger Data:** create a Tiger Cloud service with TimescaleDB and the `timescaledb_toolkit` extension. Put the connection string in `.env`
- [x] `check_cloud.py`: runs `SELECT extversion FROM pg_extension WHERE extname='timescaledb'` on Tiger Data
- [x] `load.py`: read each CSV once, cast `month` to a period and `partner_bank` to text, and write Parquet to `cache/`
- [x] Check row counts: monthly_summary 185,326, transactions 1,056,320, loans 682, accounts 4,500
- [x] **D:** a "hello world" pybind11 module with OpenMP that builds with one command and imports in Python (on Windows, use MSVC or MinGW and check that `/openmp` or `-fopenmp` works)
- [x] Split the work across A, B, C and D (2 people, see Roles)

**Done when:** `python load.py` prints the row counts, `python -c "import resil_hpc; print(resil_hpc.threads())"` prints the core count, and `python check_cloud.py` connects to Tiger Data.

### Phase 1 — The engine matches the judges · H+1 → H+5 (A)
*Goal: `python engine.py 1234 --ei 0.55 --bills 0.15` prints the same runway the judges would get.*

- [x] `profile(account_id)` returns I, S, F, H, B and P as defined above
- [x] `P`: count a loan as running if `loan_start + duration_months` goes past 2025-12. Cross-check against status C/D and note any mismatch *(0 mismatches on all 682 loans; `start + duration >= 2025-12` would give 11)*
- [x] `runway(profile, shock)` exactly as in the formula block, including rounding and the 120 cap
- [x] `breaking_point(profile, shock, T)`: income factor, one-off and bills increase limits (D4)
- [x] Shock presets for the three example twist cards (EI 55% for 6 months; one-off = 1 × S; EI 55% with bills +15%)
- [x] `profiles_all()` builds a cached DataFrame for all 4,500 accounts (used by discovery, the simulation and for speed)
- [x] Edge cases: fewer than 6 months of data, I = 0, B ≤ 0, an account with no money_out
- [x] pytest: work out 3 accounts by hand in a spreadsheet and assert the engine returns the same numbers *(20111, 20396, 36407, computed from the raw CSVs without pandas; still worth a spreadsheet check by a teammate)*

**Done when:** All tests pass, and every one of the 4,500 accounts runs without an error in under 1 second total from the cache.

### Phase 1b — Data platform: Tiger Data · H+2 → H+8 (A, after Phase 1)
*Goal: Tiger Data holds the data, computes the same profile numbers as the engine, and a replay script makes them update live.*

#### Tiger Data
- [ ] Schema (with `design-postgres-tables` and `setup-timescaledb-hypertables`): `transactions` hypertable on `date` with a `segmentby account_id` columnstore, plus accounts and loans tables
- [ ] `monthly_live`: real-time continuous aggregate by account and month with the same category columns as monthly_summary
- [ ] End-of-day balance table and `avg_daily_balance` with `time_weight('LOCF', ...)`. Check it against monthly_summary
- [ ] `profile_live` view: exact medians with `percentile_cont`, last-6-month buffer, loan payment. It must match `engine.profile()`
- [ ] `replay.py`: empties a demo account's recent transactions, then inserts them back in date order at a chosen speed (e.g. one month per second) so the profile visibly updates. A `--account` and `--from` option picks who and when
- [ ] `tiger_client.py`: the app's live data source, falling back to Parquet if Tiger Data can't be reached

**Done when:** `pytest` shows Tiger `profile_live` and `engine.profile()` agree on 50 random accounts, and `replay.py` changes an account's runway on screen within 2 seconds of each inserted month.

### Phase 2 — "Know the customer" app · H+3 → H+9 (B)
*Goal: A judge types any account_id and sees the customer's position in one screen.*

- [ ] Streamlit page: account_id box (plus a "random account" button for rehearsal)
- [ ] KPI cards: income I, spending S, fixed costs F, buffer B, runway
- [ ] Chart: monthly money in and out with the buffer line (last 24 months)
- [ ] Spending breakdown: bills, insurance, loans, card, cash, other transfers
- [ ] Risk flags: days below zero, defaulted loan, buffer under 1 month of spending
- [ ] **Peer comparison:** "Better than 64% of customers with similar income in the same region"
- [ ] Footnote showing the definitions, so you can answer "how did you get that number?"

**Done when:** It runs locally with `streamlit run app.py` and loads any account in under 2 seconds.

### Phase 3a — "Take a shock" and "Make a plan" · H+9 → H+14 (A + B)
*Goal: Run any twist card live in under 30 seconds and explain the result.*

- [ ] Shock panel: income % slider, EI length, bills +%, rent/other +$, one-off ($ or × S), EI cap on/off, and "apply twist card" preset buttons
- [ ] **Twist card reader (D7):** a text box where rules parse phrases like "EI 55% for 6 months", "bills up 15%", "rent +$300" or "a full month of spending" into slider values, e.g. `{"income_factor":0.55,"income_months":6,"bills_pct":0.15}`. Always show the parsed values before applying, so a misread is caught on screen. The reader never calculates; the engine does all the maths
- [ ] Before and after: runway, with a "do they make it?" verdict for the EI length (runway ≥ EI months)
- [ ] **Breaking point card (D4):** "They break at income below X% or a one-off above $Y"
- [ ] **Explain the change:** a waterfall chart from base runway → minus income loss → minus bills → minus one-off → new runway
- [ ] Buffer burn-down chart: month-by-month balance after the shock, showing when it hits zero
- [ ] **Goal plan:** emergency fund target = 3 × S (6 × S if they've ever gone below zero). Months to reach it = (target − B) / surplus. If the surplus is ≤ 0, show the cut needed to get there
- [ ] **Backup plan (if the shock hits):** cut the flexible categories first (card withdrawals, genuine cash withdrawals, other transfers out) and show the cut % needed to reach 6 months of runway. Keep bills, insurance and loans fixed
- [ ] Plain-language summary of 2–3 sentences, generated from the numbers (rule-based text that sounds like an advisor)

**Done when:** All three example twists run live on 5 random accounts without errors, and each takes under 30 seconds to explain.

### Phase 3b — C++ HPC simulation core · H+5 → H+14 (D)
*Goal: Survival probability for one customer in under 50 ms, and the whole bank in under 1 second, both called from the app.*

- [ ] `sim_numpy.py` first (H+5 → H+7): the simulation from the Data Model in vectorised NumPy. This is the reference and the fallback
- [ ] `hpc/resil.cpp`: the same simulation in C++17. Use flat arrays, one random generator per thread (e.g. `std::mt19937_64` or a fast xoshiro), OpenMP `parallel for` over accounts or paths, and no Python objects inside the loop
- [ ] pybind11 functions that take NumPy arrays without copying:
  - `simulate_one(profile, shock, n_paths, months, seed)` → survival probability, percentiles of when the balance first goes negative, p10/p50/p90 fan
  - `simulate_bank(profiles_array, shock, n_paths, months, seed)` → per-account survival probability and runway
  - `sweep(profiles_array, shock_grid, ...)` → bank-wide results for every shock combination (for discovery)
- [ ] **Check against the judges:** with all noise turned off (sd = 0, no random job loss, no repairs), the month the balance first goes negative must equal the judges' runway (within 0.1)
- [ ] **Check against NumPy:** same seed and inputs give the same survival probabilities within ±1%
- [ ] Load `resil_hpc` if it imports; otherwise use `sim_numpy` and show a small "NumPy mode" badge
- [ ] `bench.py`: time Python loop vs NumPy vs C++ (1 thread) vs C++ (all threads) on the bank-wide run. Save the table and chart for the pitch
- [ ] Optional if ahead of schedule: run the time machine replay (D6) through C++ by streaming the 1M transactions in date order and updating every account's runway each month

**Done when:** `pytest` passes both checks, the bank-wide run takes under 1 second on the demo laptop, and the benchmark chart is saved.

### Phase 3c — Real-time views · H+12 → H+15 (B + D)
*Goal: Moving a slider updates the customer and the whole bank together, live.*

- [ ] **Survival panel (D2):** "X% chance of making it T months" plus the fan chart, rerun on every slider change
- [ ] **Bank-wide stress panel (D3):** share of customers under 3 months, a runway histogram, and a map or heatmap by region, rerun on every twist
- [ ] Show the compute time on screen ("4,500 customers × 2,000 futures in 0.4 s") so judges see the HPC working
- [ ] Use `st.cache_resource` for the profiles array and keep the C++ call the only thing that runs on each change
- [ ] **Live feed panel (D9):** a "Live" toggle that polls Tiger Data `profile_live` every 1–2 seconds (`st.fragment(run_every=...)`) while `replay.py` streams transactions. The KPI cards, runway and survival probability update as each month lands
- [ ] A small data-source badge on screen: "Tiger Data live" or "Offline cache"

**Done when:** A slider change updates both panels in under 1 second on the demo laptop, and a replay visibly moves one customer's numbers live.

### Phase 4 — Discovery (35% of the score) · H+5 → H+16 (C, using D's sweep once ready)
*Goal: One finding across all accounts that a judge remembers, backed by a chart.*

- [ ] `discovery.py`: every discovery table is a named, repeatable function over `engine.profiles_all()` and the C++ sweep, cached to Parquet so the app's discovery tab works offline
- [ ] Run each twist across all 4,500 accounts. What % don't make it 6 months on EI? Which groups are most fragile?
- [ ] **Check against defaults (D5):** does low runway or buffer predict loan default (`defaulted`) among the 682 loans? Report the default rate by runway band, and the ratio between the bottom and top bands
- [ ] **Tipping point:** use the C++ sweep to find the shock size where the share of customers under 3 months jumps sharply. "A 10% bills rise hurts few people; 20% tips 1 in 4 over"
- [ ] **Time machine (D6):** for customers whose loan defaulted, replay their months (in Tiger Data with `replay.py`) and find how many months earlier the engine would have flagged them
- [ ] Regional view: fragility by district against `unemployment_rate_2023` and `average_salary`
- [ ] **Canadian realism (D8):** compare the judges' EI (55% × I) with the capped EI. How many customers lose runway because of the weekly maximum?
- [ ] Size shocks with Canadian sources (CPI, CMHC rent, EI maximum, Labour Force Survey) and record each link in `SOURCES.md`
- [ ] Choose **one main finding** and put it on the app's landing tab as a single chart and sentence

**Done when:** The finding chart is in the app, and `discovery.ipynb` runs from start to finish.

### Rest · H+15 → H+18
Take turns: at least two people sleep in shifts while one keeps working. Don't skip this, because the live twist needs a clear head.

### Phase 5 — Rehearse the live twist · H+18 → H+21 (everyone)
*Goal: The 5-minute judging slot is practised at least 5 times.*

- [ ] Script the 1-minute pitch: the problem, the engine, the HPC benchmark in one sentence, then the main finding
- [ ] Do 3-minute practice runs where a teammate picks a random account and makes up a twist card. Use the twist card reader every time
- [ ] Order for each live twist: judges' runway first (it matches their answer), then survival probability, then the breaking point, then the plan, and end on the bank-wide panel
- [ ] Practise one-sentence answers: "Why median?", "Why don't you count EI length in runway?", "Why C++?", "Where do the probabilities come from?", "What if they have no income?"
- [ ] Speed: preload the cache when the app starts and remove anything that takes more than 2 seconds
- [ ] Run at least one rehearsal with the Wi-Fi turned off, to prove the Parquet fallback works for every panel the live twist needs
- [ ] Check Tiger Data is awake 10 minutes before judging
- [ ] Backup plan: a screen recording, the NumPy fallback, the offline cache, and a notebook version in case the Wi-Fi, a cloud service, the build or the app fails

**Done when:** A full run takes under 5 minutes, with no errors on random accounts.

### Phase 6 — Submit · H+21 → H+24
*Goal: Submitted on Devpost with an hour to spare.*

- [ ] Demo video, 2–3 minutes: pitch, one live twist with the survival and bank-wide panels, the benchmark, the finding
- [ ] Write-up: what the engine does, the main finding, a short "how the C++ core works" section with the benchmark table, and the architecture diagram (Tiger Data, C++ core, app)
- [ ] Check that no credentials are in the repo history before making it public (`git log -p | grep -i -E "password|secret|token"`). Rotate any key that ever got committed
- [ ] `SOURCES.md` and README credits: PKDD'99 Financial dataset (CTU Prague), plus every StatCan or Government of Canada link used
- [ ] README: setup in 3 commands (including building `hpc/`) and a screenshot
- [ ] Make the repo public (or attach a zip) and check the link in a private window
- [ ] Submit on Devpost by **H+23**

## 5. Build Order

| Phase | Hours | Owner | Output |
|-------|-------|-------|--------|
| 0 Setup | 0–1 | All | Parquet cache, C++ toolchain, cloud connections |
| 1 Engine | 1–5 | A | `engine.py` + tests + breaking point |
| 1b Data platform | 2–8 | A | Loaded Tiger Data, matching profile views, `replay.py` |
| 2 Customer app | 3–9 | B | `app.py` profile view + peers |
| 3a Shock + plan | 9–14 | A+B | Twist panel, twist reader, plans |
| 3b C++ core | 5–14 | D | `resil_hpc`, NumPy fallback, benchmark |
| 3c Real-time views | 12–15 | B+D | Survival and bank-wide panels |
| 4 Discovery | 5–16 | C | Finding, default check, time machine |
| Rest | 15–18 | Shifts | — |
| 5 Rehearse | 18–21 | All | Pitch + Q&A answers |
| 6 Submit | 21–24 | All | Video, write-up, Devpost |

**Cut order if behind schedule** (drop from the top first): C++ time machine replay → map view → peer comparison → bank-wide panel. Never cut: the judges' runway, the shock panel, the plans, the default check, the NumPy and Parquet fallbacks and the Tiger Data live feed (it's required in the final product).

## 6. Skills to Use in Each Phase

Installed globally with `npx skills add <skill> -g -y`. Each one was checked on GitHub before installing.

| Phase | Skill | Use it for |
|-------|-------|-----------|
| All | `roadmap` | `status` to see progress. Use plan mode only; don't let `start` mode deploy or run on its own |
| 1b | `design-postgres-tables` (timescale) | Tiger Data schema for accounts and loans |
| 1b | `setup-timescaledb-hypertables` (timescale) | Transactions hypertable, columnstore, continuous aggregates |
| 1b, 3c | `timescaledb-hyperfunctions` (timescale) | `time_weight` for the daily balance, `stats_agg` for volatility |
| 1, 4 | `pandas-pro` | Profile maths, joins and discovery tables |
| 2, 3a, 3c | `developing-with-streamlit` (official Streamlit) | App layout, caching, `st.fragment` live refresh |
| 3b | `cpp-pro` | The C++17 simulation core and CMake build |
| 3b | `openmp` | Parallel loops, per-thread random generators, avoiding false sharing |
| 1, 3b | `pytest-coverage` | Tests against the judges' numbers and the C++/NumPy checks |
| 6 | `demo-video` | The 2–3 minute Devpost video |
| 6 | `create-readme` | README with setup and credits |

## 7. Deliberately Not Building

- Logins or user accounts. Judges need speed, not security theatre
- Writing customer-facing data back into the source tables. Tiger Data is loaded from the CSVs; only simulation results and replays are written
- Deploying the app to the cloud. The app runs locally and talks to Tiger Data; deploy it only if there's time after H+21
- Making the live twist depend on the network. Every panel the twist needs must also work from the Parquet cache
- GPU / CUDA. Multi-core C++ is fast enough for this data size and far less risky to build in 24 hours
- An LLM chat agent as the main interface. It's slower and can make up numbers during a live twist. The twist reader is rule-based, always shows what it parsed, and never calculates
- ML default prediction as the product. Use default data only to check the engine
- Replacing the judges' formula with the simulation. The simulation adds to the headline number and never replaces it

## 8. Open Questions to Settle Early (H+0 → H+2)

- **Cloud accounts:** does the event provide Tiger Data credits or accounts? If not, use the free trials. Who owns each login?
- **Data in the cloud:** check the event rules allow uploading the bank data to Tiger Data

- **F definition:** median of each row's sum, or the sum of three medians? The plan assumes each row's sum. Ask in #ask-a-mentor
- **Loan "running at end of 2025":** use date math or status C/D? Check that they agree
- **B with fewer than 6 rows:** use the mean of all rows and show a "limited history" flag
- **Can `data/` go in the public repo?** If it's unclear, keep it out and say so in the README
- **Demo laptop:** which laptop runs the live demo, and how many cores does it have? Build and benchmark the C++ core on that exact machine
- **EI maximum:** confirm the current weekly maximum on canada.ca before using it in D8
