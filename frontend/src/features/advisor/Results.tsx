import { useMemo, useState } from 'react';
import type { Limit, Profile, ScenarioResponse, SimAccountResponse, SimBankResponse } from '../../api/schemas';
import { Chart, type ChartOption } from '../../components/Chart';
import { axisCommon, base, C, grid, moneyAxis, tooltip } from '../../components/chartTheme';
import { Badge, Button, Card, ErrorNote, SkeletonBlock } from '../../components/ui';
import { cad, cadCompact, int, pct, runwayNumber, runwayPhrase, seconds } from '../../lib/format';
import { useTween } from '../../lib/hooks';
import { advisorSummary } from '../../lib/summary';
import { useScenarioState } from '../../state/scenario';
import s from './advisor.module.css';

const engineLabel = (e: SimAccountResponse['engine']) => (e === 'cpp' ? 'C++' : e === 'numpy' ? 'NumPy' : 'JS mock');

// ---------- headline runway ----------

export function RunwayHero({ sc, loading, error }: { sc: ScenarioResponse | undefined; loading: boolean; error: unknown }) {
  const r = sc?.runway_shocked;
  const n = useTween(r && r.status !== 'no_shortfall' ? r.months : 0);
  if (error && !sc) return <Card title="Runway after the shock"><ErrorNote error={error} /></Card>;
  if (!sc || !r) return <Card title="Runway after the shock"><SkeletonBlock lines={3} chart={64} /></Card>;

  const c = sc.components;
  const T = sc.shock.income_months;
  return (
    <Card title="Runway after the shock" tag="Judges’ formula" busy={loading} sub="Months the buffer covers the monthly gap. This is the headline number.">
      <div className={s.hero}>
        <div className={s.heroMain}>
          <span className={s.heroNumber} aria-live="polite">
            {r.status === 'no_shortfall' ? '120+' : r.status === 'capped' ? '120' : n.toFixed(1)}
            <small>{r.status === 'no_shortfall' ? 'no shortfall' : 'months'}</small>
          </span>
        </div>
        <div className={s.heroSide}>
          <div className={s.beforeAfter}>
            Before <b>{runwayNumber(sc.runway_base)}</b> → after <b>{runwayNumber(r)}</b> months
          </div>
          {sc.verdict ? (
            <span className={s.verdict} data-v={sc.verdict}>
              {sc.verdict === 'makes_it' ? '✓ Makes it' : '✕ Falls short'}
              <span style={{ fontWeight: 500, fontSize: 13 }}>
                {sc.verdict === 'makes_it' ? `covers all ${T} months of EI` : `runs out before ${T} months of EI`}
              </span>
            </span>
          ) : (
            <span className={s.fine}>Set an EI length to get a “do they make it?” verdict.</span>
          )}
        </div>
      </div>
      <div className={s.formula}>
        {c.buffer_left <= 0 ? (
          <>
            B − one-off = <b>{cad(c.buffer_left)}</b> ≤ 0 → runway <b>0</b>
          </>
        ) : c.gap <= 0 ? (
          <>
            income <b>{cad(c.income)}</b> ≥ spending <b>{cad(c.spending)}</b> → <b>no shortfall (120+)</b>
          </>
        ) : (
          <>
            (B − one-off) <b>{cad(c.buffer_left)}</b> ÷ gap <b>{cad(c.gap)}</b> = <b>{runwayPhrase(r)}</b>
            <br />
            gap = spending {cad(c.spending)} − income {cad(c.income)}
            {c.ei_capped ? ' (EI capped)' : ''}
          </>
        )}
      </div>
    </Card>
  );
}

// ---------- survival + fan chart ----------

function fanOption(sim: SimAccountResponse, sc: ScenarioResponse | undefined): ChartOption {
  const months = sim.fan.p50.map((_, i) => i);
  const judges = sc?.burn_down.balance.slice(0, months.length) ?? [];
  // Keep the first months readable: after EI ends income drops to 0 and balances plunge.
  const top = Math.max(...sim.fan.p90, 0);
  const floor = Math.min(...sim.fan.p10);
  const atTarget = sim.fan.p10[Math.min(sim.target_months, sim.months)] ?? floor;
  const clampTo = Math.min(-1.5 * Math.max(top, 1000), atTarget * 1.3);
  const yMin = floor < clampTo ? Math.round(clampTo) : undefined;
  return {
    ...base,
    grid: grid({ left: 56, top: 20 }),
    tooltip: {
      ...tooltip,
      formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0;
        return `<b>Month ${i}</b><br/>p90 ${cad(sim.fan.p90[i]!)}<br/>p50 ${cad(sim.fan.p50[i]!)}<br/>p10 ${cad(sim.fan.p10[i]!)}${judges[i] !== undefined ? `<br/><span style="color:${C.grey}">Judges’ path ${cad(judges[i]!)}</span>` : ''}`;
      },
    },
    xAxis: { type: 'category', data: months, boundaryGap: false, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, interval: 5, formatter: (v: string) => `${v}m` } },
    yAxis: { ...moneyAxis(cadCompact), min: yMin },
    series: [
      { id: 'lo', type: 'line', data: sim.fan.p10, stack: 'band', stackStrategy: 'all', symbol: 'none', lineStyle: { opacity: 0 }, silent: true },
      {
        id: 'band',
        type: 'line',
        data: sim.fan.p90.map((v, i) => v - sim.fan.p10[i]!),
        stack: 'band',
        stackStrategy: 'all',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: C.orangeFaint },
        silent: true,
      },
      {
        id: 'p50',
        type: 'line',
        data: sim.fan.p50,
        symbol: 'none',
        lineStyle: { color: C.orange, width: 2.5 },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            { yAxis: 0, lineStyle: { color: C.red, type: 'solid', width: 1 }, label: { formatter: '$0', color: C.red, position: 'insideStartTop' } },
            { xAxis: String(Math.min(sim.target_months, sim.months)), lineStyle: { color: C.ink, type: 'dashed', width: 1 }, label: { formatter: `T = ${sim.target_months}m`, color: C.ink, position: 'insideEndTop' } },
          ],
        },
      },
      { id: 'judges', type: 'line', data: judges, symbol: 'none', lineStyle: { color: C.grey, width: 1.5, type: 'dashed' } },
    ],
  };
}

export function SurvivalCard({ sim, sc, loading, error }: { sim: SimAccountResponse | undefined; sc: ScenarioResponse | undefined; loading: boolean; error: unknown }) {
  const p = useTween(sim ? sim.survival_prob * 100 : 0);
  const option = useMemo(() => (sim ? fanOption(sim, sc) : null), [sim, sc]);
  return (
    <Card title="Chance of making it" tag="Simulation" busy={loading} sub="Monte Carlo on top of the judges’ number. It adds uncertainty and never replaces the runway.">
      {error && !sim ? (
        <ErrorNote error={error} />
      ) : !sim || !option ? (
        <SkeletonBlock lines={1} chart={200} />
      ) : (
        <>
          <div className={s.survivalTop}>
            <div className={s.survivalNumber}>
              {Math.round(p)}%<span>chance the balance stays above $0 for {sim.target_months} months</span>
            </div>
            <div className={s.timer}>
              <b>{int(sim.n_paths)}</b> futures × <b>{sim.months}</b> months
              <br />
              in <b>{seconds(sim.compute_ms)}</b> · {engineLabel(sim.engine)}
            </div>
          </div>
          <Chart option={option} height={210} ariaLabel={`Fan chart of simulated balances. ${pct(sim.survival_prob)} survive ${sim.target_months} months.`} />
          <div className={s.fine}>
            Shaded band: 10th–90th percentile of balances. Orange: median. Dashed grey: the judges’ straight-line path.
            {sim.first_negative.p50 !== null && ` Median month the balance first goes below $0: ${sim.first_negative.p50.toFixed(1)}.`}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- breaking point ----------

function LimitRow({ label, limit, kind, T }: { label: string; limit: Limit; kind: 'income' | 'oneoff' | 'bills'; T: number }) {
  let value = '—';
  let note = '';
  if (limit.status === 'not_applicable') {
    value = 'Not applicable';
    note = kind === 'income' ? 'No income to lose (I = 0).' : 'No household bills to raise (H = 0).';
  } else if (limit.status === 'always_safe') {
    value = 'Safe';
    note = `Lasts ${T} months even with no income.`;
  } else if (limit.status === 'already_short') {
    value = 'Already short';
    note = kind === 'oneoff' ? `Falls short of ${T} months even with no one-off.` : kind === 'income' ? `Falls short of ${T} months even at full income.` : `Falls short of ${T} months even with no bill increase.`;
  } else if (limit.value !== null) {
    value = kind === 'income' ? `below ${pct(limit.value)}` : kind === 'oneoff' ? `over ${cad(limit.value)}` : `over +${pct(limit.value)}`;
    note = kind === 'income' ? 'Share of usual income they can drop to' : kind === 'oneoff' ? 'Largest surprise cost they can absorb' : 'Largest bills rise (share of H)';
  }
  return (
    <div className={s.limit}>
      <span className={s.limitLabel}>{label}</span>
      <span className={s.limitValue}>{value}</span>
      <span className={s.limitNote}>{note}</span>
    </div>
  );
}

export function BreakingPointCard({ sc, loading }: { sc: ScenarioResponse | undefined; loading: boolean }) {
  if (!sc) return <Card title="Breaking point"><SkeletonBlock lines={4} /></Card>;
  const bp = sc.breaking_point;
  return (
    <Card title="Breaking point" tag="D4" busy={loading} sub={`They fall short of ${bp.target_months} months if…`}>
      <div className={s.limits}>
        <LimitRow label="Income falls" limit={bp.income_factor} kind="income" T={bp.target_months} />
        <LimitRow label="One-off cost" limit={bp.one_off} kind="oneoff" T={bp.target_months} />
        <LimitRow label="Bills rise" limit={bp.bills_pct} kind="bills" T={bp.target_months} />
      </div>
    </Card>
  );
}

// ---------- advisor summary ----------

export function SummaryCard({ profile, sc, sim }: { profile: Profile | undefined; sc: ScenarioResponse | undefined; sim: SimAccountResponse | undefined }) {
  const [copied, setCopied] = useState(false);
  const lines = profile && sc && sc.account_id === profile.account_id ? advisorSummary(profile, sc, sim) : null;
  return (
    <Card
      title="What to tell the customer"
      sub="Written from the numbers on screen"
      actions={
        lines && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(lines.join(' '));
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )
      }
    >
      {lines ? (
        <div className={s.summary}>
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      ) : (
        <SkeletonBlock lines={4} />
      )}
    </Card>
  );
}

// ---------- bank mini ----------

export function BankMini({ bank, loading }: { bank: SimBankResponse | undefined; loading: boolean }) {
  const { setTab } = useScenarioState();
  return (
    <button type="button" className={s.bankMini} onClick={() => setTab('bank')} aria-label="Open the bank-wide stress test">
      <div>
        <div className={s.bankMiniText}>
          Whole bank under this shock {loading && <Badge tone="accent" dot live>updating</Badge>}
        </div>
        <div className={s.bankMiniBig}>{bank ? `${pct(bank.share_under_3)} under 3 months` : '…'}</div>
        <div className={s.bankMiniText}>
          {bank ? `${int(bank.count_under_3)} of ${int(bank.n_accounts)} customers · ${int(bank.n_accounts)} × ${int(bank.n_paths)} futures in ${seconds(bank.compute_ms)}` : 'Running the bank-wide stress test…'}
        </div>
      </div>
      <span className={s.arrow} aria-hidden>
        →
      </span>
    </button>
  );
}
