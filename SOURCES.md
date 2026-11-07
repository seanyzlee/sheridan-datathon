# Sources

## Data

- **PKDD'99 Financial dataset** (Discovery Challenge, CTU Prague): accounts, transactions, loans, clients, districts, cards and standing orders of a Czech bank, as prepared and re-dated by the Sheridan Datathon 2026 organisers. Used under the challenge's rules; not redistributed here.

## Canadian figures used in the simulation (D8)

| Figure | Value | Used for | Source |
|---|---|---|---|
| EI maximum weekly benefit, 2026 | $729 per week (maximum insurable earnings $68,900) | The "EI weekly maximum" toggle and the EI cap finding | Government of Canada, [EI regular benefits: how much you could receive](https://www.canada.ca/en/services/benefits/ei/ei-regular-benefit/benefit-amount.html); [2026 maximum insurable earnings notice](https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/ei-employers/premium-reduction-program/2026-maximum-insurable-earnings.html) |
| EI benefit rate | 55% of insurable earnings | The judges' EI twist and random job loss in the simulation | Same as above |
| CPI, 12-month change | 2.8% (April 2026) | Monthly growth of the bills increase in the simulation | Statistics Canada, [The Daily, 19 May 2026](https://www150.statcan.gc.ca/n1/daily-quotidien/260519/cg-a004-eng.htm), table 18-10-0004-01 |

> The CPI figure is the latest Statistics Canada release we could confirm while building; check
> [table 18-10-0004-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810000401) for a newer one before judging and update `CPI_ANNUAL` in `risk.py`.

## Assumptions we made (not from a source)

- **Monthly job-loss chance** = 1 − (1 − district unemployment rate)^(1/12), using the district's 2023 rate.
- **EI after a random job loss** lasts 6 months, then income is 0 until the end of the simulation.
- **Noise and repairs** were calibrated by a backtest (`discovery.backtest()`), not taken from a source: noise at 30% of each customer's month-to-month volatility, and a 1% monthly chance of a repair costing 0.25 to 1 month of spending.
