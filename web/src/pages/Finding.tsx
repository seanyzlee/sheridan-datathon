import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Finding as FindingT } from "../api";
import { axisProps, cursorBand, cursorLine, gridProps, MARGIN, yAxisProps } from "../charts/common";
import { ChartFrame, DataTable, ErrorNote, Loading, SectionHead, Stat, TipBox } from "../components/ui";
import { pct } from "../format";
import { useAdvanced, useAppState } from "../state";
import { usePalette } from "../theme";
import { Sized } from "../components/Sized";
import { useReveal } from "../motion";

const RULE_NAMES: Record<string, string> = {
  stress_ei_lt2: "On EI, under 2 months",
  base_lt3: "No shock, under 3 months",
  base_lt6: "No shock, under 6 months",
  stress_one_month_lt3: "After a one-off, under 3 months",
};

const pctTick = (v: number) => `${Math.round(v * 100)}%`;

function RulesChart({ f }: { f: FindingT }) {
  const pal = usePalette();
  const data = f.rules.map((r) => ({ ...r, name: RULE_NAMES[r.rule] ?? r.label }));
  const table = (
    <DataTable caption="Early-warning rules compared" rows={data} columns={[
      { key: "n", label: "Rule", render: (r) => r.name },
      { key: "c", label: "Defaults caught", align: "r", render: (r) => pct(r.caught) },
      { key: "f", label: "Good loans flagged", align: "r", render: (r) => pct(r.false_alarms) },
      { key: "l", label: "Median warning", align: "r", render: (r) => `${r.median_lead_months.toFixed(0)} months` },
      { key: "x", label: "Default rate, flagged vs not", align: "r", render: (r) => `${pct(r.default_rate_flagged)} vs ${pct(r.default_rate_not_flagged, 1)}` },
    ]} />
  );
  return (
    <ChartFrame title="Which warning rule works best" sub="Each rule checked every month on the 682 loans"
                legend={[{ label: "Defaults caught", color: pal.today }, { label: "Good loans flagged", color: pal.neutral }]} table={table}>
      <Sized height={300}>{(w) => (
        <BarChart width={w} height={300} data={data} margin={{ ...MARGIN, top: 22 }} barGap={2}>
          <CartesianGrid {...gridProps(pal)} />
          <XAxis dataKey="name" {...axisProps(pal)} interval={0} height={44} tick={{ fill: pal.ink2, fontSize: 12, width: 110 } as object} />
          <YAxis {...yAxisProps(pal)} tickFormatter={pctTick} width={44} domain={[0, 1]} />
          <Tooltip cursor={cursorBand(pal)} content={({ active, payload }) => active && payload?.length ? (
            <TipBox title={payload[0].payload.name} rows={[
              { label: "Defaults caught", value: pct(payload[0].payload.caught), color: pal.today, shape: "rect" },
              { label: "Good loans flagged", value: pct(payload[0].payload.false_alarms), color: pal.neutral, shape: "rect" },
            ]} />) : null} />
          <Bar dataKey="caught" fill={pal.today} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
            <LabelList dataKey="caught" position="top" formatter={pctTick} style={{ fill: pal.ink, fontSize: 12, fontWeight: 650 }} />
          </Bar>
          <Bar dataKey="false_alarms" fill={pal.neutral} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
            <LabelList dataKey="false_alarms" position="top" formatter={pctTick} style={{ fill: pal.ink2, fontSize: 12 }} />
          </Bar>
        </BarChart>
      )}</Sized>
    </ChartFrame>
  );
}

function SingleBars({ title, sub, data, xKey, yKey, color, xLabel, tipLabel, tableLabel, extra }: {
  title: string; sub: string; data: Record<string, unknown>[]; xKey: string; yKey: string; color: string; xLabel?: string;
  tipLabel: string; tableLabel: string; extra?: (d: Record<string, unknown>) => string;
}) {
  const pal = usePalette();
  const table = (
    <DataTable caption={title} rows={data} columns={[
      { key: "x", label: xLabel ?? "Group", render: (d) => String(d[xKey]) },
      { key: "y", label: tableLabel, align: "r", render: (d) => pct(d[yKey] as number) },
      ...(extra ? [{ key: "e", label: "Count", align: "r" as const, render: (d: Record<string, unknown>) => extra(d) }] : []),
    ]} />
  );
  return (
    <ChartFrame title={title} sub={sub} table={table}>
      <Sized height={280}>{(w) => (
        <BarChart width={w} height={280} data={data} margin={{ ...MARGIN, top: 22 }}>
          <CartesianGrid {...gridProps(pal)} />
          <XAxis dataKey={xKey} {...axisProps(pal)} interval={0} height={28} />
          <YAxis {...yAxisProps(pal)} tickFormatter={pctTick} width={44} />
          <Tooltip cursor={cursorBand(pal)} content={({ active, payload }) => active && payload?.length ? (
            <TipBox title={String(payload[0].payload[xKey])} rows={[{ label: tipLabel, value: pct(payload[0].payload[yKey]) + (extra ? ` (${extra(payload[0].payload)})` : "") }]} />
          ) : null} />
          <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
            <LabelList dataKey={yKey} position="top" formatter={pctTick} style={{ fill: pal.ink, fontSize: 12, fontWeight: 650 }} />
          </Bar>
        </BarChart>
      )}</Sized>
    </ChartFrame>
  );
}

function TippingChart({ f }: { f: FindingT }) {
  const pal = usePalette();
  const xs = [...new Set(f.tipping_point.map((t) => t.bills_pct))].sort((a, b) => a - b);
  const data = xs.map((x) => ({
    bills: x,
    employed: f.tipping_point.find((t) => t.bills_pct === x && t.income === "Employed")?.under_3 ?? null,
    ei: f.tipping_point.find((t) => t.bills_pct === x && t.income !== "Employed")?.under_3 ?? null,
  }));
  const table = (
    <DataTable caption="Share under 3 months as bills rise" rows={data} maxHeight={320} columns={[
      { key: "b", label: "Bills increase", render: (d) => `+${pct(d.bills)}` },
      { key: "e", label: "Employed", align: "r", render: (d) => pct(d.employed, 1) },
      { key: "i", label: "On EI (55%)", align: "r", render: (d) => pct(d.ei, 1) },
    ]} />
  );
  return (
    <ChartFrame title="No tipping point: bills add up slowly, job loss doesn't" sub="Share of all customers under 3 months (left) as household bills rise (bottom)"
                legend={[{ label: "Employed", color: pal.today, shape: "line" }, { label: "On EI at 55%", color: pal.shock, shape: "line" }]} table={table}>
      <Sized height={280}>{(w) => (
        <LineChart width={w} height={280} data={data} margin={{ ...MARGIN, right: 24 }}>
          <CartesianGrid {...gridProps(pal)} />
          <XAxis dataKey="bills" type="number" domain={[0, "dataMax"]} {...axisProps(pal)} tickFormatter={(v) => `+${Math.round(v * 100)}%`} height={40} />
          <YAxis {...yAxisProps(pal)} tickFormatter={pctTick} width={44} />
          <Tooltip cursor={cursorLine(pal)} content={({ active, payload }) => active && payload?.length ? (
            <TipBox title={`Bills +${Math.round(payload[0].payload.bills * 100)}%`} rows={[
              { label: "On EI", value: pct(payload[0].payload.ei, 1), color: pal.shock },
              { label: "Employed", value: pct(payload[0].payload.employed, 1), color: pal.today },
            ]} />) : null} />
          <Line dataKey="employed" stroke={pal.today} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2 }} />
          <Line dataKey="ei" stroke={pal.shock} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2 }} />
        </LineChart>
      )}</Sized>
    </ChartFrame>
  );
}

export default function Finding() {
  const pal = usePalette();
  const advanced = useAdvanced();
  const { setView } = useAppState();
  const q = useQuery({ queryKey: ["finding"], queryFn: api.finding, staleTime: Infinity });
  useEffect(() => { document.title = "Main finding, Toonie"; }, []);
  const pageRef = useRef<HTMLDivElement>(null);
  useReveal(pageRef, `${!!q.data}-${advanced}`);
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Loading what="the finding" />;
  const f = q.data;
  const m = f.main;
  const income = f.fragile_groups.filter((g) => g.dimension === "income_band");
  const age = f.fragile_groups.filter((g) => g.dimension === "age_band");
  const oldest = age.length ? age[age.length - 1] : null;

  return (
    <div className="pg" ref={pageRef}>
      <header className="pg-finding-head reveal">
        <p className="pg-eyebrow">The twist is the early warning</p>
        <h1 className="finding-head">
          Stress-testing every customer against the EI twist each month flags {pct(m.caught)} of the loans that later defaulted,
          a median of {m.median_lead.toFixed(0)} months before the default was on record.
        </h1>
        <p className="fine">
          Checked against the 682 real loan outcomes, using only the data the bank had at each month. A default counts as on record at
          the loan's end for finished loans and in Dec 2025 for running ones, so the true warning time may be shorter.
        </p>
      </header>

      <div className="pg-stats lead-first reveal">
        <Stat label={advanced ? "Defaults caught" : "Problem loans spotted early"} value={pct(m.caught)} />
        <Stat label={advanced ? "Median warning" : "Typical warning time"} value={`${m.median_lead.toFixed(0)} months`} />
        <Stat label={advanced ? "Default rate if flagged" : "Flagged customers who later defaulted"} value={pct(m.rate_flagged)}
              sub={`${m.ratio.toFixed(0)}× the rate of everyone else`} />
        {advanced && <Stat label="Default rate if not flagged" value={pct(m.rate_not_flagged, 1)} />}
        {advanced && <Stat label="Good loans flagged" value={pct(m.false_alarms)} sub="false alarms" />}
      </div>

      <section className="section reveal" aria-label="Warning rules and default rates">
        <div className={advanced ? "pg-grid" : undefined} style={advanced ? undefined : { maxWidth: 760 }}>
          {advanced && <div className="pg-card"><RulesChart f={f} /></div>}
          <div className="pg-card">
            <SingleBars title={advanced ? "Default rate by today's runway" : "Thinner savings, more defaults"}
                        sub={advanced ? "Loans grouped by the customer's runway with no shock, in months" : "Share of loans that defaulted, by how many months the customer's savings would last"}
                        data={f.default_by_band.map((d) => ({ ...d, band: d.band.startsWith("No shortfall") ? "No gap" : d.band }))} xKey="band" yKey="default_rate" color={pal.critical} xLabel="Runway today (months)"
                        tipLabel="Defaulted" tableLabel="Default rate" extra={(d) => `${d.defaults} of ${d.loans}`} />
          </div>
        </div>
      </section>

      {!advanced && (
        <p className="advanced-hint">
          Want to compare warning rules, see who is most exposed and how each twist plays out across the bank?
          <button type="button" className="btn" onClick={() => setView("advanced")}>Switch to advanced view</button>
        </p>
      )}
      {advanced && <>
      <section className="section reveal">
        <SectionHead title="What else the data says" />
        <div className="pg-grid">
          <div className="pg-card">
            <SingleBars title="Higher earners are the most exposed to losing their job" sub="Share who can't last 6 months on EI, by income band"
                        data={income} xKey="group" yKey="share_fail_6m_ei" color={pal.today} xLabel="Income band"
                        tipLabel="Can't last 6 months" tableLabel="Can't last 6 months on EI" extra={(d) => `${d.customers} customers`} />
            <p className="fine">Their spending is high next to their buffer, so losing 45% of income opens a big monthly gap.
              {oldest ? ` Customers ${oldest.group} are the safest (${pct(oldest.share_fail_6m_ei)} can't last), likely thanks to pensions.` : ""}</p>
          </div>
          <div className="pg-card">
            <TippingChart f={f} />
            <p className="fine">Canadian realism: {pct(f.ei_cap.hit)} of customers earn more than EI's $729 weekly maximum covers.
              Applying the real cap pushes another {pct(f.ei_cap.crossed)} of all customers below 6 months on EI.</p>
          </div>
        </div>
        <div className="pg-callout">
          <span>
            Region doesn't explain fragility. Across {f.regional.districts} districts the share failing 6 months on EI barely moves with
            unemployment (r = {f.regional.r_unemployment.toFixed(2)}) or salary (r = {f.regional.r_salary.toFixed(2)}). It's the household, not the postcode.
          </span>
        </div>
      </section>

      <section className="section reveal">
        <SectionHead title="Each twist across all 4,500 customers" />
        <div className="pg-card flush wrap-sm">
          <DataTable caption="Each example twist across every customer" rows={f.twist_impact} columns={[
            { key: "t", label: "Twist", render: (r) => r.twist },
            { key: "u3", label: "Under 3 months", align: "r", render: (r) => pct(r.under_3, 1) },
            { key: "u6", label: "Under 6 months", align: "r", render: (r) => pct(r.under_6, 1) },
            { key: "o", label: "Out of money", align: "r", render: (r) => pct(r.out_of_money, 1) },
            { key: "m", label: "Median runway", align: "r", render: (r) => (r.median_runway >= 120 ? "120+" : `${r.median_runway.toFixed(1)} months`) },
          ]} />
        </div>
      </section>
      </>}
    </div>
  );
}
