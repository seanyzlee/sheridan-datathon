-- Resilience Rewired: Tiger Data (TimescaleDB) schema.
-- Applied by tiger_load.py (views are in views.sql). Safe to rerun: it drops and recreates everything.
--
-- Rules reverse-engineered from the CSVs and checked in tests/test_tiger.py:
--   * monthly category columns are fixed filters on operation / purpose (exact match)
--   * an account's months run from its first to its last transaction month
--   * the end-of-day balance is the day's last transaction in the balance chain
--     (the original within-day order is not in the data, so we find the row whose
--     balance is not the "balance before" of any other row that day)
--   * daily balances carry forward over quiet days to the end of the last month

DROP VIEW IF EXISTS profile_live, monthly_live, monthly_balance, daily_eod CASCADE;
DROP MATERIALIZED VIEW IF EXISTS monthly_flows CASCADE;
DROP TABLE IF EXISTS transactions, monthly_summary, accounts, loans, districts CASCADE;

-- --------------------------------------------------------------------------- plain tables

CREATE TABLE districts (
    district_id              BIGINT PRIMARY KEY,
    district_name            TEXT,
    region                   TEXT,
    average_salary           DOUBLE PRECISION,
    unemployment_rate_2023   DOUBLE PRECISION
);

CREATE TABLE accounts (
    account_id      BIGINT PRIMARY KEY,
    district_id     BIGINT NOT NULL,
    frequency       TEXT,
    account_opened  DATE
);

CREATE TABLE loans (
    loan_id          BIGINT PRIMARY KEY,
    account_id       BIGINT NOT NULL UNIQUE,
    loan_start       DATE NOT NULL,
    amount           NUMERIC(14, 2) NOT NULL,
    duration_months  INTEGER NOT NULL,
    monthly_payment  NUMERIC(14, 2) NOT NULL,
    status           TEXT NOT NULL,
    defaulted        BOOLEAN NOT NULL
);

-- --------------------------------------------------------------------------- hypertables

-- ~1M rows over 6 years. One-year chunks keep ~40 rows per account per chunk.
CREATE TABLE transactions (
    transaction_id   BIGINT NOT NULL,
    account_id       BIGINT NOT NULL,
    date             DATE NOT NULL,
    direction        TEXT NOT NULL,
    operation        TEXT NOT NULL,
    purpose          TEXT,
    amount           NUMERIC(14, 2) NOT NULL,
    signed_amount    NUMERIC(14, 2) NOT NULL,
    balance          NUMERIC(14, 2) NOT NULL,
    partner_bank     TEXT,
    partner_account  TEXT,
    PRIMARY KEY (transaction_id, date)
) WITH (
    tsdb.hypertable,
    tsdb.partition_column = 'date',
    tsdb.chunk_interval = '1 year',
    tsdb.enable_columnstore = true,
    tsdb.segmentby = 'account_id',
    tsdb.orderby = 'date DESC, transaction_id DESC'
);
CREATE INDEX transactions_account_date ON transactions (account_id, date DESC);

-- The challenge's own monthly table, loaded only to check monthly_live against it.
CREATE TABLE monthly_summary (
    account_id                BIGINT NOT NULL,
    month                     DATE NOT NULL,
    money_in                  NUMERIC(14, 2),
    money_out                 NUMERIC(14, 2),
    cash_deposits             NUMERIC(14, 2),
    transfers_in              NUMERIC(14, 2),
    pension_in                NUMERIC(14, 2),
    interest_in               NUMERIC(14, 2),
    household_bills           NUMERIC(14, 2),
    insurance                 NUMERIC(14, 2),
    loan_payments             NUMERIC(14, 2),
    bank_fees                 NUMERIC(14, 2),
    cash_withdrawals_genuine  NUMERIC(14, 2),
    card_withdrawals          NUMERIC(14, 2),
    transfers_out_other       NUMERIC(14, 2),
    month_end_balance         NUMERIC(14, 2),
    min_balance               NUMERIC(14, 2),
    avg_daily_balance         NUMERIC(14, 2),
    days_below_zero           INTEGER,
    PRIMARY KEY (account_id, month)
) WITH (
    tsdb.hypertable,
    tsdb.partition_column = 'month',
    tsdb.chunk_interval = '1 year',
    tsdb.enable_columnstore = true,
    tsdb.segmentby = 'account_id',
    tsdb.orderby = 'month DESC'
);

-- --------------------------------------------------------------------------- continuous aggregate

-- Monthly money in/out by category. Real-time, so rows newer than the last refresh still show;
-- replay.py refreshes the replayed month because it writes into already-materialized months.
CREATE MATERIALIZED VIEW monthly_flows
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    account_id,
    time_bucket(INTERVAL '1 month', date) AS month,
    count(*)                                                                                   AS n_txn,
    coalesce(sum(amount) FILTER (WHERE direction LIKE 'credit%'), 0)                           AS money_in,
    coalesce(sum(amount) FILTER (WHERE direction NOT LIKE 'credit%'), 0)                       AS money_out,
    coalesce(sum(amount) FILTER (WHERE operation = 'cash deposit'), 0)                         AS cash_deposits,
    coalesce(sum(amount) FILTER (WHERE operation = 'transfer in from another bank'
                                   AND purpose IS NULL), 0)                                    AS transfers_in,
    coalesce(sum(amount) FILTER (WHERE purpose = 'pension'), 0)                                AS pension_in,
    coalesce(sum(amount) FILTER (WHERE operation = 'interest'), 0)                             AS interest_in,
    coalesce(sum(amount) FILTER (WHERE purpose = 'household bills'), 0)                        AS household_bills,
    coalesce(sum(amount) FILTER (WHERE purpose = 'insurance'), 0)                              AS insurance,
    coalesce(sum(amount) FILTER (WHERE purpose = 'loan payment'), 0)                           AS loan_payments,
    coalesce(sum(amount) FILTER (WHERE operation = 'bank fee'), 0)                             AS bank_fees,
    coalesce(sum(amount) FILTER (WHERE operation = 'cash withdrawal'), 0)                      AS cash_withdrawals_genuine,
    coalesce(sum(amount) FILTER (WHERE operation = 'card withdrawal'), 0)                      AS card_withdrawals,
    coalesce(sum(amount) FILTER (WHERE operation = 'transfer out to another bank'
                                   AND purpose IS NULL), 0)                                    AS transfers_out_other
FROM transactions
GROUP BY account_id, time_bucket(INTERVAL '1 month', date)
WITH NO DATA;

-- No retention: the dataset is historical and small. No refresh policy either: the data only
-- changes when tiger_load.py or replay.py write, and both refresh explicitly.

