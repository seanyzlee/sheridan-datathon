import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Line, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Finding as FindingT } from "../api";
import { anim, axisProps, cursorBand, cursorLine, EndLabel, gridProps, MARGIN, yAxisProps } from "../charts/common";
import { ChartFrame, DataTable, ErrorNote, Loading, SectionHead, Stat, TipBox } from "../components/ui";
import { pct } from "../format";
import { useAdvanced, useAppState } from "../state";
import { usePalette } from "../theme";
import { Sized } from "../components/Sized";
import { useReveal } from "../motion";
import { Swimlanes } from "../charts/Swimlanes";
import { PeopleRows } from "../charts/PeopleRows";
import { StoryMode, type StoryStep } from "../components/StoryMode";

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
    <ChartFrame title="Which warning rule works best" sub="Each rule checked every month on the 682 loans. The longer the bar, the more defaults it catches for each false alarm"
                legend={[{ label: "Good loans flagged", color: pal.neutral }, { label: "Defaults caught", color: pal.today }]} table={table} interactive
                label="Dumbbell chart comparing defaults caught with good loans flagged for each warning rule">
      <Sized height={26 + data.length * 58 + 104}>{(w) => <RulesDumbbell data={data} width={w} best="stress_ei_lt2" />}</Sized>
    </ChartFrame>
  );
}

/** One row per rule: a grey dot at the false-alarm rate, a blue dot at the catch rate, and the gap between them. */
function RulesDumbbell({ data, width, best }: { data: (FindingT["rules"][number] & { name: string })[]; width: number; best: string }) {
  const pal = usePalette();
  const [hover, setHover] = useState<string | null>(null);
  const narrow = width < 520;
  const labelW = narrow ? 0 : 196, right = 18, top = 26, row = 58;
  const x = (v: number) => labelW + v * (width - labelW - right);
  const shown = hover ?? best;
  const h = data.find((d) => d.rule === shown);
  return (
    <div className="dumbbell">
      <svg width={width} height={top + data.length * row} role="list" aria-label="Defaults caught and good loans flagged by each rule">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 8} y2={top + data.length * row - 10} stroke={pal.grid} />
            <text x={x(t)} y={12} textAnchor="middle" fill={pal.muted} fontSize={12}>{pctTick(t)}</text>
          </g>
        ))}
        {data.map((d, k) => {
          const cy = top + k * row + (narrow ? 34 : 20);
          const on = d.rule === shown;
          const isBest = d.rule === best;
          return (
            <g key={d.rule} className="dumbbell-row" tabIndex={0} role="listitem"
               aria-label={`${d.name}: catches ${pct(d.caught)} of defaults, flags ${pct(d.false_alarms)} of good loans`}
               onMouseEnter={() => setHover(d.rule)} onMouseLeave={() => setHover(null)}
               onFocus={() => setHover(d.rule)} onBlur={() => setHover(null)}>
              <rect x={0} y={cy - (narrow ? 32 : 22)} width={width} height={row - 6} rx={10}
                    fill={on ? pal.grid : "transparent"} opacity={on ? 0.55 : 0} />
              <text x={narrow ? 4 : 8} y={narrow ? cy - 16 : cy + 4} fill={isBest ? pal.ink : pal.ink2} fontSize={13} fontWeight={isBest ? 700 : 500}>
                {d.name}{isBest ? "  ★" : ""}
              </text>
              <line x1={x(d.false_alarms)} x2={x(d.caught)} y1={cy} y2={cy} stroke={isBest ? pal.today : pal.neutral} strokeOpacity={isBest ? 0.55 : 0.45}
                    strokeWidth={isBest ? 8 : 6} strokeLinecap="round" />
              <circle cx={x(d.false_alarms)} cy={cy} r={7} fill={pal.neutral} stroke={pal.surface} strokeWidth={2} />
              <circle cx={x(d.caught)} cy={cy} r={isBest ? 9 : 8} fill={pal.today} stroke={pal.surface} strokeWidth={2} />
              <text x={x(d.caught) + (d.caught > 0.85 ? -14 : 14)} y={cy + 4} textAnchor={d.caught > 0.85 ? "end" : "start"}
                    fill={pal.ink} fontSize={12} fontWeight={700} style={{ fontVariantNumeric: "tabular-nums" }}>{pctTick(d.caught)}</text>
              <text x={x(d.false_alarms) - 12} y={cy + 4} textAnchor="end" fill={pal.ink2} fontSize={12}
                    style={{ fontVariantNumeric: "tabular-nums" }}>{d.false_alarms >= 0.06 ? pctTick(d.false_alarms) : ""}</text>
            </g>
          );
        })}
      </svg>
      {h && (
        <p className="dumbbell-readout" aria-live="polite">
          <strong>{h.name}</strong>{h.rule === best ? " (the rule we recommend)" : ""}: catches <strong>{pct(h.caught)}</strong> of defaults,
          flags {pct(h.false_alarms)} of good loans and warns a median <strong>{h.median_lead_months.toFixed(0)} months</strong> ahead.
          Flagged customers default at {pct(h.default_rate_flagged)}, against {pct(h.default_rate_not_flagged, 1)} for the rest.
        </p>
      )}
    </div>
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
          <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} {...anim()}>
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
  })).map((d) => ({ ...d, gap: d.employed != null && d.ei != null ? [d.employed, d.ei] : null }));
  const last = data.length - 1;
  const table = (
    <DataTable caption="Share under 3 months as bills rise" rows={data} maxHeight={320} columns={[
      { key: "b", label: "Bills increase", render: (d) => `+${pct(d.bills)}` },
      { key: "e", label: "Employed", align: "r", render: (d) => pct(d.employed, 1) },
      { key: "i", label: "On EI (55%)", align: "r", render: (d) => pct(d.ei, 1) },
    ]} />
  );
  return (
    <ChartFrame title="No tipping point: bills add up slowly, job loss doesn't" sub="Share of all customers under 3 months (left) as household bills rise (bottom)"
                legend={[{ label: "Employed", color: pal.today, shape: "line" }, { label: "On EI at 55%", color: pal.shock, shape: "line" },
                         { label: "The job-loss gap", color: pal.shockWash, shape: "band" }]} table={table}
                label="Share of customers under 3 months as bills rise, employed and on EI, with the gap between them shaded">
      <Sized height={280}>{(w) => (
        <ComposedChart width={w} height={280} data={data} margin={{ ...MARGIN, top: 18, right: w < 520 ? 70 : 92 }}>
          <CartesianGrid {...gridProps(pal)} />
          <XAxis dataKey="bills" type="number" domain={[0, "dataMax"]} {...axisProps(pal)} tickFormatter={(v) => `+${Math.round(v * 100)}%`} height={40} />
          <YAxis {...yAxisProps(pal)} tickFormatter={pctTick} width={44} />
          <Tooltip cursor={cursorLine(pal)} content={({ active, payload }) => active && payload?.length ? (
            <TipBox title={`Bills +${Math.round(payload[0].payload.bills * 100)}%`} rows={[
              { label: "On EI", value: pct(payload[0].payload.ei, 1), color: pal.shock },
              { label: "Employed", value: pct(payload[0].payload.employed, 1), color: pal.today },
            ]} />) : null} />
          <Area dataKey="gap" stroke="none" fill={pal.shock} fillOpacity={0.13} {...anim()} activeDot={false} />
          <Line dataKey="employed" stroke={pal.today} strokeWidth={2} dot={false} {...anim()} activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2 }}
                label={<EndLabel last={last} text="Employed" color={pal.today} pal={pal} />} />
          <Line dataKey="ei" stroke={pal.shock} strokeWidth={2} dot={false} {...anim()} activeDot={{ r: 4, stroke: pal.surface, strokeWidth: 2 }}
                label={<EndLabel last={last} text="On EI" color={pal.shock} pal={pal} />} />
        </ComposedChart>
      )}</Sized>
    </ChartFrame>
  );
}

export default function Finding() {
  const pal = usePalette();
  const advanced = useAdvanced();
  const { setView } = useAppState();
  const q = useQuery({ queryKey: ["finding"], queryFn: api.finding, staleTime: Infinity });
  const lanes = useQuery({ queryKey: ["tm-list"], queryFn: api.timeMachineList, staleTime: Infinity, enabled: advanced });
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
  const under3 = f.default_by_band.find((d) => d.band === "Under 3");
  const base3 = f.rules.find((r) => r.rule === "base_lt3");
  const story: StoryStep[] = [
    { key: "headline", title: "The twist is the early warning",
      caption: `Every month we ran each loan customer through the judges' EI twist. Those whose savings would last under 2 months were flagged: that caught ${pct(m.caught)} of the loans that later defaulted.` },
    { key: "stats", title: "Early, and sharp",
      caption: `The warning came a median of ${m.median_lead.toFixed(0)} months ahead. Flagged customers defaulted ${m.ratio.toFixed(0)} times as often as everyone else (${pct(m.rate_flagged)} against ${pct(m.rate_not_flagged, 1)}).` },
    { key: "rules", title: "Why the twist, not today's runway",
      caption: base3
        ? `The same check on today's runway with no shock (under 3 months) catches ${pct(base3.caught)} of defaults, against ${pct(m.caught)} with the twist. Stress-testing is what makes the warning work.`
        : "Stress-testing is what makes the warning work." },
    { key: "lanes", title: "Every default, one lane each",
      caption: `Each bar runs from the first warning to the default on record. Half the warnings came more than ${m.median_lead.toFixed(0)} months ahead: time to call, plan and defer.` },
    { key: "bands", title: "Thin savings, more defaults",
      caption: under3 ? `Even without a shock, ${under3.in_words} customers whose savings would last under 3 months later defaulted.` : "Thinner savings go with more defaults." },
    { key: "tipping", title: "Job loss, not bills",
      caption: "Bills rising adds risk slowly; losing a job opens the gap at once. The shaded band is the difference losing a job makes." },
  ];

  return (
    <div className="pg" ref={pageRef}>
      <header className="pg-finding-head reveal" data-story="headline">
        <p className="pg-eyebrow">The twist is the early warning</p>
        <h1 className="finding-head">
          Stress-testing every customer against the EI twist each month flags {pct(m.caught)} of the loans that later defaulted,
          a median of {m.median_lead.toFixed(0)} months before the default was on record.
        </h1>
        <p className="fine">
          Checked against the 682 real loan outcomes, using only the data the bank had at each month. A default counts as on record at
          the loan's end for finished loans and in Dec 2025 for running ones, so the true warning time may be shorter.
        </p>
        <StoryMode steps={story} label={advanced ? "Walk me through it" : "Show me the story"} />
      </header>

      <div className="pg-stats lead-first reveal" data-story="stats">
        <Stat label={advanced ? "Defaults caught" : "Problem loans spotted early"} value={pct(m.caught)} />
        <Stat label={advanced ? "Median warning" : "Typical warning time"} value={`${m.median_lead.toFixed(0)} months`} />
        <Stat label={advanced ? "Default rate if flagged" : "Flagged customers who later defaulted"} value={pct(m.rate_flagged)}
              sub={`${m.ratio.toFixed(0)}× the rate of everyone else`} />
        {advanced && <Stat label="Default rate if not flagged" value={pct(m.rate_not_flagged, 1)} />}
        {advanced && <Stat label="Good loans flagged" value={pct(m.false_alarms)} sub="false alarms" />}
      </div>

      <section className="section reveal" aria-label="Warning rules and default rates">
        <div className={advanced ? "pg-grid" : undefined} style={advanced ? undefined : { maxWidth: 760 }}>
          {advanced && <div className="pg-card" data-story="rules"><RulesChart f={f} /></div>}
          <div className="pg-card" data-story="bands">
            {!advanced ? <PeopleRows bands={f.default_by_band} /> : <SingleBars title={advanced ? "Default rate by today's runway" : "Thinner savings, more defaults"}
                        sub={advanced ? "Loans grouped by the customer's runway with no shock, in months" : "Share of loans that defaulted, by how many months the customer's savings would last"}
                        data={f.default_by_band.map((d) => ({ ...d, band: d.band.startsWith("No shortfall") ? "No gap" : d.band }))} xKey="band" yKey="default_rate" color={pal.critical} xLabel="Runway today (months)"
                        tipLabel="Defaulted" tableLabel="Default rate" extra={(d) => `${d.defaults} of ${d.loans}`} />}
          </div>
        </div>
      </section>

      {advanced && (
        <section className="section reveal" aria-label="Warning time for each default">
          <div className="pg-card" data-story="lanes">
            {lanes.data ? <Swimlanes items={lanes.data.customers} medianLead={m.median_lead} />
              : lanes.isError ? <ErrorNote error={lanes.error} onRetry={() => lanes.refetch()} /> : <Loading what="the defaulted loans" />}
          </div>
        </section>
      )}

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
          <div className="pg-card" data-story="tipping">
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
