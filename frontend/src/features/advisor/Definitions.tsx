import s from './advisor.module.css';

/** Answers "how did you get that number?". Wording follows docs/ROADMAP.md §3. */
export function Definitions() {
  return (
    <section className={s.footnote} aria-labelledby="defs">
      <h2 id="defs">How the numbers are calculated</h2>
      <dl>
        <dt>I</dt>
        <dd>median(money_in) per month</dd>
        <dt>S</dt>
        <dd>median(money_out) per month</dd>
        <dt>F</dt>
        <dd>median(household_bills + insurance + loan_payments). Each row is summed, then the median is taken</dd>
        <dt>H</dt>
        <dd>median(household_bills)</dd>
        <dt>B</dt>
        <dd>mean(avg_daily_balance) over the last 6 rows, sorted by month (all rows if fewer than 6)</dd>
        <dt>P</dt>
        <dd>loans.monthly_payment if the loan is still running at 2025-12, else 0</dd>
      </dl>
      <dl>
        <dt>Runway</dt>
        <dd>
          <code>buffer_left = B − one_off; income = income_factor × I; spending = S + bills_pct × H + spend_delta; gap = spending − income</code>. If buffer_left ≤ 0: 0. If gap ≤ 0:
          no shortfall (120+). Otherwise <code>round(min(buffer_left / gap, 120), 1)</code>
        </dd>
        <dt>Breaking point</dt>
        <dd>
          For a target of T months: <code>f* = (S′ − (B − one_off) / T) / I</code>, <code>X* = B − T × gap</code>, <code>b* = ((B − one_off) / T + income − S − spend_delta) / H</code>
        </dd>
        <dt>Verdict</dt>
        <dd>Makes it if runway ≥ EI length. EI length isn’t part of the runway formula</dd>
        <dt>EI cap</dt>
        <dd>Optional: income on EI is capped at $729/week (2026 maximum, canada.ca) = $3,159/month</dd>
      </dl>
      <p className={s.footnoteNote}>
        The runway uses the judges’ formula exactly and is always the headline number. The survival probability comes from a Monte Carlo simulation (job loss, EI, income and
        spending noise, bill inflation, repairs) with a fixed seed. It adds to the runway and never replaces it.
      </p>
    </section>
  );
}
