import { useMemo } from 'react';
import type { ScenarioResponse, WaterfallKey } from '../../api/schemas';
import { Chart, type ChartOption } from '../../components/Chart';
import { axisCommon, base, C, grid, moneyAxis, tooltip } from '../../components/chartTheme';
import { Card, SkeletonBlock } from '../../components/ui';
import { cad, cadCompact, runwayBar, runwayNumber } from '../../lib/format';
import s from './advisor.module.css';

const STEP_LABEL: Record<WaterfallKey, string> = {
  base: 'Today',
  income: 'Income loss',
  bills: 'Bills',
  other: 'Rent / other',
  one_off: 'One-off',
};

function waterfallOption(sc: ScenarioResponse): ChartOption {
  const steps = sc.waterfall;
  const cats = [...steps.map((x) => STEP_LABEL[x.key]), 'After shock'];
  const invisible: number[] = [];
  const up: (number | '-')[] = [];
  const down: (number | '-')[] = [];
  const totals: (number | '-')[] = [];
  const labels: string[] = [];

  steps.forEach((st, i) => {
    const v = runwayBar(st.runway);
    if (i === 0) {
      invisible.push(0);
      totals.push(v);
      up.push('-');
      down.push('-');
      labels.push(runwayNumber(st.runway));
      return;
    }
    const prev = runwayBar(steps[i - 1]!.runway);
    const d = v - prev;
    invisible.push(Math.min(prev, v));
    totals.push('-');
    up.push(d > 0 ? d : '-');
    down.push(d < 0 ? -d : '-');
    // From "no shortfall" the drop has no real size, so label where it lands instead.
    const fromOpen = steps[i - 1]!.runway.status === 'no_shortfall';
    labels.push(Math.abs(d) < 0.05 ? '0' : fromOpen ? `→ ${runwayNumber(st.runway)}` : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`);
  });
  const last = steps[steps.length - 1]!.runway;
  invisible.push(0);
  totals.push(runwayBar(last));
  up.push('-');
  down.push('-');
  labels.push(runwayNumber(last));

  const maxV = Math.max(...steps.map((x) => runwayBar(x.runway)));
  const label = { show: true, position: 'top' as const, fontSize: 11, color: C.ink, fontWeight: 600, formatter: (p: { dataIndex: number }) => labels[p.dataIndex] ?? '' };
  return {
    ...base,
    grid: grid({ left: 40, top: 22 }),
    tooltip: { ...tooltip, formatter: (ps: { dataIndex: number }[]) => `${cats[ps[0]?.dataIndex ?? 0]}: ${labels[ps[0]?.dataIndex ?? 0]} months` },
    xAxis: { type: 'category', data: cats, ...axisCommon },
    yAxis: { type: 'value', ...axisCommon, max: maxV >= 120 ? 120 : undefined, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => `${v}` }, name: 'months', nameTextStyle: { color: C.text, fontSize: 11 } },
    series: [
      { id: 'inv', type: 'bar', stack: 'w', data: invisible, itemStyle: { color: 'transparent' }, silent: true, barWidth: '52%' },
      { id: 'tot', type: 'bar', stack: 'w', data: totals, itemStyle: { color: C.orange, borderRadius: [4, 4, 0, 0] }, label },
      { id: 'down', type: 'bar', stack: 'w', data: down, itemStyle: { color: C.red, borderRadius: [4, 4, 0, 0] }, label },
      { id: 'up', type: 'bar', stack: 'w', data: up, itemStyle: { color: C.green, borderRadius: [4, 4, 0, 0] }, label },
    ],
  };
}

export function WaterfallCard({ sc, loading }: { sc: ScenarioResponse | undefined; loading: boolean }) {
  const option = useMemo(() => (sc ? waterfallOption(sc) : null), [sc]);
  const capped = sc?.waterfall.some((w) => w.runway.status === 'no_shortfall' || w.runway.status === 'capped');
  return (
    <Card title="Explain the change" sub="Each part of the shock applied in turn (judges’ formula)" busy={loading}>
      {option ? (
        <>
          <Chart option={option} height={210} ariaLabel="Waterfall from today's runway to the runway after the shock" />
          {capped && <span className={s.fine}>Bars at 120 are “no shortfall” or the 120-month cap, labelled 120+ or 120.</span>}
        </>
      ) : (
        <SkeletonBlock chart={210} lines={0} />
      )}
    </Card>
  );
}

function burnOption(sc: ScenarioResponse): ChartOption {
  const bal = sc.burn_down.balance;
  const months = bal.map((_, i) => i);
  const z = sc.burn_down.zero_month;
  const T = sc.shock.income_months;
  const marks: object[] = [{ yAxis: 0, lineStyle: { color: C.red, type: 'solid', width: 1 }, label: { formatter: '$0', color: C.red, position: 'insideStartTop' } }];
  if (T > 0 && T <= bal.length - 1) {
    marks.push({ xAxis: String(T), lineStyle: { color: C.ink, type: 'dashed' }, label: { formatter: `EI ends (${T}m)`, color: C.ink, position: 'insideEndTop' } });
  }
  return {
    ...base,
    grid: grid({ left: 56, top: 22 }),
    tooltip: { ...tooltip, formatter: (ps: { dataIndex: number }[]) => `Month ${ps[0]?.dataIndex}: ${cad(bal[ps[0]?.dataIndex ?? 0]!)}` },
    xAxis: { type: 'category', data: months, boundaryGap: false, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, interval: 5, formatter: (v: string) => `${v}m` } },
    yAxis: moneyAxis(cadCompact),
    series: [
      {
        id: 'burn',
        type: 'line',
        data: bal,
        symbol: 'none',
        lineStyle: { width: 2.5, color: C.orange },
        itemStyle: { color: C.orange },
        areaStyle: { color: C.orangeFaint },
        markLine: { silent: true, symbol: 'none', data: marks },
        markArea: Math.min(...bal) < 0 ? { silent: true, itemStyle: { color: C.redFaint }, data: [[{ yAxis: Math.min(...bal) }, { yAxis: 0 }]] } : undefined,
        markPoint:
          z !== null
            ? {
                symbol: 'circle',
                symbolSize: 10,
                itemStyle: { color: C.red, borderColor: '#fff', borderWidth: 2 },
                label: { show: true, position: 'right', distance: 8, formatter: `Hits $0 at ${z.toFixed(1)}m`, color: C.red, fontWeight: 600, fontSize: 11, backgroundColor: '#fff', padding: [2, 4] },
                data: [{ coord: [Math.round(z), 0] }],
              }
            : undefined,
      },
    ],
  };
}

export function BurnDownCard({ sc, loading }: { sc: ScenarioResponse | undefined; loading: boolean }) {
  const option = useMemo(() => (sc ? burnOption(sc) : null), [sc]);
  return (
    <Card title="Buffer burn-down" sub="Month-by-month balance after the shock, at the judges’ constant gap" busy={loading}>
      {option ? <Chart option={option} height={210} ariaLabel="Balance after the shock by month" /> : <SkeletonBlock chart={210} lines={0} />}
    </Card>
  );
}
