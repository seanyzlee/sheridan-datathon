import { useMemo } from 'react';
import { useSimBank } from '../../api/hooks';
import type { SimBankResponse } from '../../api/schemas';
import { Chart, type ChartOption } from '../../components/Chart';
import { axisCommon, base, C, grid, tooltip } from '../../components/chartTheme';
import { Badge, Button, Card, Empty, ErrorNote, SkeletonBlock } from '../../components/ui';
import { DATA_SOURCE, featureOn, SIM } from '../../lib/config';
import { int, pct, pct1, seconds } from '../../lib/format';
import { useTween } from '../../lib/hooks';
import { describeShock, isNoShock, NO_DRAFT, PRESETS, sameDraft } from '../../lib/shock';
import { useScenarioState } from '../../state/scenario';
import t from '../tabs.module.css';

function histOption(b: SimBankResponse): ChartOption {
  return {
    ...base,
    grid: grid({ left: 52, top: 16, bottom: 44 }),
    tooltip: { ...tooltip, formatter: (ps: { dataIndex: number }[]) => { const h = b.histogram[ps[0]?.dataIndex ?? 0]!; return `${h.label} months: <b>${int(h.count)}</b> customers (${pct1(h.count / b.n_accounts)})`; } },
    xAxis: { type: 'category', data: b.histogram.map((h) => h.label), ...axisCommon, name: 'Runway after the shock (months)', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: C.text } },
    yAxis: { type: 'value', ...axisCommon, name: 'customers', nameTextStyle: { color: C.text } },
    series: [
      {
        id: 'hist',
        type: 'bar',
        data: b.histogram.map((h) => ({ value: h.count, itemStyle: { color: h.under_3 ? C.red : h.label === '120+' ? C.green : C.orange, borderRadius: [3, 3, 0, 0] } })),
        barWidth: '70%',
        label: { show: true, position: 'top', fontSize: 10, color: C.ink, formatter: (p: { value: number }) => (p.value ? int(p.value) : '') },
      },
    ],
  };
}

function heatOption(b: SimBankResponse): ChartOption {
  const regions = [...new Set(b.regions.map((r) => r.region))];
  const max = Math.max(0.05, ...b.regions.map((r) => r.share_under_3));
  return {
    ...base,
    grid: grid({ left: 120, top: 8, bottom: 56, right: 16 }),
    tooltip: {
      ...tooltip,
      trigger: 'item',
      formatter: (p: { data: { value: [number, number, number] } }) => {
        const [qx, ry] = p.data.value;
        const r = b.regions.find((x) => x.region === regions[ry] && x.income_quintile === qx + 1)!;
        return `${r.region}, income Q${r.income_quintile}<br/><b>${pct(r.share_under_3)}</b> under 3 months (${int(r.accounts)} accounts)`;
      },
    },
    xAxis: { type: 'category', data: ['Q1 lowest', 'Q2', 'Q3', 'Q4', 'Q5 highest'], ...axisCommon, splitArea: { show: false } },
    yAxis: { type: 'category', data: regions, ...axisCommon },
    visualMap: {
      min: 0,
      max,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemHeight: 120,
      itemWidth: 10,
      text: [pct(max), '0%'],
      textStyle: { color: C.text, fontSize: 11 },
      inRange: { color: ['#FFF5EE', '#F4A26F', '#C2540F', '#7A1A12'] },
    },
    series: [
      {
        id: 'heat',
        type: 'heatmap',
        // Dark text on light cells, white text on dark cells, for contrast.
        data: b.regions.map((r) => ({
          value: [r.income_quintile - 1, regions.indexOf(r.region), r.share_under_3],
          label: { color: r.share_under_3 > max * 0.45 ? '#ffffff' : C.ink },
        })),
        label: { show: true, fontSize: 10, fontWeight: 600, formatter: (p: { data: { value: [number, number, number] } }) => pct(p.data.value[2]) },
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 3 },
      },
    ],
  };
}

export function BankTab() {
  const { shock, target, draft, setDraft, setTab, pendingInput } = useScenarioState();
  const bank = useSimBank(shock, target, featureOn('bank'));
  const b = bank.data;
  const share = useTween(b ? b.share_under_3 * 100 : 0);
  const hist = useMemo(() => (b ? histOption(b) : null), [b]);
  const heat = useMemo(() => (b ? heatOption(b) : null), [b]);
  const busy = pendingInput || bank.isFetching;

  if (!featureOn('bank')) return <Empty>The bank-wide panel is turned off (VITE_DISABLED_FEATURES).</Empty>;
  const delta = b ? b.share_under_3 - b.base_share_under_3 : 0;

  return (
    <div className={t.page}>
      <div className={t.intro}>
        <div>
          <h1>Bank-wide stress test</h1>
          <p>
            Every customer under the current shock: {isNoShock(shock) ? 'no shock applied' : describeShock(shock)}. Runway uses the judges’ formula;
            survival uses the simulation over {target} months.
          </p>
        </div>
        <div className={t.chips}>
          {PRESETS.map((p, i) => (
            <Button key={p.id} size="sm" variant={sameDraft(p.draft, draft) ? 'primary' : 'default'} onClick={() => setDraft(p.draft)}>
              {i + 1} · {p.title}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setDraft(NO_DRAFT)}>
            Reset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTab('advisor')}>
            Edit shock →
          </Button>
        </div>
      </div>

      {bank.error && !b && <ErrorNote error={bank.error} />}

      <div className={t.stats}>
        <Card title="Under 3 months of runway" busy={busy}>
          {b ? (
            <>
              <div className={t.big} aria-live="polite">{Math.round(share)}%</div>
              <div className={t.muted}>
                {int(b.count_under_3)} of {int(b.n_accounts)} customers{' '}
                <span className={t.delta} data-dir={delta > 0 ? 'up' : 'down'}>
                  {delta === 0 ? '· same as no shock' : `· ${delta > 0 ? '+' : '−'}${pct1(Math.abs(delta))} vs no shock`}
                </span>
              </div>
            </>
          ) : (
            <SkeletonBlock lines={2} chart={48} />
          )}
        </Card>
        <Card title={`Average chance of lasting ${target} months`} tag="Simulation" busy={busy}>
          {b ? (
            <>
              <div className={t.mid}>{pct(b.mean_survival_prob)}</div>
              <div className={t.muted}>Mean survival probability across all customers</div>
            </>
          ) : (
            <SkeletonBlock lines={2} />
          )}
        </Card>
        <Card title="Likely to run out" tag="Simulation" busy={busy}>
          {b ? (
            <>
              <div className={t.mid}>{pct(b.share_survival_below_50)}</div>
              <div className={t.muted}>Customers with under a 50% chance of lasting {target} months</div>
            </>
          ) : (
            <SkeletonBlock lines={2} />
          )}
        </Card>
        <div className={t.timerCard} aria-live="polite">
          {b ? (
            <>
              <span className={t.tline}>
                <b>{int(b.n_accounts)}</b> customers × <b>{int(b.n_paths)}</b> futures
                <br />
                in <b>{seconds(b.compute_ms)}</b>
              </span>
              <small>
                {b.engine === 'cpp' ? 'C++ core (OpenMP)' : b.engine === 'numpy' ? 'NumPy fallback' : 'In-browser JS mock'} · {b.months} months · seed {b.seed}
              </small>
              {DATA_SOURCE === 'mock' && b.n_paths < SIM.bankPaths && (
                <small>The mock runs {int(b.n_paths)} of the {int(SIM.bankPaths)} requested paths. The C++ core runs all of them.</small>
              )}
            </>
          ) : (
            <span className={t.tline}>Running {int(4500)} × {int(SIM.bankPaths)} futures…</span>
          )}
        </div>
      </div>

      <div className={t.grid21}>
        <Card title="Runway across the bank" sub="Red bars are under 3 months. Green is no shortfall or the 120-month cap." busy={busy}>
          {hist ? <Chart option={hist} height={300} ariaLabel="Histogram of runway after the shock across all customers" /> : <SkeletonBlock chart={300} lines={0} />}
        </Card>
        {featureOn('region-map') && (
          <Card title="Where the risk sits" sub="Share under 3 months by region and income quintile" busy={busy} actions={<Badge tone="neutral">{b ? `${b.regions.length} cells` : '…'}</Badge>}>
            {heat ? <Chart option={heat} height={300} ariaLabel="Heatmap of share under 3 months by region and income" /> : <SkeletonBlock chart={300} lines={0} />}
          </Card>
        )}
      </div>
    </div>
  );
}
