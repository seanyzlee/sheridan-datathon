import { useMemo } from 'react';
import type { AccountResponse } from '../../api/schemas';
import { Chart, type ChartOption } from '../../components/Chart';
import { axisCommon, base, C, grid, moneyAxis, tooltip } from '../../components/chartTheme';
import { Badge, Card, Empty, SkeletonBlock } from '../../components/ui';
import { featureOn } from '../../lib/config';
import { riskFlags } from '../../lib/flags';
import { cad, cadCompact, monthLabel, pct, runwayPhrase } from '../../lib/format';
import s from './advisor.module.css';

function historyOption(a: AccountResponse): ChartOption {
  const h = a.history;
  return {
    ...base,
    grid: grid({ left: 56, top: 30 }),
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: C.text, fontSize: 11 } },
    tooltip: {
      ...tooltip,
      valueFormatter: (v: number) => cad(v),
    },
    xAxis: { type: 'category', data: h.map((r) => monthLabel(r.month)), ...axisCommon, axisLabel: { ...axisCommon.axisLabel, interval: 2 } },
    yAxis: moneyAxis(cadCompact),
    series: [
      { id: 'in', name: 'Money in', type: 'bar', data: h.map((r) => r.money_in), itemStyle: { color: C.green, borderRadius: [2, 2, 0, 0] }, barGap: '10%', barWidth: '32%' },
      { id: 'out', name: 'Money out', type: 'bar', data: h.map((r) => r.money_out), itemStyle: { color: C.orange, borderRadius: [2, 2, 0, 0] }, barWidth: '32%' },
      {
        id: 'bal',
        name: 'Avg daily balance',
        type: 'line',
        data: h.map((r) => r.avg_daily_balance),
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: C.ink, width: 2 },
        itemStyle: { color: C.ink },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: a.profile.B, lineStyle: { color: C.ink, type: 'dashed' }, label: { formatter: `B ${cadCompact(a.profile.B)}`, position: 'insideEndTop', color: C.ink } }],
        },
      },
    ],
  };
}

export function HistoryCard({ data }: { data: AccountResponse | undefined }) {
  const option = useMemo(() => (data ? historyOption(data) : null), [data]);
  return (
    <Card title="Money in and out" sub={data ? `Last ${data.history.length} months, with the buffer B` : 'Last 24 months'}>
      {option ? <Chart option={option} height={220} ariaLabel="Monthly money in and out with balance" /> : <SkeletonBlock chart={220} lines={0} />}
    </Card>
  );
}

const CATS: { key: keyof AccountResponse['breakdown']; label: string; flexible: boolean }[] = [
  { key: 'household_bills', label: 'Household bills', flexible: false },
  { key: 'insurance', label: 'Insurance', flexible: false },
  { key: 'loan_payments', label: 'Loan payments', flexible: false },
  { key: 'card_withdrawals', label: 'Card', flexible: true },
  { key: 'cash_withdrawals', label: 'Cash', flexible: true },
  { key: 'other_transfers_out', label: 'Other transfers', flexible: true },
];

function breakdownOption(a: AccountResponse): ChartOption {
  const rows = [...CATS].reverse();
  return {
    ...base,
    grid: grid({ left: 108, right: 56, top: 4, bottom: 4 }),
    tooltip: { ...tooltip, valueFormatter: (v: number) => `${cad(v)}/month` },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', data: rows.map((c) => c.label), ...axisCommon, axisLine: { show: false } },
    series: [
      {
        id: 'bd',
        type: 'bar',
        data: rows.map((c) => ({ value: a.breakdown[c.key], itemStyle: { color: c.flexible ? C.orange : C.ink } })),
        barWidth: 12,
        itemStyle: { borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', formatter: (p: { value: number }) => cadCompact(p.value), color: C.ink, fontSize: 11 },
      },
    ],
  };
}

export function BreakdownCard({ data }: { data: AccountResponse | undefined }) {
  const option = useMemo(() => (data ? breakdownOption(data) : null), [data]);
  return (
    <Card title="Spending breakdown" sub={<>Median per month. <span style={{ color: C.ink, fontWeight: 600 }}>Fixed</span> vs <span style={{ color: '#9A420B', fontWeight: 600 }}>flexible</span></>}>
      {option ? <Chart option={option} height={200} ariaLabel="Spending by category" /> : <SkeletonBlock chart={200} lines={0} />}
    </Card>
  );
}

export function FlagsCard({ data }: { data: AccountResponse | undefined }) {
  if (!data) return <Card title="Risk flags"><SkeletonBlock lines={3} /></Card>;
  const flags = riskFlags(data.profile);
  const peers = data.peers;
  return (
    <Card title="Risk flags and peers">
      {flags.length === 0 ? (
        <Badge tone="good">No risk flags</Badge>
      ) : (
        <div className={s.flags}>
          {flags.map((f) => (
            <Badge key={f.id} tone={f.level === 'high' ? 'bad' : f.level === 'medium' ? 'warn' : 'neutral'} dot>
              {f.label}
            </Badge>
          ))}
        </div>
      )}
      {featureOn('peers') && (
        <>
          <div className={s.divider} />
          {peers.better_than === null ? (
            <Empty>No similar customers in this district and income band.</Empty>
          ) : (
            <p className={s.peer}>
              Better than <b>{pct(peers.better_than)}</b> of customers with similar income in the same district.
            </p>
          )}
          <span className={s.fine}>
            Peers: {peers.group_size} accounts in {data.profile.district_name}, income quintile {data.profile.income_quintile}
            {peers.peer_median_runway && `. Their median runway today: ${runwayPhrase(peers.peer_median_runway)}`}.
          </span>
        </>
      )}
    </Card>
  );
}
