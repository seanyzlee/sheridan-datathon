import { useEffect, useMemo, useState } from 'react';
import { useBenchmark, useDefaults, useEiCap, useFinding, useTimeMachine, useTimeMachineList, useTipping } from '../../api/hooks';
import type { Benchmark, Defaults, EiCap, Finding, Tipping, TimeMachineReplay } from '../../api/schemas';
import { Chart, type ChartOption } from '../../components/Chart';
import { axisCommon, base, C, grid, tooltip } from '../../components/chartTheme';
import { Badge, Button, Card, ErrorNote, SkeletonBlock, Stat } from '../../components/ui';
import { featureOn } from '../../lib/config';
import { cad, int, monthLabel, pct, runwayNumber, seconds } from '../../lib/format';
import t from '../tabs.module.css';

const fmtY = (f: Finding['chart']['y_format']) => (v: number) => (f === 'percent' ? pct(v) : f === 'months' ? `${v.toFixed(1)}` : int(v));

// ---------- main finding ----------

function MainFinding() {
  const q = useFinding();
  const option = useMemo<ChartOption | null>(() => {
    const f = q.data;
    if (!f) return null;
    const fmt = fmtY(f.chart.y_format);
    return {
      ...base,
      grid: grid({ left: 48, top: 24, bottom: 40 }),
      tooltip: { ...tooltip, valueFormatter: (v: number) => fmt(v) },
      xAxis: { type: 'category', data: f.chart.categories, ...axisCommon, name: f.chart.x_label, nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: C.text } },
      yAxis: { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: fmt } },
      series: [
        {
          id: 'f',
          type: 'bar',
          barWidth: '55%',
          data: f.chart.values.map((v, i) => ({ value: v, itemStyle: { color: i === f.chart.highlight_index ? C.orange : C.ink, borderRadius: [4, 4, 0, 0] } })),
          label: { show: true, position: 'top', formatter: (p: { value: number }) => fmt(p.value), color: C.ink, fontWeight: 600 },
        },
      ],
    };
  }, [q.data]);

  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data || !option) return <Card title="Main finding"><SkeletonBlock chart={240} lines={2} /></Card>;
  return (
    <section className={t.finding}>
      <div>
        <div className={t.findingKicker}>Main finding</div>
        <h2 className={t.findingHead}>{q.data.headline}</h2>
        <p className={t.findingText}>{q.data.sentence}</p>
        <p className={t.method}>Method: {q.data.method}</p>
      </div>
      <Chart option={option} height={260} ariaLabel={q.data.headline} />
    </section>
  );
}

// ---------- D5 defaults ----------

function defaultsOption(d: Defaults): ChartOption {
  return {
    ...base,
    grid: grid({ left: 44, top: 24, bottom: 40 }),
    tooltip: { ...tooltip, formatter: (ps: { dataIndex: number }[]) => { const b = d.bands[ps[0]?.dataIndex ?? 0]!; return `${b.label}: <b>${pct(b.default_rate)}</b> defaulted (${b.defaults} of ${b.loans} loans)`; } },
    xAxis: { type: 'category', data: d.bands.map((b) => b.label), ...axisCommon, name: 'Runway on EI 55% (stress test)', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: C.text } },
    yAxis: { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => pct(v) } },
    series: [
      {
        id: 'd',
        type: 'bar',
        barWidth: '55%',
        data: d.bands.map((b, i) => ({ value: b.default_rate, itemStyle: { color: i === 0 ? C.red : i === d.bands.length - 1 ? C.green : C.orange, borderRadius: [4, 4, 0, 0] } })),
        label: { show: true, position: 'top', formatter: (p: { value: number }) => pct(p.value), color: C.ink, fontWeight: 600 },
        markLine: { silent: true, symbol: 'none', data: [{ yAxis: d.overall_rate, lineStyle: { color: C.grey, type: 'dashed' }, label: { formatter: `all loans ${pct(d.overall_rate)}`, position: 'insideEndTop', color: C.text } }] },
      },
    ],
  };
}

function DefaultsCard() {
  const q = useDefaults();
  const option = useMemo(() => (q.data ? defaultsOption(q.data) : null), [q.data]);
  const d = q.data;
  return (
    <Card title="Does the engine predict real defaults?" tag="D5" sub={d ? `${d.defaults_total} defaults among ${d.loans_total} loans` : undefined}>
      {q.error ? (
        <ErrorNote error={q.error} />
      ) : !d || !option ? (
        <SkeletonBlock chart={220} lines={1} />
      ) : (
        <>
          <p className={t.callout}>
            {d.ratio !== null ? (
              <>
                Customers in the lowest runway band defaulted at <b>{d.ratio.toFixed(1)}×</b> the rate of the highest band ({pct(d.bottom_band_rate)} vs {pct(d.top_band_rate)}).
              </>
            ) : (
              <>
                The lowest band defaulted at <b>{pct(d.bottom_band_rate)}</b>; the highest band had no defaults.
              </>
            )}
          </p>
          <Chart option={option} height={220} ariaLabel="Default rate by runway band" />
        </>
      )}
    </Card>
  );
}

// ---------- tipping point ----------

function tippingOption(tp: Tipping): ChartOption {
  const colors = [C.orange, C.ink, C.grey];
  const x = tp.axis.values.map((v) => pct(v));
  const tipX = x[tp.tipping_index]!;
  return {
    ...base,
    grid: grid({ left: 44, top: 32, bottom: 40 }),
    legend: { top: 0, right: 0, itemWidth: 14, itemHeight: 8, textStyle: { color: C.text, fontSize: 11 } },
    tooltip: { ...tooltip, valueFormatter: (v: number) => pct(v) },
    xAxis: { type: 'category', data: x, boundaryGap: false, ...axisCommon, name: tp.axis.label, nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: C.text } },
    yAxis: { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => pct(v) } },
    series: tp.series.map((sr, i) => ({
      id: `s${i}`,
      name: sr.label,
      type: 'line',
      data: sr.share_under_3,
      symbol: 'circle',
      symbolSize: i === tp.headline_series ? 6 : 4,
      lineStyle: { color: colors[i % colors.length], width: i === tp.headline_series ? 3 : 1.5 },
      itemStyle: { color: colors[i % colors.length] },
      markLine:
        i === tp.headline_series
          ? { silent: true, symbol: 'none', data: [{ xAxis: tipX, lineStyle: { color: C.red, type: 'dashed' }, label: { formatter: 'tipping point', color: C.red, position: 'insideEndTop' } }] }
          : undefined,
    })),
  };
}

function TippingCard() {
  const q = useTipping();
  const option = useMemo(() => (q.data ? tippingOption(q.data) : null), [q.data]);
  return (
    <Card title="Where the bank tips over" sub={q.data ? `Share of all ${int(q.data.n_accounts)} customers under 3 months, per shock size` : undefined} actions={q.data && <Badge>{seconds(q.data.compute_ms)} sweep</Badge>}>
      {q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data || !option ? (
        <SkeletonBlock chart={220} lines={1} />
      ) : (
        <>
          <p className={t.callout}>{q.data.sentence}</p>
          <Chart option={option} height={220} ariaLabel="Share under 3 months against shock size" />
        </>
      )}
    </Card>
  );
}

// ---------- D8 EI cap ----------

function eiOption(e: EiCap): ChartOption {
  return {
    ...base,
    grid: grid({ left: 44, top: 32, bottom: 40 }),
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: C.text, fontSize: 11 } },
    tooltip: { ...tooltip, valueFormatter: (v: number) => `${v.toFixed(1)} months` },
    xAxis: { type: 'category', data: e.by_quintile.map((q) => `Q${q.income_quintile}`), ...axisCommon, name: 'Income quintile', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: C.text } },
    yAxis: { type: 'value', ...axisCommon, name: 'median runway (months)', nameTextStyle: { color: C.text } },
    series: [
      { id: 'j', name: 'Judges’ EI (55% × I)', type: 'bar', data: e.by_quintile.map((q) => q.median_runway_judges), itemStyle: { color: C.ink, borderRadius: [3, 3, 0, 0] } },
      { id: 'c', name: `Capped at ${cad(e.ei_weekly_max)}/week`, type: 'bar', data: e.by_quintile.map((q) => q.median_runway_capped), itemStyle: { color: C.orange, borderRadius: [3, 3, 0, 0] } },
    ],
  };
}

function EiCapCard() {
  const q = useEiCap();
  const option = useMemo(() => (q.data ? eiOption(q.data) : null), [q.data]);
  const e = q.data;
  return (
    <Card title="Canadian EI reality check" tag="D8" sub={e ? <>Judges use 55% × I. Real EI also caps at {cad(e.ei_weekly_max)}/week ({cad(e.ei_monthly_max)}/month). <a href={e.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--orange-700)' }}>canada.ca</a></> : undefined}>
      {q.error ? (
        <ErrorNote error={q.error} />
      ) : !e || !option ? (
        <SkeletonBlock chart={200} lines={2} />
      ) : (
        <>
          <div className={t.statRow}>
            <Stat label="Customers who lose runway" value={int(e.accounts_affected)} hint={`${pct(e.accounts_affected / e.accounts_total)} of the bank`} />
            <Stat label="Average runway lost" value={`${e.avg_runway_lost.toFixed(1)} mo`} hint="Among those affected" />
            <Stat label="Under 3 months" value={`${int(e.under_3_judges)} → ${int(e.under_3_capped)}`} hint="Judges’ EI → capped EI" />
          </div>
          <Chart option={option} height={200} ariaLabel="Median runway on EI, judges versus capped, by income quintile" />
        </>
      )}
    </Card>
  );
}

// ---------- benchmark ----------

function benchOption(b: Benchmark): ChartOption {
  const rows = [...b.rows].reverse();
  return {
    ...base,
    grid: grid({ left: 116, right: 96, top: 8, bottom: 28 }),
    tooltip: { ...tooltip, valueFormatter: (v: number) => `${v} s` },
    xAxis: { type: 'log', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => `${v}s` } },
    yAxis: { type: 'category', data: rows.map((r) => r.label), ...axisCommon },
    series: [
      {
        id: 'b',
        type: 'bar',
        barWidth: 16,
        data: rows.map((r) => ({ value: r.seconds, itemStyle: { color: r.engine === 'cpp_all' ? C.orange : r.engine === 'python' ? C.grey : C.ink, borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'right', color: C.ink, fontWeight: 600, formatter: (p: { dataIndex: number }) => { const r = rows[p.dataIndex]!; return `${r.seconds < 1 ? r.seconds.toFixed(2) : r.seconds.toFixed(1)} s · ${Math.round(r.speedup)}×`; } },
      },
    ],
  };
}

function BenchmarkCard() {
  const q = useBenchmark();
  const option = useMemo(() => (q.data ? benchOption(q.data) : null), [q.data]);
  const b = q.data;
  return (
    <Card
      title="Why C++"
      tag="D1"
      sub={b ? `Bank-wide run: ${int(b.workload.accounts)} customers × ${int(b.workload.paths)} paths × ${b.workload.months} months = ${int(b.workload.accounts * b.workload.paths * b.workload.months)} steps` : undefined}
      actions={b && (b.measured ? <Badge tone="good">Measured · {b.threads} threads</Badge> : <Badge tone="warn">Placeholder</Badge>)}
    >
      {q.error ? <ErrorNote error={q.error} /> : !b || !option ? <SkeletonBlock chart={180} lines={0} /> : <Chart option={option} height={180} ariaLabel="Benchmark of Python, NumPy and C++" />}
      {b && <span className={t.muted}>{b.machine}. Log scale.</span>}
    </Card>
  );
}

// ---------- D6 time machine ----------

function tmOption(r: TimeMachineReplay, step: number): ChartOption {
  const months = r.months.map((m) => monthLabel(m.month));
  const vals = r.months.map((m) => (m.runway.status === 'no_shortfall' ? 24 : Math.min(m.runway.months, 24)));
  const flagIdx = r.first_flag_month ? r.months.findIndex((m) => m.month === r.first_flag_month) : -1;
  const defIdx = r.months.findIndex((m) => m.month === r.default_month);
  const lines: object[] = [{ yAxis: r.flag_threshold_months, lineStyle: { color: C.red, type: 'dashed' }, label: { formatter: `flag < ${r.flag_threshold_months} mo`, color: C.red, position: 'insideStartTop' } }];
  if (defIdx >= 0) lines.push({ xAxis: months[defIdx], lineStyle: { color: C.ink, type: 'solid', width: 2 }, label: { formatter: 'default', color: C.ink, position: 'insideEndTop' } });
  if (flagIdx >= 0) lines.push({ xAxis: months[flagIdx], lineStyle: { color: C.orange, type: 'solid', width: 2 }, label: { formatter: 'first flag', color: '#9A420B', position: 'insideEndTop' } });
  return {
    ...base,
    animationDurationUpdate: 250,
    grid: grid({ left: 40, top: 24, bottom: 28 }),
    tooltip: { ...tooltip, formatter: (ps: { dataIndex: number }[]) => { const m = r.months[ps[0]?.dataIndex ?? 0]!; return `${monthLabel(m.month)}: runway on EI <b>${runwayNumber(m.runway)}</b><br/>B ${cad(m.B)} · I ${cad(m.I)} · S ${cad(m.S)}`; } },
    xAxis: { type: 'category', data: months, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, interval: 2 } },
    yAxis: { type: 'value', ...axisCommon, max: 24, name: 'months', nameTextStyle: { color: C.text } },
    series: [
      {
        id: 'tm',
        type: 'line',
        data: vals.map((v, i) => (i <= step ? v : null)),
        symbol: 'circle',
        symbolSize: (_: number, p: { dataIndex: number }) => (p.dataIndex === step ? 10 : 5),
        lineStyle: { color: C.orange, width: 2.5 },
        itemStyle: { color: C.orange },
        areaStyle: { color: C.orangeFaint },
        markLine: { silent: true, symbol: 'none', data: lines },
      },
    ],
  };
}

function TimeMachineCard() {
  const list = useTimeMachineList(true);
  const [id, setId] = useState<number | null>(null);
  const replay = useTimeMachine(id);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const r = replay.data;

  useEffect(() => {
    if (id === null && list.data?.accounts[0]) setId(list.data.accounts[0].account_id);
  }, [list.data, id]);
  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [id]);
  useEffect(() => {
    if (!playing || !r) return;
    if (step >= r.months.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((x) => x + 1), 420);
    return () => clearTimeout(timer);
  }, [playing, step, r]);

  const option = useMemo(() => (r ? tmOption(r, step) : null), [r, step]);
  const cur = r?.months[step];
  const flagged = r && cur && r.first_flag_month && cur.month >= r.first_flag_month;

  return (
    <Card
      title="Time machine"
      tag="D6"
      sub="Replay a customer who defaulted. Each month uses only the data available up to that month."
      actions={
        list.data && (
          <select className={t.select} value={id ?? ''} onChange={(e) => setId(Number(e.target.value))} aria-label="Defaulted account">
            {list.data.accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                #{a.account_id} · default {monthLabel(a.default_month)}
                {a.lead_months !== null ? ` · flagged ${a.lead_months} mo early` : ' · not flagged'}
              </option>
            ))}
          </select>
        )
      }
    >
      {list.error || replay.error ? (
        <ErrorNote error={list.error ?? replay.error} />
      ) : !r || !option || !cur ? (
        <SkeletonBlock chart={220} lines={2} />
      ) : (
        <>
          <p className={t.callout}>
            {r.lead_months !== null && r.first_flag_month ? (
              <>
                The engine flags #{r.account_id} in <b>{monthLabel(r.first_flag_month)}</b>, <b>{r.lead_months} months</b> before the loan defaulted in {monthLabel(r.default_month)}.
              </>
            ) : (
              <>The engine didn’t flag #{r.account_id} before the default in {monthLabel(r.default_month)}. Not every default is visible in the balance.</>
            )}
          </p>
          <Chart option={option} height={220} ariaLabel="Runway on EI month by month before default" />
          <div className={t.tmControls}>
            <Button size="sm" variant="primary" onClick={() => (step >= r.months.length - 1 ? (setStep(0), setPlaying(true)) : setPlaying(!playing))}>
              {playing ? 'Pause' : step >= r.months.length - 1 ? 'Replay' : 'Play'}
            </Button>
            <Button size="sm" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0} aria-label="Previous month">
              ◀
            </Button>
            <Button size="sm" onClick={() => setStep((x) => Math.min(r.months.length - 1, x + 1))} disabled={step >= r.months.length - 1} aria-label="Next month">
              ▶
            </Button>
            <input className={t.scrub} style={{ flex: 1 }} type="range" min={0} max={r.months.length - 1} value={step} onChange={(e) => setStep(Number(e.target.value))} aria-label="Month" />
          </div>
          <div className={t.tmStatus}>
            <Stat label="Month" value={monthLabel(cur.month)} />
            <Stat label="Runway on EI" value={runwayNumber(cur.runway)} valueStyle={{ color: flagged ? 'var(--red-600)' : undefined }} hint={flagged ? 'Flagged' : 'Not flagged'} />
            <Stat label="Buffer B" value={cad(cur.B)} />
            <Stat label="Income I" value={cad(cur.I)} />
          </div>
        </>
      )}
    </Card>
  );
}

export function DiscoveryTab() {
  return (
    <div className={t.page}>
      <div className={t.intro}>
        <div>
          <h1>Discovery</h1>
          <p>What the engine finds across all customers, checked against real loan outcomes.</p>
        </div>
      </div>
      <MainFinding />
      <div className={t.grid2}>
        <DefaultsCard />
        <TippingCard />
      </div>
      <div className={t.grid2}>
        <EiCapCard />
        <BenchmarkCard />
      </div>
      {featureOn('time-machine') && <TimeMachineCard />}
    </div>
  );
}
