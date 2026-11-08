import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { axisProps, cursorBand } from "../charts/common";
import { ChartFrame, DataTable, ErrorNote, Loading, SectionHead, TipBox } from "../components/ui";
import { pct } from "../format";
import { usePalette } from "../theme";
import { Sized } from "../components/Sized";
import { useReveal } from "../motion";

export default function Method() {
  const pal = usePalette();
  const q = useQuery({ queryKey: ["method"], queryFn: api.method, staleTime: Infinity });
  useEffect(() => { document.title = "How it works, Toonie"; }, []);
  const pageRef = useRef<HTMLDivElement>(null);
  useReveal(pageRef, !!q.data);

  const bench = (q.data?.bench ?? []).map((b) => ({
    ...b, label: `${b.method}${b.threads > 1 ? `, ${b.threads} threads` : ""}`, fast: b.method.toLowerCase().includes("c++"),
  }));
  const best = q.data?.backtest.reduce((a, b) => (b.brier < a.brier ? b : a), q.data.backtest[0]);

  return (
    <div className="pg" ref={pageRef}>
      <div className="page-head">
        <div>
          <h1>How it works</h1>
          <p>The judges' number first, exactly. Everything else is built around it and never replaces it.</p>
        </div>
      </div>

      <ol className="pg-steps reveal" aria-label="Three layers">
        <li className="pg-card">
            <h2>The judges' number, exactly</h2>
            <p><code>engine.py</code> computes I, S, F, H, B and P from the monthly summary and applies the runway formula with the same rounding
              and 120-month cap. It's tested against hand-worked accounts and runs on all 4,500 customers in under a second.</p>
        </li>
        <li className="pg-card">
            <h2>Live from Tiger Data</h2>
            <p>Transactions sit in a TimescaleDB hypertable. A real-time continuous aggregate rebuilds every monthly total, and the
              <code> profile_live</code> view computes the exact medians with <code>percentile_cont</code>. It reproduces the challenge's monthly
              table on all 185,326 account-months. If the network drops, every screen falls back to the local Parquet cache.</p>
        </li>
        <li className="pg-card">
            <h2>A C++ simulation core</h2>
            <p>Around the judges' number, 10,000 simulated futures per customer add income and spending swings, random job loss from their
              district's unemployment rate, EI running out, one-off repairs and bill inflation from Canadian CPI. With all of that switched off,
              the simulation lands exactly on the judges' runway. It's C++17 with OpenMP, called through pybind11, with a NumPy fallback.</p>
        </li>
      </ol>

      {q.isError && <div className="section"><ErrorNote error={q.error} onRetry={() => q.refetch()} /></div>}
      {!q.data && q.isLoading && <Loading what="the benchmark" />}
      {q.data && (
        <>
          <section className="section reveal">
            <SectionHead title="Why C++">Whole bank: 4,500 customers × 2,000 futures × 24 months. Running now on {q.data.backend}.</SectionHead>
            <div className="pg-card">
            <ChartFrame title="Seconds for one whole-bank run" sub="Log scale. Pure Python and NumPy times are scaled up from a sample."
                        table={<DataTable caption="Benchmark" rows={bench} columns={[
                          { key: "m", label: "Method", render: (b) => b.label },
                          { key: "s", label: "Seconds", align: "r", render: (b) => b.seconds.toFixed(2) },
                          { key: "x", label: "Speed-up vs Python", align: "r", render: (b) => `${Math.round(b.speedup_vs_python).toLocaleString("en-CA")}×` },
                          { key: "n", label: "Note", render: (b) => b.note ?? "" },
                        ]} />}>
              <Sized height={56 + bench.length * 40}>{(w) => (
                <BarChart width={w} height={56 + bench.length * 40} data={bench} layout="vertical" margin={{ top: 4, right: w < 520 ? 84 : 130, bottom: 0, left: 0 }}>
                  <XAxis type="number" scale="log" domain={[0.1, "dataMax"]} hide allowDataOverflow />
                  <YAxis type="category" dataKey="label" {...axisProps(pal)} axisLine={false} width={w < 520 ? 128 : 190} tick={{ fill: pal.ink2, fontSize: w < 520 ? 12 : 13 }} />
                  <Tooltip cursor={cursorBand(pal)} content={({ active, payload }) => active && payload?.length ? (
                    <TipBox title={payload[0].payload.label} rows={[
                      { label: "Seconds", value: payload[0].payload.seconds.toFixed(2) },
                      { label: "Faster than Python", value: `${Math.round(payload[0].payload.speedup_vs_python)}×` },
                    ]} />) : null} />
                  <Bar dataKey="seconds" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
                    {bench.map((b) => <Cell key={b.label} fill={b.fast ? pal.shock : pal.neutral} />)}
                    <LabelList dataKey="seconds" position="right"
                               formatter={(v: number) => `${v.toFixed(2)} s`}
                               style={{ fill: pal.ink, fontSize: 12, fontWeight: 650, fontVariantNumeric: "tabular-nums" }} />
                  </Bar>
                </BarChart>
              )}</Sized>
            </ChartFrame>
            </div>
          </section>

          <section className="section reveal">
            <SectionHead title="Is the simulation calibrated?">
              Profiles built from data up to June 2025, the next 6 months simulated, then compared with what really happened.
            </SectionHead>
            <div className="pg-card">
              <p className="pg-prose">
                <strong>{pct(q.data.backtest[0]?.actual_share, 1)}</strong> of {q.data.backtest[0]?.accounts.toLocaleString("en-CA")} customers ended a month at or below zero.
                Drawing each month's swings with each customer's full volatility overstates risk, because real spending is lumpy but evens out.
                Scaling the swings to {pct(q.data.noise_scale)} gives the best score{best ? ` (Brier ${best.brier.toFixed(4)})` : ""}, and beats the judges' formula on its own.
              </p>
              <div className="wrap-sm">
            <DataTable caption="Backtest of the simulation against real outcomes" rows={q.data.backtest} columns={[
              { key: "m", label: "Model", render: (b) => b.model },
              { key: "p", label: "Predicted to run out", align: "r", render: (b) => pct(b.predicted_share, 1) },
              { key: "a", label: "Actually ran out", align: "r", render: (b) => pct(b.actual_share, 1) },
              { key: "b", label: "Brier score (lower is better)", align: "r", render: (b) => b.brier.toFixed(4) },
            ]} />
              </div>
            </div>
          </section>
        </>
      )}

      <section className="section reveal pg-grid" aria-label="Definitions and sources">
        <div className="pg-card">
          <SectionHead title="Definitions" />
          <dl className="defs">
            <dt>I</dt><dd>median monthly money in</dd>
            <dt>S</dt><dd>median monthly money out</dd>
            <dt>F</dt><dd>median of household bills + insurance + loan payments, summed per month first</dd>
            <dt>H</dt><dd>median household bills</dd>
            <dt>B</dt><dd>mean average daily balance over the last 6 months</dd>
            <dt>P</dt><dd>monthly loan payment if the loan runs past Dec 2025, else 0</dd>
            <dt>Runway</dt><dd>(B − one-off) ÷ (S + bills % × H + other − income factor × I). 0 if the buffer is gone, 120+ if there's no gap.</dd>
          </dl>
        </div>
        <div className="pg-card">
          <SectionHead title="Sources" />
          <ul className="pg-sources">
            <li>Bank data: PKDD'99 Financial dataset (Czech bank), as provided by the challenge</li>
            <li>EI maximum weekly benefit 2026: ${q.data?.ei_weekly_max ?? 729} (maximum insurable earnings $68,900), canada.ca</li>
            <li>CPI 12-month change: {q.data ? pct(q.data.cpi, 1) : "2.8%"} (April 2026), Statistics Canada table 18-10-0004-01</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
