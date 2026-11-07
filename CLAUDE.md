# Sheridan Datathon 2026 — Tangerine "Resilience Rewired"

The build plan is in `docs/ROADMAP.md`. Read it at the start of every session and work on the first unchecked task.
Current phase: **Phase 0 — Setup**.

Engine numbers must match the judges' definitions (I, S, F, H, B, P and the runway formula) in the roadmap's Data Model section.

The C++ HPC core (`hpc/`, pybind11 + OpenMP) adds Monte Carlo survival probabilities and bank-wide stress tests. It never replaces the judges' formula, must match it when noise is off, and always has a NumPy fallback (`sim_numpy.py`) with the same function signature.

The final product uses the Snowflake API (warehouse, discovery SQL, Cortex twist reader) and Tiger Data (TimescaleDB hypertables and continuous aggregates for the live feed). Their profile numbers must match `engine.profile()`. Credentials live only in `.env`, which is git-ignored. Every panel the live twist needs must also work offline from the Parquet cache.
