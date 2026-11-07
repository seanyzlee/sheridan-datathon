"""Load the Parquet cache into Tiger Data and build the live views.

Usage:
    python tiger_load.py            # (re)create the schema, load every table, refresh aggregates
    python tiger_load.py --views    # only recreate the views in tiger/views.sql
    python tiger_load.py --check    # only compare monthly_live with monthly_summary

Needs TIGER_DATABASE_URL in .env. The schema is in tiger/schema.sql.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd

from load import load_table
from tiger_client import connect

ROOT = Path(__file__).resolve().parent
SCHEMA = ROOT / "tiger" / "schema.sql"
VIEWS = ROOT / "tiger" / "views.sql"

TABLES = {
    "districts": ["district_id", "district_name", "region", "average_salary", "unemployment_rate_2023"],
    "accounts": ["account_id", "district_id", "frequency", "account_opened"],
    "loans": ["loan_id", "account_id", "loan_start", "amount", "duration_months", "monthly_payment", "status",
              "defaulted"],
    "monthly_summary": ["account_id", "month_start", "money_in", "money_out", "cash_deposits", "transfers_in",
                        "pension_in", "interest_in", "household_bills", "insurance", "loan_payments", "bank_fees",
                        "cash_withdrawals_genuine", "card_withdrawals", "transfers_out_other", "month_end_balance",
                        "min_balance", "avg_daily_balance", "days_below_zero"],
    "transactions": ["transaction_id", "account_id", "date", "direction", "operation", "purpose", "amount",
                     "signed_amount", "balance", "partner_bank", "partner_account"],
}

FLOW_COLUMNS = TABLES["monthly_summary"][2:15]
BALANCE_COLUMNS = TABLES["monthly_summary"][15:]


def _prepare(name: str) -> pd.DataFrame:
    df = load_table(name)[TABLES[name]].copy()
    if name == "loans":
        df["defaulted"] = df["defaulted"].astype(bool)
    if name == "monthly_summary":
        df = df.rename(columns={"month_start": "month"})
        df["days_below_zero"] = df["days_below_zero"].astype(int)
    for c in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[c]):
            df[c] = df[c].dt.date
    return df


def copy_frame(conn, table: str, df: pd.DataFrame) -> None:
    cols = ", ".join(df.columns)
    with conn.cursor() as cur, cur.copy(f"COPY {table} ({cols}) FROM STDIN") as cp:
        for row in df.itertuples(index=False, name=None):
            cp.write_row([None if pd.isna(v) else v for v in row])


def refresh_flows(conn, start: str | None = None, end: str | None = None) -> None:
    """Refresh the monthly_flows continuous aggregate (must run outside a transaction)."""
    conn.execute("CALL refresh_continuous_aggregate('monthly_flows', %s::date, %s::date)", (start, end))


def check(conn) -> pd.DataFrame:
    """Rows where monthly_live differs from monthly_summary (flows exactly, balances by more than 1 cent)."""
    flow = " OR ".join(f"l.{c} IS DISTINCT FROM s.{c}" for c in FLOW_COLUMNS)
    bal = " OR ".join(f"abs(l.{c} - s.{c}) > 0.011" for c in BALANCE_COLUMNS[:3])
    sql = f"""
        SELECT coalesce(l.account_id, s.account_id) AS account_id, coalesce(l.month, s.month) AS month,
               l.account_id IS NULL AS missing_live, s.account_id IS NULL AS extra_live,
               ({flow}) AS flow_mismatch,
               ({bal} OR l.days_below_zero IS DISTINCT FROM s.days_below_zero) AS balance_mismatch
        FROM monthly_live l FULL JOIN monthly_summary s ON s.account_id = l.account_id AND s.month = l.month
        WHERE l.account_id IS NULL OR s.account_id IS NULL OR ({flow}) OR ({bal})
              OR l.days_below_zero IS DISTINCT FROM s.days_below_zero
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="only run the monthly_live check")
    ap.add_argument("--views", action="store_true", help="only recreate the views, then check")
    a = ap.parse_args()

    with connect(autocommit=True) as conn:
        if a.views:
            conn.execute(VIEWS.read_text(encoding="utf-8"))
            print("views applied")
        elif not a.check:
            t0 = time.perf_counter()
            conn.execute(SCHEMA.read_text(encoding="utf-8"))
            print(f"schema applied ({time.perf_counter() - t0:.1f}s)")
            for name in TABLES:
                t0 = time.perf_counter()
                df = _prepare(name)
                with conn.transaction():
                    copy_frame(conn, name, df)
                n = conn.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
                status = "ok" if n == len(df) else "MISMATCH"
                print(f"{name:<18}{n:>12,} rows  {status}  ({time.perf_counter() - t0:.1f}s)")
            t0 = time.perf_counter()
            refresh_flows(conn)
            conn.execute(VIEWS.read_text(encoding="utf-8"))
            conn.execute("ANALYZE")
            print(f"monthly_flows refreshed ({time.perf_counter() - t0:.1f}s)")

        t0 = time.perf_counter()
        bad = check(conn)
        total = conn.execute("SELECT count(*) FROM monthly_summary").fetchone()[0]
        print(f"\nmonthly_live vs monthly_summary over {total:,} account-months ({time.perf_counter() - t0:.1f}s):")
        for col in ("missing_live", "extra_live", "flow_mismatch", "balance_mismatch"):
            print(f"  {col:<18}{int(bad[col].fillna(False).sum()):>8,}")
    return 0 if not bad[["missing_live", "extra_live", "flow_mismatch"]].fillna(False).any().any() else 1


if __name__ == "__main__":
    sys.exit(main())
