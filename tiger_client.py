"""The app's live data source: Tiger Data, with a Parquet fallback.

    from tiger_client import live_profile, live_monthly
    p, source = live_profile(20111)       # source is "Tiger Data live" or "Offline cache"

Every function returns the same shapes whether the data came from Tiger Data or the cache,
so the app never needs to know which one answered.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pandas as pd

import engine

ROOT = Path(__file__).resolve().parent
LIVE = "Tiger Data live"
OFFLINE = "Offline cache"

_CONNECT_TIMEOUT = 3
_RETRY_AFTER = 30.0          # seconds to wait before trying Tiger again after a failure
_last_failure = 0.0
_conn = None


def database_url() -> str:
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        pass
    return os.getenv("TIGER_DATABASE_URL", "").strip()


def connect(autocommit: bool = True):
    """A new psycopg connection to Tiger Data (raises if it is not configured or reachable)."""
    import psycopg

    url = database_url()
    if not url:
        raise RuntimeError("TIGER_DATABASE_URL is not set in .env")
    return psycopg.connect(url, autocommit=autocommit, connect_timeout=_CONNECT_TIMEOUT)


def _shared_conn():
    """One reused connection for the app; None while Tiger is unreachable (retried every 30 s)."""
    global _conn, _last_failure
    if _conn is not None and not _conn.closed:
        return _conn
    if time.monotonic() - _last_failure < _RETRY_AFTER:
        return None
    try:
        _conn = connect()
        _conn.execute("SET statement_timeout = '5s'")
        return _conn
    except Exception:
        _conn, _last_failure = None, time.monotonic()
        return None


def _query(sql: str, params=()) -> pd.DataFrame | None:
    global _conn, _last_failure
    conn = _shared_conn()
    if conn is None:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])
    except Exception:
        try:
            conn.close()
        finally:
            _conn, _last_failure = None, time.monotonic()
        return None


def is_live() -> bool:
    return _query("SELECT 1 AS ok") is not None


# --------------------------------------------------------------------------- profiles

_PROFILE_SQL = """
    SELECT account_id, i, s, f, h, b, p, months_of_data, days_below_zero_6m,
           has_loan, loan_running, defaulted, last_month
    FROM profile_live WHERE account_id = %s
"""


def tiger_profile(account_id: int) -> engine.Profile | None:
    """The profile computed inside Tiger Data from raw transactions, or None if unavailable."""
    df = _query(_PROFILE_SQL, (int(account_id),))
    if df is None or df.empty:
        return None
    r = df.iloc[0]
    return engine.Profile(
        account_id=int(r["account_id"]), I=float(r["i"]), S=float(r["s"]), F=float(r["f"]),
        H=float(r["h"]), B=float(r["b"]), P=float(r["p"]), months_of_data=int(r["months_of_data"]),
        days_below_zero_6m=float(r["days_below_zero_6m"]), has_loan=bool(r["has_loan"]),
        loan_running=bool(r["loan_running"]), defaulted=bool(r["defaulted"]),
    )


def live_profile(account_id: int, prefer_live: bool = True) -> tuple[engine.Profile, str]:
    """(profile, source). Tiger Data when reachable and asked for, otherwise the Parquet engine."""
    if prefer_live:
        p = tiger_profile(account_id)
        if p is not None:
            return p, LIVE
    return engine.profile(account_id), OFFLINE


# --------------------------------------------------------------------------- monthly rows

_MONTHLY_COLUMNS = [
    "month", "money_in", "money_out", "cash_deposits", "transfers_in", "pension_in", "interest_in",
    "household_bills", "insurance", "loan_payments", "bank_fees", "cash_withdrawals_genuine",
    "card_withdrawals", "transfers_out_other", "month_end_balance", "min_balance", "avg_daily_balance",
    "days_below_zero",
]


def cached_monthly(account_id: int) -> pd.DataFrame:
    m = _monthly_cache()
    rows = m.loc[m["account_id"] == int(account_id), _MONTHLY_COLUMNS].copy()
    rows["month"] = pd.to_datetime(rows["month"] + "-01")
    return rows.reset_index(drop=True)


_monthly_df: pd.DataFrame | None = None


def _monthly_cache() -> pd.DataFrame:
    global _monthly_df
    if _monthly_df is None:
        _monthly_df = engine.load_table("monthly_summary")
    return _monthly_df


def live_monthly(account_id: int, prefer_live: bool = True) -> tuple[pd.DataFrame, str]:
    """(monthly rows sorted by month, source). Same columns as monthly_summary."""
    if prefer_live:
        df = _query(f"SELECT {', '.join(_MONTHLY_COLUMNS)} FROM monthly_live WHERE account_id = %s ORDER BY month",
                    (int(account_id),))
        if df is not None and not df.empty:
            df["month"] = pd.to_datetime(df["month"])
            for c in _MONTHLY_COLUMNS[1:]:
                df[c] = df[c].astype(float)
            return df, LIVE
    return cached_monthly(account_id), OFFLINE


def latest_transaction_date(account_id: int) -> pd.Timestamp | None:
    df = _query("SELECT max(date) AS d FROM transactions WHERE account_id = %s", (int(account_id),))
    if df is None or df.empty or df["d"].iloc[0] is None:
        return None
    return pd.Timestamp(df["d"].iloc[0])
