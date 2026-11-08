# Toonie: write-up (Tangerine "Resilience Rewired" challenge)

**Biggest finding:** the judges' EI twist is not just a what-if; it is an early-warning signal. A customer whose runway on EI drops below 2 months is 8 times as likely to default on their loan, and the flag catches 71% of defaults a median of 15.5 months before they are on record.

## What the engine does

For each of the bank's 4,500 customers, the engine answers: if a shock hits, how long do their savings last, how likely are they to make it, and what would help most.

1. **The judges' runway, exactly.** From the monthly summary it computes I (typical income), S (typical spending), F (typical fixed costs), H (typical household bills), B (savings, averaged over the last 6 months) and P (the loan payment, if the loan is still running). A shock changes income, spending or savings, and runway is savings left divided by the monthly gap, capped at 120 months. Example: account 20111 has $17,612 saved and spends $8,600 a month; on EI their income falls to $3,487, so the savings last 3.4 months instead of 7.8.
2. **The chance of making it.** A simulation runs 10,000 futures per customer with their own month-to-month swings, a chance of job loss from their district's unemployment rate, EI running out, surprise repairs and inflation. With the randomness switched off, it lands on the judges' runway for every customer; with it on, it beat the plain formula when backtested against what really happened in late 2025.
3. **What would help.** The breaking point runs the formula backwards (how much income loss or one-off cost they can absorb). Shock Autopilot spots an income drop in the latest month and ranks real spending cuts from the customer's own history by the months each one adds.

Every formula, our reading of each definition, and the worked numbers are in [HOW_IT_WORKS.md](HOW_IT_WORKS.md). Our numbers match the judges' everywhere the runway is concerned; the two places we had to interpret the wording (F, and when a loan counts as running) are explained there and do not change any runway.

## The finding in detail

We replayed every loan customer month by month, using only the data the bank had at each point, and flagged a customer the first time their runway under the EI twist (income at 55%) fell below 2 months.

| | |
|---|---|
| Defaults caught | **71.1%** of the 76 loans that defaulted |
| Warning time | median **15.5 months** before the default is on record |
| Default rate when flagged | **34.6%** (156 customers flagged) |
| Default rate when not flagged | **4.2%** |
| Good loans flagged | 16.8% |

The twist is what makes it work. The same test on today's runway, with no shock, catches only 37% of defaults with a 3-month line, and 57% with a 6-month line. Today's runway still sorts customers clearly: 80% of loans with under 3 months of runway defaulted, against 21% at 6 to 12 months and 8% where income covers spending.

**Caveat:** the dataset does not date the default itself. We treat it as on record when a finished loan ended, and in December 2025 for loans still running, so the true warning time may be shorter.

## Why it matters for the bank

- **Under the twist, fragility jumps.** Under 3 months of runway: 1.3% of customers today, 9.7% on EI for 6 months, 11.2% on EI with bills up 15%.
- **Real EI is worse than the twist.** EI pays at most $729 a week. 57% of customers earn more than that covers, and applying the cap pushes another 16% of all customers below 6 months.
- **The bank can act early.** Autopilot finds 350 customers whose latest month's income is under 60% of normal, today, and offers each a plan built from their own spending.
