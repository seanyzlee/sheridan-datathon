"""Check that the cloud services in .env accept a connection.

Usage:
    python check_cloud.py

Tiger Data is required. Snowflake is skipped (not failed) while its .env fields are blank.
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


def check_snowflake() -> bool:
    account = os.getenv("SNOWFLAKE_ACCOUNT", "").strip()
    user = os.getenv("SNOWFLAKE_USER", "").strip()
    if not account or not user:
        print("Snowflake  : skip  SNOWFLAKE_ACCOUNT / SNOWFLAKE_USER not set in .env")
        return True
    try:
        import snowflake.connector
    except ImportError as exc:
        print(f"Snowflake  : FAIL  connector would not import ({exc})")
        return False

    params = {
        "account": account,
        "user": user,
        "role": os.getenv("SNOWFLAKE_ROLE") or None,
        "warehouse": os.getenv("SNOWFLAKE_WAREHOUSE") or None,
        "login_timeout": 30,
    }
    key_path = os.getenv("SNOWFLAKE_PRIVATE_KEY_PATH", "").strip()
    if key_path:
        params["private_key_file"] = key_path
    else:
        params["password"] = os.getenv("SNOWFLAKE_PASSWORD", "")
    try:
        with snowflake.connector.connect(**{k: v for k, v in params.items() if v is not None}) as conn:
            version = conn.cursor().execute("SELECT CURRENT_VERSION()").fetchone()[0]
    except Exception as exc:  # connector raises many error types
        print(f"Snowflake  : FAIL  {type(exc).__name__}: {str(exc).splitlines()[0]}")
        return False
    print(f"Snowflake  : ok    version {version}")
    return True


if __name__ == "__main__":
    results = [check_tiger(), check_snowflake()]
    sys.exit(0 if all(results) else 1)
