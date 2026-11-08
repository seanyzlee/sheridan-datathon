---
title: Toonie
emoji: 🪙
colorFrom: yellow
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: How long would savings last if a shock hit?
---

# Toonie

For each of a bank's 4,500 customers: how long their savings last if a shock hits, how likely they are to make it, and what would help most. Built for the Sheridan Datathon 2026, Tangerine "Resilience Rewired" challenge.

The runway is the judges' formula exactly; every number is explained in [HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

This Space runs from the offline Parquet cache. The optional Gemini features read `GEMINI_API_KEY` from the Space's secrets; without it the app works the same, with rule-based wording.
