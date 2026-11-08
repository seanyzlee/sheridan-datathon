# How Toonie works

Toonie answers one question for each of the bank's 4,500 customers: if money stopped coming in, how long would their savings last, how likely are they to make it, and what would help most. The headline figure, the runway, is the judges' formula computed exactly. Everything else (the chance of making it, the breaking point, Shock Autopilot's recovery plan, the whole-bank stress test) is built around that figure and never replaces it.

This document defines every number the app shows, with the formula, where it lives in the code, and where our definition differs from the judges' and why. Setup and code layout are in the [README](../README.md); the short summary is in [WRITEUP.md](WRITEUP.md).

## The data underneath

One table drives the headline numbers: `monthly_summary.csv`, one row per customer per month, 185,326 rows from 2020-01 to 2025-12. Each customer has between 12 and 72 months of history (median 36). `loans.csv` adds 682 loans (448 still running at the end of 2025, 76 defaulted), and `accounts.csv` plus `districts.csv` add each customer's district and its unemployment rate.

## The six profile numbers

These are computed once per customer in `engine.py` (`_build_profiles`) and match the judges' table.

| Number | In plain words | Definition | Same as the judges? |
|---|---|---|---|
| **I**, income | Money coming in, in a typical month | Median of `money_in` over all the customer's months | Yes |
| **S**, spending | Money going out, in a typical month | Median of `money_out` over all months | Yes |
| **F**, fixed costs | Bills you can't skip | Median, over all months, of each month's `household_bills + insurance + loan_payments` | Yes, reading the wording as "sum each month, then take the median" (see below) |
| **H**, household bills | Rent and utilities | Median of `household_bills` | Yes |
| **B**, buffer | Savings to fall back on | Mean of `avg_daily_balance` over the customer's last 6 rows, sorted by month | Yes |
| **P**, loan payment | The monthly loan payment | `monthly_payment` from `loans.csv` if the loan is still running after December 2025, otherwise 0 | Yes |

Medians make I, S, F and H describe a normal month: one bonus or one big purchase moves a median very little, where it would drag an average.

**F, two readings.** "Median of household_bills + insurance + loan_payments" can mean the median of each month's total, or the sum of three separate medians. We add the three costs within each month first, then take the median, because that is the cost of an actual typical month. The two readings disagree for 26 of the 4,500 customers, by a median of $535. F is shown on screen but is not part of the runway formula, so the runway is the same under either reading.

**B with short histories.** If a customer had fewer than 6 months of data, B would be the mean of all their months. No customer in this dataset has fewer than 12 months, so the rule never triggers.

**P, when a loan counts as running.** A loan is running if `loan_start + duration_months` falls after December 2025. This date rule agrees with the loan status codes (C and D mean running) on all 682 loans; reading "at the end of 2025" as "on or after December 2025" would disagree on 11.

### Worked example: account 20111

| I | S | F | H | B | P |
|---|---|---|---|---|---|
| $6,339.39 | $8,599.61 | $2,330.06 | $0.00 | $17,611.86 | $2,330.19 |

This customer spends $2,260 a month more than comes in, has no household bills recorded, and has a loan still running (it is also one of the 76 that defaulted).

## Runway: how long the savings last

Runway is the judges' formula, implemented in `engine.runway()`:

```
buffer_left = B - one_off
income      = income_factor x I            (optionally capped at the EI maximum, see below)
spending    = S + bills_pct x H + other_increase
gap         = spending - income

if buffer_left <= 0:  runway = 0
elif gap <= 0:        runway = "no shortfall"  (shown as 120+ months)
else:                 runway = min(buffer_left / gap, 120), rounded to 1 decimal
```

A shock is a set of levers, each of which moves one term:

| Lever | What it changes | Example |
|---|---|---|
| Income factor | `income = factor x I` | Job loss on EI: 0.55 |
| Bills increase | `spending += bills_pct x H` | Bills up 15%: 0.15 |
| Other increase | `spending += amount` | Rent up $300 a month |
| One-off cost | `buffer_left = B - amount` | A $2,500 car repair |
| One-off in months of spending | `buffer_left = B - k x S` | "A full month of spending": k = 1 |
| EI length | Not in the runway; sets the target (see below) | EI for 6 months |
| EI weekly maximum | Caps income on EI (off by default, see below) | $729 a week |

### Worked example: account 20111 loses their job

Today: `17,611.86 / (8,599.61 - 6,339.39) = 7.79`, so the runway is **7.8 months**.

On EI at 55%: income becomes `0.55 x 6,339.39 = 3,486.66`, the gap becomes `8,599.61 - 3,486.66 = 5,112.94`, and the runway is `17,611.86 / 5,112.94 = 3.44`, so **3.4 months**.

### Why EI length is not in the runway

The judges' formula assumes the shocked income lasts forever. We keep it that way for the headline number, and use the EI length for two things instead: the **target** the customer has to reach (lasting the whole EI period, or 6 months if no length is given), and the **verdict** "does the runway cover the EI months?".

### How runway is checked

- `tests/test_engine.py` computes three accounts (20111, 20396, 36407) by hand from the raw CSVs without pandas and asserts the engine returns the same profile and runway, plus edge cases (no income, a buffer at or below zero, no spending).
- The Tiger Data view `profile_live` recomputes I, S, F, H, B and P in SQL with exact medians (`percentile_cont`) and matches the engine on every customer (`tests/test_tiger.py`).
- All 4,500 runways compute in well under a second (`engine.runway_vec`).

Across the whole bank with no shock, 73.7% of customers have no shortfall (income covers spending), 2.7% have under 6 months of runway, 1.3% under 3 months, and 0.5% have already run out.

## Numbers we added

The judges' formula answers "how long". These add "how likely", "how much more could they take" and "what should they do". Each one is defined in code and tested.

### EI weekly maximum (Canadian realism)

Employment Insurance pays 55% of insurable earnings up to a weekly maximum, $729 in 2026 (canada.ca, see [SOURCES.md](../SOURCES.md)). With the cap switched on:

```
income on EI = min(0.55 x I, 729 x 52 / 12) = min(0.55 x I, 3,159 a month)
```

It is off by default so the headline matches the judges. 57% of customers earn more than the cap covers, and switching it on pushes another 16% of all customers below 6 months on EI.

### Chance of making it (the simulation)

The runway is one straight-line answer. Real months swing, jobs are lost at random, and things break. The simulation (`hpc/src/resil.cpp` in C++, with the same model in `sim_numpy.py` as the reference and fallback) runs 10,000 possible futures for one customer, or 2,000 for each of the 4,500 customers in the whole-bank view, over 24 months. One future, one month:

```
start:     balance = B - one_off
income:    the shocked income for the EI months, then 0 (no new job is assumed)
           with no forced shock: full income, with a monthly chance of losing the job
           (p_job), then 55% of income for 6 months, then 0
spending:  S + bills_pct x H (growing with CPI, 2.8% a year) + other_increase
swings:    income and spending each get a random swing, sized at 30% of the customer's own
           month-to-month standard deviation over their last 24 months
repairs:   a 1% chance each month of a one-off repair costing 0.25 to 1 month of spending
balance   += income - spending
```

The **chance of making it** is the share of futures whose balance stays above zero for the target number of months.

- `p_job` comes from the customer's district: a yearly unemployment rate `u` becomes a monthly chance `1 - (1 - u)^(1/12)`.
- The 30% swing size is calibrated, not guessed. We built every profile from data up to June 2025, simulated the next 6 months, and compared with what happened: 1.8% of 4,116 customers ended a month at or below zero. Full-size swings predicted 12.6% (Brier score 0.0451). The judges' formula alone predicted 2.7% (Brier 0.0284). 30% swings predicted 4.8% and scored best (Brier 0.0228).
- **It agrees with the judges.** With every random part switched off, the month the balance first reaches zero equals the judges' runway to within 0.05 months, for every customer, on both the C++ and NumPy versions (`tests/test_sim.py`). The seed is fixed, so the same shock always gives the same chance.

### Breaking point

The runway formula run backwards (`engine.breaking_point`). Each limit moves one lever and holds the rest of the shock as it is, for a target of T months:

```
lowest income they can take:     f* = (spending - (B - one_off) / T) / I
largest one-off cost:            X* = B - T x gap
largest bills increase:          b* = ((B - one_off) / T + income - S - other_increase) / H
```

If the shock already takes them under T months, the app says so instead.

### Shock Autopilot

The feature no Canadian bank we looked at offers (`autopilot.py`). It has two parts.

**Detection.** If the latest month's `money_in` is under 60% of the customer's usual income I, Autopilot flags an income shock and offers to plan for it, using the observed drop as the income factor. It reads the customer's own months, from the live Tiger Data feed or the offline cache. 350 of the 4,500 customers show such a drop in their latest month.

**The recovery ladder.** Each step is a real spending category, priced from the median of the customer's last 12 months:

| Step | Monthly saving |
|---|---|
| Pause transfers to other accounts | median of `transfers_out_other` |
| Spend a quarter less on the card | 25% of the median of `card_withdrawals` |
| Take out a quarter less cash | 25% of the median of `cash_withdrawals_genuine` |
| Ask us to defer the loan payment | P, if a loan is running |

Each step's saving lowers spending in the judges' formula (it acts as a negative "other increase"). The ladder shows the months each step adds when the steps are taken in order, and when the customer switches any combination on, the API recomputes the runway with `engine.runway` and the chance with the simulation.

Example, account 20396 on EI for 6 months: the runway is 2.3 months; pausing transfers ($1,734 a month) adds 1.0 month, and taking out a quarter less cash ($2,045 a month) adds 3.1 more, reaching 6.4 months and clearing the 6-month target.

### Plans

`plan.py`:

- **Emergency fund goal:** 3 months of spending (`3 x S`), or 6 months (`6 x S`) if the balance has ever gone below zero. Months to get there: `(target - B) / (I - S)` when there is a surplus; otherwise the monthly cut that reaches it in 12 months.
- **Backup plan:** the cut to flexible spending that brings the runway to 6 months, `gap - (B - one_off) / 6`, shown as a share of flexible spending. Flexible spending is `S x flex_share`, where `flex_share` is the customer's card, cash and other-transfer spending as a share of `money_out` over their last 24 months. Bills, insurance and loans stay fixed.

### Peer comparison

The customer's buffer in months of spending (`B / S`) compared with customers in the same region and the same income band (fifths of I across the bank): "more than X% of similar customers".

### Whole bank

Every customer under the same shock (`engine.runway_vec` and `simulate.bank`): the share under 3 months of runway, the share already out of money, and the average simulated chance of running out. The stress surface computes the share under 3 months for 546 shocks (income kept from 100% down to 0% in 5% steps, times bills up 0% to 50% in 2% steps), holding the rest of the current shock fixed.

## How we check the numbers

| Check | Where | Result |
|---|---|---|
| Profile and runway against hand-worked accounts | `tests/test_engine.py` | Exact |
| Tiger Data SQL profile against the engine | `tests/test_tiger.py` | Exact on every customer |
| Simulation with randomness off against the judges' runway | `tests/test_sim.py` | Within 0.05 months, every customer, both backends |
| C++ against NumPy with randomness on | `tests/test_sim.py` | Within 1 percentage point |
| Every API figure against the engine | `tests/test_api.py`, `tests/test_autopilot.py` | Exact |
| The assistant never states a figure the engine didn't produce | `assistant.py`, `tests/test_assistant.py` | Every number in a reply is checked against tool results |

## Where we differ from the judges

| Topic | Judges | Toonie | Why | Effect on the headline runway |
|---|---|---|---|---|
| F | "Median of bills + insurance + loan payments" | Median of each month's total | A typical month's real fixed cost | None (F is not in the runway); F differs for 26 customers |
| Loan running | "Still running at the end of 2025" | Start + duration after December 2025 | Matches the status codes on all 682 loans | None |
| EI maximum | Not applied | Optional, off by default | Real EI is capped at $729 a week | None unless switched on |
| One-off "a month of spending" | A dollar amount | Also accepts multiples of S | Twist cards are worded that way | None (same formula) |
| EI length | Not in the runway | Sets the target and the verdict | The runway assumes the shock lasts forever | None |
| Chance of making it, breaking point, Autopilot, plans | Not defined | Added | Answers "how likely" and "what helps" | None; they never replace the runway |
