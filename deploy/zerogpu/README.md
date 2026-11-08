---
title: Toonie
emoji: 🪙
colorFrom: yellow
colorTo: blue
sdk: gradio
sdk_version: 6.31.0
app_file: app.py
python_version: "3.12"
pinned: false
short_description: How long would savings last if a shock hit?
---

# Toonie

For each of a bank's 4,500 customers: how long their savings last if a shock hits, how likely they are to make it, and what would help most. Built for the Sheridan Datathon 2026, Tangerine "Resilience Rewired" challenge.

The runway is the judges' formula exactly; every number is explained in [HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

This Space runs the FastAPI app on CPU from the offline Parquet cache, with the NumPy simulation. It uses ZeroGPU only because that is the free tier for Gradio Spaces; it never requests a GPU.
