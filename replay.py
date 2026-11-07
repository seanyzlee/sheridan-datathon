"""Stream one account's transactions back into Tiger Data, month by month (live feed, D9 / D6).

It removes the account's transactions from --from onward, then inserts them again in date
order, one month per --speed seconds, refreshing the continuous aggregate after each month so
`profile_live` (and the app's Live panel) moves as each month lands. The data always ends up
exactly as it started, even after Ctrl+C.

Usage:
    python replay.py --account 20111                      # last 12 months, one month per second
    python replay.py --account 20111 --from 2024-06 --speed 2
    python replay.py --account 20111 --restore            # just put everything back
"""

from __future__ import annotations

import argparse
import sys
import time

import pandas as pd

import engine
from load import load_table
from tiger_client import connect
from tiger_load import copy_frame, refresh_flows, TABLES

PROFILE_SQL = "SELECT i, s, b, last_month FROM profile_live WHERE account_id = %s"


def _account_rows(account_id: int) -> pd.DataFrame:
    t = load_table("transactions")
    rows = t.loc[t["account_id"] == account_id, TABLES["transactions"]].copy()
    if rows.empty:
        raise SystemExit(f"No transactions for account {account_id}")
    rows["month"] = rows["date"].dt.to_period("M")
    rows["date"] = rows["date"].dt.date
    return rows


def _month_bounds(period: pd.Period) -> tuple[str, str]:
    return str(period.start_time.date()), str((period + 1).start_time.date())


def _status(conn, account_id: int) -> str:
    row = conn.execute(PROFILE_SQL, (account_id,)).fetchone()
    if row is None:
        return "no data"
    i, s, b, last = row
    p = engine.Profile(account_id, float(i), float(s), 0.0, 0.0, float(b), 0.0, 0, 0.0, False, False, False)
    return f"through {last:%Y-%m}  I={i:,.0f}  S={s:,.0f}  B={b:,.0f}  runway {engine.runway(p).label}"


def restore(conn, rows: pd.DataFrame, start: pd.Period) -> None:
    """Make Tiger hold exactly the cached rows from `start` onward for this account."""
    account_id = int(rows["account_id"].iloc[0])
    lo, _ = _month_bounds(start)
    with conn.transaction():
        conn.execute("DELETE FROM transactions WHERE account_id = %s AND date >= %s", (account_id, lo))
        copy_frame(conn, "transactions", rows.loc[rows["month"] >= start, TABLES["transactions"]])
    refresh_flows(conn, lo, None)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--account", type=int, required=True)
    ap.add_argument("--from", dest="start", help="first month to replay, YYYY-MM (default: last 12 months)")
    ap.add_argument("--speed", type=float, default=1.0, help="seconds per month (default 1)")
    ap.add_argument("--restore", action="store_true", help="only restore the account's transactions")
    a = ap.parse_args()

    rows = _account_rows(a.account)
    last = rows["month"].max()
    start = pd.Period(a.start, "M") if a.start else last - 11
    start = max(start, rows["month"].min() + 1)   # keep at least one month so the account exists

    with connect(autocommit=True) as conn:
        if a.restore:
            restore(conn, rows, rows["month"].min())
            print(f"Restored account {a.account}: {_status(conn, a.account)}")
            return 0

        months = pd.period_range(start, last, freq="M")
        lo, _ = _month_bounds(start)
        print(f"Replaying account {a.account}: {len(months)} months from {start} at {a.speed:g}s per month")
        try:
            conn.execute("DELETE FROM transactions WHERE account_id = %s AND date >= %s", (a.account, lo))
            refresh_flows(conn, lo, None)
            print(f"  start        {_status(conn, a.account)}")
            for m in months:
                t0 = time.perf_counter()
                batch = rows.loc[rows["month"] == m, TABLES["transactions"]]
                if not batch.empty:
                    with conn.transaction():
                        copy_frame(conn, "transactions", batch)
                refresh_flows(conn, *_month_bounds(m))
                took = time.perf_counter() - t0
                print(f"  +{m}  {len(batch):>3} txns  {_status(conn, a.account)}  ({took:.2f}s)")
                time.sleep(max(0.0, a.speed - took))
        except KeyboardInterrupt:
            print("\nInterrupted: restoring the account's transactions")
        finally:
            restore(conn, rows, start)
        print(f"  done         {_status(conn, a.account)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
