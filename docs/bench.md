# Benchmark: bank-wide stress test

4,500 customers x 2,000 futures x 24 months = **216M simulated months** (EI 55% + bills +15%). Machine: 8 logical cores.

| Method | Threads | Time | Speed-up vs Python | M steps/s | Note |
|---|---|---|---|---|---|
| Pure Python loop | 1 | 3.3 min | 1x | 1.1 | scaled from 5 customers |
| NumPy (vectorised) | 1 | 17.52 s | 11x | 12.3 | scaled from 450 customers |
| C++ OpenMP | 1 | 3.69 s | 54x | 58.5 | full run, best of 3 |
| C++ OpenMP | 4 | 1.04 s | 193x | 207.2 | full run, best of 3 |
| C++ OpenMP | 8 | 0.56 s | 357x | 384.6 | full run, best of 3 |
