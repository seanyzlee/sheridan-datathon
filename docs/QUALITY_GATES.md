# Quality gates: "production-ready, ready to ship"

The web app (api.py + web/) is ready to ship when every gate below passes with evidence.
Used by the iterate-until-verified loop: implementers fix, an independent verifier judges.

## The task contract (never change these)

- Audience: real Tangerine customers (simple view: plain words, no jargon) and analysts/judges (advanced view).
  What customers need: their baseline numbers at a glance (income I, fixed costs F, buffer B, runway), an
  automatic emergency plan when a shock hits (Shock Autopilot), and a calm interface where small changes
  visibly move their survival timeline.
- Every number comes from the API (engine, plan, simulate, discovery, autopilot). The front end only formats,
  draws and animates. Never compute a figure in TypeScript.
- Simple and advanced views stay; gate extra detail with `useAdvanced()`, never delete it.
- Charts follow the dataviz rules: no dual axes, a table view per chart, blue = today, tangerine = after the
  shock, status colours only with an icon or label.
- Motion: GSAP via `web/src/motion.ts` (`useGSAP`, transforms and opacity only), and every animation honours
  `prefers-reduced-motion`. 3D: React Three Fiber 8, lazy-loaded, `frameloop="demand"`, `RobustResizeObserver`.
- Works offline from the Parquet cache. No gamification (removed on purpose).

## Gates

| # | Gate | How to check | Pass condition |
|---|------|--------------|----------------|
| G1 | Types and build | `cd web && npx tsc --noEmit -p .` then `npm run build` | Both exit 0, no new warnings |
| G2 | Python tests | `.venv/Scripts/python.exe -m pytest -q` | All pass |
| G3 | Accessibility | `.venv/Scripts/python.exe tools/audit.py` (app on :8000) | 0 serious/critical axe violations on every audited page, width and theme |
| G4 | No runtime errors | same audit | 0 console errors / uncaught exceptions |
| G5 | Web Interface Guidelines | Vercel guidelines (`web-design-guidelines` skill) over web/src | No high-severity findings left |
| G6 | Visual quality | `tools/screenshot.py` at 1440 and 390 wide, light and dark, every page | No overlapping or clipped text, no empty or broken panels, consistent spacing and type, 3D views legible |
| G7 | Correctness | Spot-check 3 accounts: UI figures equal API/engine figures | Exact match |
| G8 | Motion and feel | Inspect motion.ts usage; reduced-motion audit | Animations purposeful, under ~1 s, nothing animates layout properties, reduced motion respected |
| G9 | Navigation | Every page reachable from the nav in two clicks; keyboard-only walkthrough | All controls focusable with a visible focus ring; Esc closes popovers |
| G10 | Performance | `npm run build` output | Initial JS (index + vendor + charts) under 260 kB gzip; three.js only in lazy chunks |
