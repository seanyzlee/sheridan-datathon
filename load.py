"""Load the challenge CSVs once and cache them as Parquet.

Usage:
    python load.py            # read data/*.csv, write cache/*.parquet, check row counts
    python load.py --force    # rebuild the cache even if it is up to date

Other modules call `load_table(name)` to read a cached table (building it if needed).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CACHE_DIR = ROOT / "cache"

# Row counts from the challenge's data dictionary.
EXPECTED_ROWS = {
    "accounts": 4_500,
    "transactions": 1_056_320,
    "monthly_summary": 185_326,
    "loans": 682,
    "clients": 5_369,
    "dispositions": 5_369,
    "cards": 892,
    "standing_orders": 6_471,
    "districts": 77,
}

# Columns that must stay text (IDs at other banks can have leading zeros or letters).
TEXT_COLUMNS = {
    "transactions": ["partner_bank", "partner_account", "purpose", "operation", "direction"],
    "standing_orders": ["to_bank", "to_account", "purpose"],
    "loans": ["status", "status_meaning"],
}

DATE_COLUMNS = {
    "accounts": ["account_opened"],
    "transactions": ["date"],
    "loans": ["loan_start"],
    "clients": ["birth_date"],
    "cards": ["issued"],
}


def _read_csv(name: str) -> pd.DataFrame:
    path = DATA_DIR / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Missing {path}. Put the challenge CSVs in {DATA_DIR}.")

    text_cols = TEXT_COLUMNS.get(name, [])
    df = pd.read_csv(path, dtype={c: "string" for c in text_cols}, low_memory=False)

    for col in DATE_COLUMNS.get(name, []):
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

    if name == "monthly_summary":
        # Keep the original 'YYYY-MM' text (sorts correctly) and add a real date for joins.
        df["month"] = df["month"].astype("string")
        df["month_start"] = pd.to_datetime(df["month"] + "-01")
        df = df.sort_values(["account_id", "month"], kind="stable").reset_index(drop=True)

    if name == "transactions":
        # A blank or "0" partner field means "not a transfer".
        for col in ("partner_bank", "partner_account"):
            if col in df.columns:
                df[col] = df[col].replace({"0": pd.NA, "": pd.NA})

    return df


def _cache_path(name: str) -> Path:
    return CACHE_DIR / f"{name}.parquet"


def _is_fresh(name: str) -> bool:
    cache, source = _cache_path(name), DATA_DIR / f"{name}.csv"
    return cache.exists() and (not source.exists() or cache.stat().st_mtime >= source.stat().st_mtime)


def build_table(name: str, force: bool = False) -> int:
    """Convert one CSV to Parquet. Returns the row count."""
    CACHE_DIR.mkdir(exist_ok=True)
    if not force and _is_fresh(name):
        return len(pd.read_parquet(_cache_path(name), columns=[]))
    df = _read_csv(name)
    df.to_parquet(_cache_path(name), index=False)
    return len(df)


def load_table(name: str, columns: list[str] | None = None) -> pd.DataFrame:
    """Read a cached table, building the cache from the CSV first if needed."""
    if name not in EXPECTED_ROWS:
        raise KeyError(f"Unknown table {name!r}. Known: {sorted(EXPECTED_ROWS)}")
    if not _is_fresh(name):
        build_table(name)
    return pd.read_parquet(_cache_path(name), columns=columns)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="rebuild every Parquet file")
    args = parser.parse_args()

    ok = True
    start = time.perf_counter()
    print(f"{'table':<18}{'rows':>12}{'expected':>12}  status")
    for name, expected in EXPECTED_ROWS.items():
        try:
            rows = build_table(name, force=args.force)
        except FileNotFoundError:
            print(f"{name:<18}{'-':>12}{expected:>12,}  MISSING data/{name}.csv")
            ok = False
            continue
        status = "ok" if rows == expected else "MISMATCH"
        ok &= rows == expected
        print(f"{name:<18}{rows:>12,}{expected:>12,}  {status}")

    print(f"\nDone in {time.perf_counter() - start:.1f}s. Cache: {CACHE_DIR}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
