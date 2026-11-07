# Pitch and live twist script

## 1-minute pitch

> Banks see every transaction but not the runway: how long a customer lasts when something goes wrong.
> We compute the judges' runway exactly for all 4,500 customers, then go further. A C++ engine runs 10,000
> futures per customer, and the whole bank in about half a second, so every number comes with the chance
> of making it. Tiger Data keeps it live as transactions arrive.
> And the finding: the twist itself is the early warning. Stress-testing customers against EI every month
> caught 71% of the loans that later defaulted, a median of 16 months ahead. Flagged customers defaulted
> 8 times as often.

## The live twist (3 minutes)

1. **Type the account** the judge gives you (or press Random account).
2. **Paste the twist card** in the sidebar → *Read card* → check the "Understood" line out loud → *Apply*.
   If it misreads, fix the slider by hand. Presets cover the three example cards.
3. **Say the judges' runway first**: "Runway after the shock: X months". It matches their answer.
4. Then **the chance of making it**: "...and across 10,000 futures they make the 6 months Y% of the time."
5. Then **the breaking point**: "They break if income falls below Z%."
6. Then **the plan**: the backup plan's cut, in dollars.
7. **End on the whole bank**: scroll to the strip, or open *Whole bank*: "Under this twist, N% of the bank
   drops under 3 months, recomputed for all 4,500 customers in 0.6 seconds."

## One-sentence answers

| Question | Answer |
|---|---|
| Why the median? | It's the judges' definition, and it keeps one huge month (a car sale, a bonus) from distorting a customer's typical month. |
| Why don't you count EI length in runway? | The judges' formula doesn't; we show EI length separately as "do they make it?", and the simulation does stop EI income when it ends. |
| Why C++? | One customer is one division, but the bank-wide view is 216 million simulated months per twist; C++ with OpenMP does that in 0.6 s, 357x faster than Python, so it can rerun on every slider move. |
| Where do the probabilities come from? | 10,000 simulated futures per customer using their own income and spending swings, their district's job-loss rate, EI ending, surprise repairs and Canadian CPI, calibrated against what really happened in the second half of 2025. |
| What if they have no income? | Runway is still the buffer divided by the gap; with no income the gap is all their spending. The breaking point for income shows "n/a" because there is no income to cut. |
| Isn't the default check cheating with future data? | No: the early-warning test rebuilds every profile month by month using only data available then. |
| What if the buffer is already negative? | Runway is 0, as in the judges' formula, and the plan says they need help now rather than a spending cut. |
| Does the simulation ever change the judges' number? | Never. With every random part switched off it reproduces the judges' runway on all 4,500 customers, and the app always shows the judges' number first. |

## Before judging

- [ ] `python check_cloud.py`: Tiger Data awake (10 minutes before)
- [ ] `streamlit run app.py`, open each page once to warm the caches
- [ ] Rehearse once with Wi-Fi off: the badge says "Offline cache" and every panel still works
- [ ] Plug the laptop in and close other apps: the whole-bank run is about 0.55 s on idle cores and noticeably slower under load or on battery
- [ ] Have the screen recording ready as a backup
