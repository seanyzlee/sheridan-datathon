# Resilience Rewired — 24-Hour Roadmap

Tangerine Track · Sheridan Datathon 2026 · November 7–8
Times are hours from the start (H+0). Shift them to the real kickoff time.

## 1. Vision

- **In one sentence:** Enter an `account_id`, see how long the customer can last, apply any shock live, and get a goal plan and a backup plan built from their own numbers.
- **Who it's for:** The judges during the 3-minute live twist first, then a bank advisor talking with a customer.
- **Why it matters:** Banks see the transactions but not the runway. This turns 1M transactions into one number per customer, plus a plan to improve it.
- **Constraints:** 24 hours. It has to run live and fast on any of the 4,500 accounts. Its numbers have to match the judges' definitions.
- **What wins (judging weights):** Discovery 35%, Data Use 25%, Communication 25%, Impact 15%.

## 2. Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Data | pandas + Parquet cache | The CSVs are small enough for memory. Parquet makes reloads instant |
| Engine | Plain Python module `engine.py` (pure functions) | Easy to test, and both the app and the notebook can import it |
| App | Streamlit | Sliders and an account box in minutes. Works well for a live demo |
| Charts | Plotly | Interactive charts that look good in the video |
| Discovery | Jupyter notebook `discovery.ipynb` | Runs the engine across all accounts |
| Tests | pytest | Locks in the judges' numbers so later changes can't break them |
| Repo | `seanyzlee/sheridan-datathon` | Private now. Make it public or zip it before submitting |

## 3. Data Model

The engine works from `monthly_summary.csv`, `loans.csv` and `accounts.csv`. The other files are only used for discovery.

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

### shock (input)
  income_factor   (1.0 = none, 0.55 = EI)
  income_months   (how long EI lasts. Shown in the plan but not used in the judges' runway formula)
  bills_pct       (+x% of H added to spending)
  spend_delta     (other monthly increase, e.g. rent in CAD)
  one_off         (CAD, or a multiple of S, e.g. "a full month of spending" = 1 × S)

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

### Joins used for discovery
- accounts → districts (unemployment, average_salary)
- accounts → loans (defaulted, as the ground truth)
- accounts → dispositions → clients (age, from birth_date)

## 4. Phases

### Phase 0 — Setup · H+0 → H+1
*Goal: Everyone can load all the data in under 5 seconds.*

- [ ] Clone the repo and add `data/` to `.gitignore` (don't commit the bank data unless the rules allow it)
- [ ] `requirements.txt`: pandas, pyarrow, streamlit, plotly, pytest, jupyter
- [ ] `load.py`: read each CSV once, cast `month` to a period and `partner_bank` to text, and write Parquet to `cache/`
- [ ] Check row counts: monthly_summary 185,326, transactions 1,056,320, loans 682, accounts 4,500
- [ ] Split the work: **A** = engine, **B** = app, **C** = discovery and story (one person can do several)

**Done when:** `python load.py` prints the row counts and Parquet files exist.

### Phase 1 — The engine matches the judges · H+1 → H+5 (A)
*Goal: `python engine.py 1234 --ei 0.55 --bills 0.15` prints the same runway the judges would get.*

- [ ] `profile(account_id)` returns I, S, F, H, B and P as defined above
- [ ] `P`: count a loan as running if `loan_start + duration_months` goes past 2025-12. Cross-check against status C/D and note any mismatch
- [ ] `runway(profile, shock)` exactly as in the formula block, including rounding and the 120 cap
- [ ] Shock presets for the three example twist cards (EI 55% for 6 months; one-off = 1 × S; EI 55% with bills +15%)
- [ ] `profiles_all()` builds a cached DataFrame for all 4,500 accounts (used by discovery and for speed)
- [ ] Edge cases: fewer than 6 months of data, I = 0, B ≤ 0, an account with no money_out
- [ ] pytest: work out 3 accounts by hand in a spreadsheet and assert the engine returns the same numbers

**Done when:** All tests pass, and every one of the 4,500 accounts runs without an error in under 1 second total from the cache.

### Phase 2 — "Know the customer" app · H+3 → H+9 (B)
*Goal: A judge types any account_id and sees the customer's position in one screen.*

- [ ] Streamlit page: account_id box (plus a "random account" button for rehearsal)
- [ ] KPI cards: income I, spending S, fixed costs F, buffer B, runway
- [ ] Chart: monthly money in and out with the buffer line (last 24 months)
- [ ] Spending breakdown: bills, insurance, loans, card, cash, other transfers
- [ ] Risk flags: days below zero, defaulted loan, buffer under 1 month of spending
- [ ] Footnote showing the definitions, so you can answer "how did you get that number?"

**Done when:** It runs locally with `streamlit run app.py` and loads any account in under 2 seconds.

### Phase 3 — "Take a shock" and "Make a plan" · H+9 → H+14 (A + B)
*Goal: Run any twist card live in under 30 seconds and explain the result.*

- [ ] Shock panel: income % slider, EI length, bills +%, rent/other +$, one-off ($ or × S), and "apply twist card" preset buttons
- [ ] Before and after: runway, with a "do they make it?" verdict for the EI length (runway ≥ EI months)
- [ ] Buffer burn-down chart: month-by-month balance after the shock, showing when it hits zero
- [ ] **Goal plan:** emergency fund target = 3 × S (6 × S if they've ever gone below zero). Months to reach it = (target − B) / surplus. If the surplus is ≤ 0, show the cut needed to get there
- [ ] **Backup plan (if the shock hits):** cut the flexible categories first (card withdrawals, genuine cash withdrawals, other transfers out) and show the cut % needed to reach 6 months of runway. Keep bills, insurance and loans fixed
- [ ] Plain-language summary of 2–3 sentences, generated from the numbers (rule-based text that sounds like an advisor)

**Done when:** All three example twists run live on 5 random accounts without errors, and each takes under 30 seconds to explain.

### Phase 4 — Discovery (35% of the score) · H+5 → H+16 (C)
*Goal: One finding across all accounts that a judge remembers, backed by a chart.*

- [ ] Run each twist across all 4,500 accounts. What % don't make it 6 months on EI? Which groups are most fragile?
- [ ] **Check against defaults:** does low runway or buffer predict loan default (`defaulted`) among the 682 loans? Report the default rate by runway band. This shows the engine measures something real
- [ ] Regional view: fragility by district against `unemployment_rate_2023` and `average_salary`
- [ ] Early warning: do `days_below_zero` or a shrinking buffer show up months before a default?
- [ ] Size shocks with Canadian sources (CPI, CMHC rent, EI maximum) and record each link in `SOURCES.md`
- [ ] Choose **one main finding** and put it on the app's landing tab as a single chart and sentence

**Done when:** The finding chart is in the app, and `discovery.ipynb` runs from start to finish.

### Rest · H+14 → H+17
Take turns: at least two people sleep in shifts while one keeps working. Don't skip this, because the live twist needs a clear head.

### Phase 5 — Rehearse the live twist · H+17 → H+20 (everyone)
*Goal: The 5-minute judging slot is practised at least 5 times.*

- [ ] Script the 1-minute pitch: the problem, the engine, then the main finding
- [ ] Do 3-minute practice runs where a teammate picks a random account and makes up a twist card
- [ ] Practise one-sentence answers: "Why median?", "Why don't you count EI length in runway?", "What if they have no income?"
- [ ] Speed: preload the cache when the app starts and remove anything that takes more than 2 seconds
- [ ] Backup plan: a screen recording and a notebook version in case the Wi-Fi or the app fails

**Done when:** A full run takes under 5 minutes, with no errors on random accounts.

### Phase 6 — Submit · H+20 → H+24
*Goal: Submitted on Devpost with an hour to spare.*

- [ ] Demo video, 2–3 minutes: pitch, one live twist, the finding
- [ ] Write-up: what the engine does and the main finding (one page)
- [ ] `SOURCES.md` and README credits: PKDD'99 Financial dataset (CTU Prague), plus every StatCan or Government of Canada link used
- [ ] README: setup in 3 commands and a screenshot
- [ ] Make the repo public (or attach a zip) and check the link in a private window
- [ ] Submit on Devpost by **H+23**

## 5. Build Order

| Phase | Hours | Owner | Output |
|-------|-------|-------|--------|
| 0 Setup | 0–1 | All | Parquet cache |
| 1 Engine | 1–5 | A | `engine.py` + tests |
| 2 Customer app | 3–9 | B | `app.py` profile view |
| 3 Shock + plan | 9–14 | A+B | Twist panel, plans |
| 4 Discovery | 5–16 | C | Finding + notebook |
| Rest | 14–17 | Shifts | — |
| 5 Rehearse | 17–20 | All | Pitch + Q&A answers |
| 6 Submit | 20–24 | All | Video, write-up, Devpost |

## 6. Deliberately Not Building

- Logins, accounts or a database. Judges need speed, not security theatre
- Deploying to the cloud. Run it locally for the demo; deploy only if there's time after H+20
- An LLM chat agent as the main interface. It's slower and can make up numbers during a live twist
- ML default prediction as the product. Use default data only to check the engine
- Parsing transactions.csv in the app. monthly_summary already has everything the engine needs

## 7. Open Questions to Settle Early (H+0 → H+2)

- **F definition:** median of each row's sum, or the sum of three medians? The plan assumes each row's sum. Ask in #ask-a-mentor
- **Loan "running at end of 2025":** use date math or status C/D? Check that they agree
- **B with fewer than 6 rows:** use the mean of all rows and show a "limited history" flag
- **Can `data/` go in the public repo?** If it's unclear, keep it out and say so in the README
