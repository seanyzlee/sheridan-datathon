-- Live views over the transactions hypertable. Applied by tiger_load.py after schema.sql;
-- rerun on its own with `python tiger_load.py --views`.

DROP VIEW IF EXISTS profile_live, monthly_live, monthly_balance, daily_eod CASCADE;

-- --------------------------------------------------------------------------- balances

-- End-of-day balance: the row whose balance no other same-day row starts from.
CREATE VIEW daily_eod AS
WITH links AS (
    SELECT k.account_id, k.date, k.transaction_id, k.balance,
           min(abs(k.balance - (j.balance - j.signed_amount))) AS link
    FROM transactions k
    LEFT JOIN transactions j
           ON j.account_id = k.account_id AND j.date = k.date AND j.transaction_id <> k.transaction_id
    GROUP BY k.account_id, k.date, k.transaction_id, k.balance
)
SELECT DISTINCT ON (account_id, date) account_id, date, balance
FROM links
ORDER BY account_id, date, link DESC NULLS FIRST, transaction_id DESC;

-- Daily balances carried forward (LOCF) from the first transaction day to the end of the
-- last transaction month, then summarised per month.
CREATE VIEW monthly_balance AS
WITH spine AS (
    SELECT account_id,
           generate_series(min(date),
                           (date_trunc('month', max(date)) + INTERVAL '1 month - 1 day')::date,
                           INTERVAL '1 day')::date AS day
    FROM daily_eod
    GROUP BY account_id
), joined AS (
    SELECT s.account_id, s.day, e.balance,
           count(e.balance) OVER (PARTITION BY s.account_id ORDER BY s.day) AS grp
    FROM spine s
    LEFT JOIN daily_eod e ON e.account_id = s.account_id AND e.date = s.day
), filled AS (
    SELECT account_id, day,
           first_value(balance) OVER (PARTITION BY account_id, grp ORDER BY day) AS bal
    FROM joined
)
SELECT account_id,
       date_trunc('month', day)::date                   AS month,
       round(avg(bal), 2)                               AS avg_daily_balance,
       min(bal)                                         AS min_balance,
       (array_agg(bal ORDER BY day DESC))[1]            AS month_end_balance,
       (count(*) FILTER (WHERE bal < 0))::int           AS days_below_zero
FROM filled
GROUP BY account_id, date_trunc('month', day);

-- Same columns as monthly_summary, built live from transactions.
-- Months with no transactions get zero flows and the carried-forward balance.
CREATE VIEW monthly_live AS
SELECT b.account_id,
       b.month,
       coalesce(f.money_in, 0)                  AS money_in,
       coalesce(f.money_out, 0)                 AS money_out,
       coalesce(f.cash_deposits, 0)             AS cash_deposits,
       coalesce(f.transfers_in, 0)              AS transfers_in,
       coalesce(f.pension_in, 0)                AS pension_in,
       coalesce(f.interest_in, 0)               AS interest_in,
       coalesce(f.household_bills, 0)           AS household_bills,
       coalesce(f.insurance, 0)                 AS insurance,
       coalesce(f.loan_payments, 0)             AS loan_payments,
       coalesce(f.bank_fees, 0)                 AS bank_fees,
       coalesce(f.cash_withdrawals_genuine, 0)  AS cash_withdrawals_genuine,
       coalesce(f.card_withdrawals, 0)          AS card_withdrawals,
       coalesce(f.transfers_out_other, 0)       AS transfers_out_other,
       b.month_end_balance,
       b.min_balance,
       b.avg_daily_balance,
       b.days_below_zero
FROM monthly_balance b
LEFT JOIN monthly_flows f ON f.account_id = b.account_id AND f.month = b.month;

-- --------------------------------------------------------------------------- profile

-- The judges' profile, live. Exact medians (percentile_cont), not toolkit approximations.
-- Matches engine.profile(); see tests/test_tiger.py.
--
-- B: the balance rebuilt from transactions (b_live) is within a cent of the challenge's
-- avg_daily_balance on all but ~20 account-months, where the within-day order is ambiguous.
-- So the headline B uses the challenge's avg_daily_balance for the same last 6 months that
-- monthly_live currently shows (exact, and it still moves during a replay).
CREATE VIEW profile_live AS
WITH m AS (
    SELECT ml.*, ms.avg_daily_balance AS adb_summary,
           row_number() OVER (PARTITION BY ml.account_id ORDER BY ml.month DESC) AS rn
    FROM monthly_live ml
    LEFT JOIN monthly_summary ms ON ms.account_id = ml.account_id AND ms.month = ml.month
), p AS (
    SELECT account_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY money_in::float8)                    AS i,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY money_out::float8)                   AS s,
           percentile_cont(0.5) WITHIN GROUP (
               ORDER BY (household_bills + insurance + loan_payments)::float8)              AS f,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY household_bills::float8)             AS h,
           avg(coalesce(adb_summary, avg_daily_balance)::float8) FILTER (WHERE rn <= 6)    AS b,
           avg(avg_daily_balance::float8) FILTER (WHERE rn <= 6)                            AS b_live,
           count(*)::int                                                                    AS months_of_data,
           coalesce(sum(days_below_zero) FILTER (WHERE rn <= 6), 0)::float8                 AS days_below_zero_6m,
           max(month)                                                                       AS last_month
    FROM m
    GROUP BY account_id
)
SELECT p.*,
       l.loan_id IS NOT NULL                                                                AS has_loan,
       coalesce((date_trunc('month', l.loan_start) + make_interval(months => l.duration_months))
                > DATE '2025-12-01', false)                                                 AS loan_running,
       CASE WHEN (date_trunc('month', l.loan_start) + make_interval(months => l.duration_months))
                 > DATE '2025-12-01' THEN l.monthly_payment::float8 ELSE 0 END             AS p,
       coalesce(l.defaulted, false)                                                         AS defaulted
FROM p
LEFT JOIN loans l ON l.account_id = p.account_id;
