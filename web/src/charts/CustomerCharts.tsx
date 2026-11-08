import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Customer, ShockResult } from "../api";
import { ChartFrame, DataTable, TipBox } from "../components/ui";
import { compactMoney, money, shortMonth } from "../format";
import { usePalette } from "../theme";
import { Sized } from "../components/Sized";
import { anim, axisProps, cursorBand, cursorLine, gridProps, MARGIN, yAxisProps } from "./common";

// --------------------------------------------------------------------------- monthly history
// Two small multiples on a shared month axis instead of a dual-axis chart (dataviz rule: one axis).

export function HistoryCharts({ data, stale }: { data: Customer["monthly"]; stale?: boolean }) {
  const pal = usePalette();
  const table = (
    <DataTable caption="Monthly money in, money out and average daily balance" rows={data} maxHeight={360} columns={[
      { key: "m", label: "Month", render: (r) => shortMonth(r.month) },
      { key: "in", label: "Money in", align: "r", render: (r) => money(r.money_in) },
      { key: "out", label: "Money out", align: "r", render: (r) => money(r.money_out) },
      { key: "bal", label: "Average daily balance", align: "r", render: (r) => money(r.balance) },
    ]} />
  );
  return (
    <ChartFrame title="The last 24 months" sub="Money in and out each month, then the balance they kept"
                legend={[{ label: "Money in", color: pal.today }, { label: "Money out", color: pal.third }]}
                table={table} stale={stale} label="Monthly money in and out, and the average daily balance, for the last 24 months">
      <Sized height={190}>{(w) => (
        <BarChart width={w} height={190} data={data} margin={MARGIN} barGap={2} syncId="history">
          <CartesianGrid {...gridProps(pal)} />
          <XAxis dataKey="month" {...axisProps(pal)} tickFormatter={shortMonth} hide />
          <YAxis {...yAxisProps(pal)} tickFormatter={compactMoney} />
          <Tooltip cursor={cursorBand(pal)} content={({ active, payload, label }) => active && payload?.length ? (
            <TipBox title={shortMonth(String(label))} rows={[
              { label: "Money in", value: money(payload[0]?.payload.money_in), color: pal.today, shape: "rect" },
              { label: "Money out", value: money(payload[0]?.payload.money_out), color: pal.third, shape: "rect" },
              { label: "Balance", value: money(payload[0]?.payload.balance), color: pal.ink },
            ]} />) : null} />
          <Bar dataKey="money_in" fill={pal.today} radius={[3, 3, 0, 0]} maxBarSize={10} {...anim()} />
          <Bar dataKey="money_out" fill={pal.third} radius={[3, 3, 0, 0]} maxBarSize={10} {...anim(80)} />
        </BarChart>
      )}</Sized>
      <div className="chart-sub" style={{ margin: "10px 0 2px" }}>Average daily balance</div>
      <Sized height={130}>{(w) => (
        <ComposedChart width={w} height={130} data={data} margin={MARGIN} syncId="history">
          <CartesianGrid {...gridProps(pal)} />
          <XAxis dataKey="month" {...axisProps(pal)} tickFormatter={shortMonth} minTickGap={24} />
          <YAxis {...yAxisProps(pal)} tickFormatter={compactMoney} />
          <Tooltip cursor={cursorLine(pal)} content={() => null} />
          <ReferenceLine y={0} stroke={pal.axis} />
          <Area dataKey="balance" stroke={pal.ink} strokeWidth={2} fill={pal.ink} fillOpacity={0.06} {...anim(120)}
                dot={false} activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2, fill: pal.ink }} />
        </ComposedChart>
      )}</Sized>
    </ChartFrame>
  );
}

// --------------------------------------------------------------------------- spending

export function SpendingChart({ data, stale }: { data: Customer["spending"]; stale?: boolean }) {
  const pal = usePalette();
  const height = 44 + data.length * 34;
  const total = data.reduce((a, d) => a + d.amount, 0);
  const table = (
    <DataTable caption="Average monthly spending by category" rows={data} columns={[
      { key: "c", label: "Category", render: (r) => r.category },
      { key: "t", label: "Type", render: (r) => (r.fixed ? "Fixed" : "Can be cut") },
      { key: "a", label: "Per month", align: "r", render: (r) => money(r.amount) },
      { key: "s", label: "Share", align: "r", render: (r) => `${Math.round((r.amount / total) * 100)}%` },
    ]} />
  );
  return (
    <ChartFrame title="Where the money goes" sub="Average per month over the last 12 months"
                legend={[{ label: "Can be cut", color: pal.today }, { label: "Fixed", color: pal.neutral }]} table={table} stale={stale}>
      <Sized height={height}>{(w) => (
        <BarChart width={w} height={height} data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="category" {...axisProps(pal)} axisLine={false} width={108} tick={{ fill: pal.ink2, fontSize: 13 }} />
          <Tooltip cursor={cursorBand(pal)} content={({ active, payload }) => active && payload?.length ? (
            <TipBox title={payload[0].payload.category} rows={[
              { label: payload[0].payload.fixed ? "Fixed" : "Can be cut", value: `${money(payload[0].payload.amount)} a month` },
            ]} />) : null} />
          <Bar dataKey="amount" radius={[0, 4, 4, 0]} maxBarSize={18} {...anim()}>
            {data.map((d) => <Cell key={d.category} fill={d.fixed ? pal.neutral : pal.today} />)}
            <LabelList dataKey="amount" position="right" formatter={(v: number) => money(v)} style={{ fill: pal.ink2, fontSize: 12, fontVariantNumeric: "tabular-nums" }} />
          </Bar>
        </BarChart>
      )}</Sized>
    </ChartFrame>
  );
}

// --------------------------------------------------------------------------- balance after the shock

export function BurnDownChart({ r, stale, simple }: { r: ShockResult; stale?: boolean; simple?: boolean }) {
  const pal = usePalette();
  const data = r.burn_down.map((d) => ({ ...d, band: d.p10 != null && d.p90 != null ? [d.p10, d.p90] : null }));
  const hasEi = !simple && data.some((d) => d.ei_ends != null && d.ei_ends !== d.balance);
  const lastMonth = data.length ? data[data.length - 1].month : 0;
  // Where the judges' straight line crosses zero: the server's runway, drawn as a marker (never recomputed here).
  const runsOut = !r.runway.no_shortfall && r.runway.months > 0 && r.runway.months <= lastMonth ? r.runway.months : null;
  const legend = simple ? [
    { label: "Most likely", color: pal.ink, shape: "line" as const },
    { label: "Range of likely outcomes", color: pal.shockWash, shape: "band" as const },
  ] : [
    { label: "Judges' formula", color: pal.ink, shape: "line" as const },
    { label: "Simulated median", color: pal.shock, shape: "dashed" as const },
    { label: "80% of simulated futures", color: pal.shockWash, shape: "band" as const },
    ...(hasEi ? [{ label: "If EI ends with no new job", color: pal.critical, shape: "dashed" as const }] : []),
  ];
  const table = (
    <DataTable caption="Balance month by month after the shock" rows={data} maxHeight={360} columns={[
      { key: "m", label: "Month", align: "r", render: (d) => d.month },
      { key: "b", label: "Judges' formula", align: "r", render: (d) => money(d.balance) },
      { key: "p50", label: "Simulated median", align: "r", render: (d) => money(d.p50) },
      { key: "p10", label: "10th percentile", align: "r", render: (d) => money(d.p10) },
      { key: "p90", label: "90th percentile", align: "r", render: (d) => money(d.p90) },
      ...(hasEi ? [{ key: "ei", label: "If EI ends", align: "r" as const, render: (d: typeof data[number]) => money(d.ei_ends) }] : []),
    ]} />
  );
  return (
    <ChartFrame title={simple ? "Their savings, month by month" : "Their balance after the shock"}
                sub={simple ? "Months from now. Below the red line, they've run out" : `${r.survival.n_paths.toLocaleString("en-CA")} simulated futures around the judges' straight line, by months from now`}
                legend={legend} table={table} stale={stale} label="Balance month by month after the shock, with the range of simulated futures">
      <Sized height={300}>{(w) => (
        <ComposedChart width={w} height={300} data={data} margin={MARGIN}>
          <CartesianGrid {...gridProps(pal)} />
          <XAxis dataKey="month" type="number" domain={[0, lastMonth]} allowDecimals={false} {...axisProps(pal)}
                 tickFormatter={(m) => (m === 0 ? "Now" : String(m))} height={36} />
          <YAxis {...yAxisProps(pal)} tickFormatter={compactMoney} />
          <Tooltip cursor={cursorLine(pal)} content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as typeof data[number];
            if (simple) {
              const m = Number(label);
              return <TipBox title={m === 0 ? "Now" : `In ${m} month${m === 1 ? "" : "s"}`} rows={[
                { label: "Most likely", value: money(d.balance), color: pal.ink },
                { label: "Likely range", value: `${compactMoney(d.p10 ?? 0)} to ${compactMoney(d.p90 ?? 0)}`, color: pal.shockWash, shape: "band" as const },
              ]} />;
            }
            const rows = [
              { label: "Judges' formula", value: money(d.balance), color: pal.ink },
              { label: "Simulated median", value: money(d.p50), color: pal.shock, shape: "dashed" as const },
              { label: "Simulated range", value: `${compactMoney(d.p10 ?? 0)} to ${compactMoney(d.p90 ?? 0)}`, color: pal.shockWash, shape: "band" as const },
            ];
            if (hasEi && d.ei_ends != null) rows.push({ label: "If EI ends", value: money(d.ei_ends), color: pal.critical, shape: "dashed" as const });
            return <TipBox title={Number(label) === 0 ? "Now" : `Month ${label}`} rows={rows} />;
          }} />
          <Area dataKey="band" stroke="none" fill={pal.shock} fillOpacity={0.14} {...anim(150)} activeDot={false} />
          <ReferenceLine y={0} stroke={pal.critical} strokeWidth={1} />
          {runsOut != null && (
            <ReferenceLine x={runsOut} stroke={pal.critical} strokeDasharray="3 3" ifOverflow="visible"
                           label={{ value: `Runs out at ${runsOut.toFixed(1)} months`, position: runsOut > lastMonth * 0.6 ? "insideTopRight" : "insideTopLeft", fill: pal.critical, fontSize: 12, fontWeight: 650 }} />
          )}
          {hasEi && <Line dataKey="ei_ends" stroke={pal.critical} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} activeDot={false} />}
          {!simple && <Line dataKey="p50" stroke={pal.shock} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} activeDot={false} />}
          <Line dataKey="balance" stroke={pal.ink} strokeWidth={2} dot={false} {...anim()}
                activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2, fill: pal.ink }} />
        </ComposedChart>
      )}</Sized>
    </ChartFrame>
  );
}

// --------------------------------------------------------------------------- waterfall

export function WaterfallChart({ r, stale }: { r: ShockResult; stale?: boolean }) {
  const pal = usePalette();
  let running = 0;
  const data = r.waterfall.map((w, i) => {
    let start: number, end: number;
    if (w.measure === "absolute" || w.measure === "total") { start = 0; end = w.months; running = w.months; }
    else { start = running; end = running + w.months; running = end; }
    const color = w.measure === "absolute" ? pal.today : w.measure === "total" ? pal.shock : w.months < 0 ? pal.critical : pal.good;
    return { i, step: w.step, value: w.months, measure: w.measure, base: Math.min(start, end), size: Math.abs(end - start), color,
             label: w.measure === "relative" ? `${w.months > 0 ? "+" : ""}${w.months.toFixed(1)}` : w.months >= 120 ? "120+" : w.months.toFixed(1) };
  });
  const table = (
    <DataTable caption="What moved the runway" rows={data} columns={[
      { key: "s", label: "Step", render: (d) => d.step },
      { key: "v", label: "Months", align: "r", render: (d) => d.label },
    ]} />
  );
  return (
    <ChartFrame title="What moved the runway" sub="Each part of the shock applied in turn, in months"
                table={table} stale={stale} label="Waterfall from today's runway to the runway after the shock">
      <Sized height={300}>{(w) => (
        <BarChart width={w} height={300} data={data} margin={{ ...MARGIN, top: 22 }}>
          <CartesianGrid {...gridProps(pal)} />
          <XAxis dataKey="step" {...axisProps(pal)} interval={0} tick={{ fill: pal.ink2, fontSize: 12 }} height={36} />
          <YAxis {...yAxisProps(pal)} width={40} />
          <Tooltip cursor={cursorBand(pal)} content={({ active, payload }) => active && payload?.length ? (
            <TipBox title={payload[0].payload.step} rows={[{ label: payload[0].payload.measure === "relative" ? "Change" : "Runway", value: `${payload[0].payload.label} months` }]} />
          ) : null} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="size" stackId="w" radius={[4, 4, 0, 0]} maxBarSize={24} {...anim()}>
            {data.map((d) => <Cell key={d.i} fill={d.color} />)}
            <LabelList dataKey="label" position="top" style={{ fill: pal.ink, fontSize: 12, fontWeight: 650 }} />
          </Bar>
        </BarChart>
      )}</Sized>
    </ChartFrame>
  );
}

