# Resilience Rewired: write-up

## The problem

A bank sees every transaction but not the one thing that matters in a crisis: how long each customer can keep going. We turn 1 million transactions into, for each customer, the judges' runway, a probability of making it, and a plan to make it more likely.

## What the engine does

1. **The judges' runway, exactly.** From the monthly summary we compute I (median money in), S (median money out), F (median fixed costs), H (median bills), B (mean daily balance over the last 6 months) and P (loan payment if the loan runs past Dec 2025). Then runway = (B − one-off) / (spending − income), with the judges' rounding and 120-month cap. It's tested against three hand-worked accounts and runs all 4,500 customers in under a second.
2. **Survival probability.** Around that number, a simulation runs 10,000 futures per customer. Each future adds that customer's own month-to-month swings, a chance of losing their job (from their district's unemployment rate), EI running out, surprise repairs and bill inflation (Canadian CPI). Switch all of that off and it lands exactly on the judges' runway, so it adds to the number and never replaces it.
3. **Breaking point and plans.** The formula run in reverse gives the income level, one-off cost or bills rise that would break the customer. The backup plan cuts flexible spending (card, cash, other transfers) first and keeps bills, insurance and loans fixed.

## Main finding: the twist is the early warning

We replayed every loan customer month by month, using only the data the bank had at each point. A customer is flagged when their runway **under the EI twist** drops below 2 months.

| | |
|---|---|
| Defaults caught | **71%** of the 76 loans that defaulted |
| Warning time | median **16 months** before the default was on record |
| Default rate if flagged | **35%** |
| Default rate if not flagged | **4.2%** (8x lower) |
| Good loans flagged | 17% |

The judges' twist isn't just a what-if: it's the best early-warning signal we found, better than the no-shock runway (which catches 37%). Today's runway also separates defaulters sharply: 80% of loans with under 3 months of runway defaulted, against 8% with no shortfall.

*Caveat:* the dataset doesn't date the default itself. We treat it as on record at the loan's end for finished loans and in Dec 2025 for running ones, so the true warning time may be shorter.

### What else the data says

- **Higher earners are the most exposed to job loss.** 70% of the top income band can't last 6 months on EI, against 4% of the bottom band. Their spending is high relative to their buffer, so losing 45% of income opens a big gap. Customers 60+ are the safest (9%).
- **No tipping point for bills.** On EI, the share under 3 months rises smoothly from 10% to 16% as bills go up 0–50%. The income loss does the damage, not the bills.
- **The postcode doesn't matter.** Across 77 districts, fragility barely moves with unemployment (r = 0.06) or salary (r = −0.05).
- **Canada's EI cap bites.** 57% of customers earn more than the $729/week maximum covers; applying it pushes another 16% below 6 months on EI.

## How the C++ core works

The simulation is C++17 with OpenMP, called from Python through pybind11 with NumPy arrays passed in and out without copying.

- **Parallel across customers.** OpenMP splits the 4,500 customers across cores (dynamic schedule, because customers who run out early finish early). The GIL is released for the whole run.
- **Reproducible randomness.** Each (customer, path) gets its own xoshiro256+ generator seeded from (seed, customer, path), so the answer is identical on 1 or 8 threads and the same twist always gives the same answer on stage.
- **Fast normals.** A 16,384-cell inverse-CDF table with linear interpolation gives two normals per 64-bit draw. It's 5x faster than Box–Muller, and its ±3.8σ clipping changes the variance by under 0.1%.
- **Same model in NumPy.** `sim_numpy.py` is the reference and the fallback. Tests check that both backends land on the judges' runway with noise off and agree within 1 point with noise on.

| Method | Whole bank (216M simulated months) | Speed-up |
|---|---|---|
| Pure Python loop | 3.3 min | 1x |
| NumPy | 17.5 s | 11x |
| C++, 1 thread | 3.7 s | 54x |
| C++, 8 threads | **0.56 s** | **357x** |

**Calibrated, not guessed.** We built profiles from data up to June 2025, simulated 6 months, and compared with what really happened (1.8% of customers ended a month at or below zero). Drawing each month with a customer's full volatility predicted 13% and scored worse than the plain formula. Real spending is lumpy but evens out. With swings scaled to 30%, the simulation beats the formula's own Brier score (0.0228 vs 0.0284).

## Live data with Tiger Data

Transactions live in a TimescaleDB hypertable (1-year chunks, columnstore segmented by account). A real-time continuous aggregate rebuilds every monthly category total, and plain SQL views rebuild the daily balances and the judges' profile with exact medians (`percentile_cont`).

- `monthly_live` reproduces the challenge's monthly table exactly on every flow column for all 185,326 account-months. The balance columns are within a cent on all but 23 account-months, where the order of same-day transactions is ambiguous in the data. We recover the order from the balance chain.
- `profile_live` matches the engine on every customer and answers in about 35 ms.
- `replay.py` streams a customer's transactions back in, month by month. The app's live panel moves within a second of each month, and the data ends exactly as it started.

Everything the live twist needs also runs from a local Parquet cache, so the demo survives a Wi-Fi failure.

## Architecture

```
CSVs ──► load.py ──► Parquet cache ──────────────┐ (offline fallback)
                 └─► tiger_load.py ──► Tiger Data (hypertables, continuous aggregate, profile_live)
replay.py ──────────────────────────► Tiger Data   (live feed)

app.py (Streamlit)
  ├─ customer profile + judges' runway ◄── tiger_client.py (Tiger Data, or Parquet)
  ├─ survival + whole-bank panels      ◄── simulate.py (resil_hpc C++, or sim_numpy)
  ├─ twist card reader                 ◄── twist.py (rules)
  └─ main finding, time machine        ◄── discovery.py
```
