"""Check that Tiger Data (from .env) accepts a connection.

Usage:
    python check_cloud.py

Secrets are never printed.
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv()


def check_tiger() -> bool:
    url = os.getenv("TIGER_DATABASE_URL", "").strip()
    if not url:
        print("Tiger Data : FAIL  TIGER_DATABASE_URL is empty in .env")
        return False
    import psycopg

    try:
        with psycopg.connect(url, connect_timeout=15) as conn:
            rows = conn.execute(
                "SELECT extname, extversion FROM pg_extension "
                "WHERE extname IN ('timescaledb', 'timescaledb_toolkit')"
            ).fetchall()
    except psycopg.Error as exc:
        print(f"Tiger Data : FAIL  {type(exc).__name__}: {str(exc).splitlines()[0]}")
        return False

    ext = dict(rows)
    toolkit = ext.get("timescaledb_toolkit", "not installed (run: CREATE EXTENSION timescaledb_toolkit;)")
    print(f"Tiger Data : ok    timescaledb {ext.get('timescaledb', 'MISSING')}, toolkit {toolkit}")
    return "timescaledb" in ext


if __name__ == "__main__":
    sys.exit(0 if check_tiger() else 1)
