# Sheridan Datathon 2026 — Tangerine "Resilience Rewired"

The build plan is in `docs/ROADMAP.md`. Read it at the start of every session and work on the first unchecked task.
Current phase: **Phase 2 — Customer app** (Phases 0, 1, 1b and 3b done).

Rebuild the C++ core after editing `hpc/`: `uv pip install --python .venv/Scripts/python.exe ./hpc` (bump the version in `hpc/pyproject.toml` so uv reinstalls).

Use the project venv: `.venv/Scripts/python.exe` (Python 3.12). The system Python 3.14 has numpy blocked by Windows Application Control. Run tests with `.venv/Scripts/python.exe -m pytest`.

Engine numbers must match the judges' definitions (I, S, F, H, B, P and the runway formula) in the roadmap's Data Model section.

The C++ HPC core (`hpc/`, pybind11 + OpenMP) adds Monte Carlo survival probabilities and bank-wide stress tests. It never replaces the judges' formula, must match it when noise is off, and always has a NumPy fallback (`sim_numpy.py`) with the same function signature.

Snowflake is scrapped; do not add it back. The final product uses Tiger Data (TimescaleDB hypertables and continuous aggregates for the live feed). Its profile numbers must match `engine.profile()`. Credentials live only in `.env`, which is git-ignored. Every panel the live twist needs must also work offline from the Parquet cache.
