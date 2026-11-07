/** Mock versions of the discovery outputs that discovery.ipynb / the sweep will produce. */
import type { Benchmark, Defaults, EiCap, Finding, Runway, Tipping, TimeMachineList, TimeMachineReplay } from '../api/schemas';
import { NO_SHOCK } from '../api/schemas';
import { coreProfile, EI_MONTHLY_MAX, EI_RATE, EI_WEEKLY_MAX, isUnder3, median, runway, runwayValue } from './engine';
import { type Dataset, type MockAccount, MONTHS, STRESS_SHOCK } from './dataset';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function finding(ds: Dataset): Finding {
  const byQ = [1, 2, 3, 4, 5].map((q) => {
    const group = ds.accounts.filter((a) => a.income_quintile === q);
    return group.filter((a) => runwayValue(a.runway_stress) < 6).length / group.length;
  });
  const overall = ds.accounts.filter((a) => runwayValue(a.runway_stress) < 6).length / ds.accounts.length;
  const maxQ = byQ.indexOf(Math.max(...byQ));
  return {
    headline: `${pct(overall)} of customers would run out of money before 6 months of EI`,
    sentence:
      `On the judges' formula with EI at 55% of income, ${pct(overall)} of all ${ds.accounts.length.toLocaleString('en-CA')} accounts fall short of 6 months. ` +
      (Math.abs(byQ[0]! - byQ[4]!) < 0.08
        ? `The share is ${pct(byQ[0]!)} in the lowest income fifth and ${pct(byQ[4]!)} in the highest, so a bigger pay cheque alone doesn't make a customer resilient.`
        : `The share goes from ${pct(byQ[0]!)} in the lowest income fifth to ${pct(byQ[4]!)} in the highest.`),
    chart: {
      x_label: 'Income quintile',
      y_label: 'Share short of 6 months on EI',
      y_format: 'percent',
      categories: ['Q1 lowest', 'Q2', 'Q3', 'Q4', 'Q5 highest'],
      values: byQ,
      highlight_index: maxQ,
    },
    method: 'Judges’ runway under EI 55% (no other shock) for every account, grouped by income quintile.',
  };
}

const BANDS: [string, number, number | null][] = [
  ['Under 1 mo', 0, 1],
  ['1–3 mo', 1, 3],
  ['3–6 mo', 3, 6],
  ['6–12 mo', 6, 12],
  ['12+ mo', 12, null],
];

export function defaults(ds: Dataset): Defaults {
  const loans = ds.accounts.filter((a) => a.loan !== null);
  const bands = BANDS.map(([label, lo, hi]) => {
    const inBand = loans.filter((a) => {
      const v = runwayValue(a.runway_stress);
      return v >= lo && (hi === null || v < hi);
    });
    const d = inBand.filter((a) => a.defaulted).length;
    return { label, lo, hi, loans: inBand.length, defaults: d, default_rate: inBand.length ? d / inBand.length : 0 };
  });
  const bottom = bands[0]!.default_rate;
  const top = bands[bands.length - 1]!.default_rate;
  const defaultsTotal = loans.filter((a) => a.defaulted).length;
  return {
    loans_total: loans.length,
    defaults_total: defaultsTotal,
    bands,
    bottom_band_rate: bottom,
    top_band_rate: top,
    ratio: top > 0 ? bottom / top : null,
    overall_rate: loans.length ? defaultsTotal / loans.length : 0,
  };
}

/** Sweep income factor 100% → 40% for three bills levels (a slice of the C++ sweep grid). */
export function tipping(ds: Dataset): Tipping {
  const t0 = performance.now();
  const factors = Array.from({ length: 13 }, (_, i) => Math.round((1 - i * 0.05) * 100) / 100);
  const billsLevels: [string, number][] = [
    ['Bills unchanged', 0],
    ['Bills +15%', 0.15],
    ['Bills +30%', 0.3],
  ];
  const series = billsLevels.map(([label, b]) => ({
    label,
    share_under_3: factors.map((f) => {
      const shock = { ...NO_SHOCK, income_factor: f, bills_pct: b };
      let n = 0;
      for (const a of ds.accounts) if (isUnder3(runway(a.core, shock))) n++;
      return n / ds.accounts.length;
    }),
  }));
  const headline = 0;
  const curve = series[headline]!.share_under_3;
  let tip = 1;
  for (let i = 1; i < curve.length; i++) if (curve[i]! - curve[i - 1]! > curve[tip]! - curve[tip - 1]!) tip = i;
  return {
    engine: 'js',
    compute_ms: performance.now() - t0,
    n_accounts: ds.accounts.length,
    axis: { key: 'income_factor', label: 'Income kept (share of usual income)', values: factors },
    series,
    headline_series: headline,
    tipping_index: tip,
    sentence: `Dropping income from ${pct(factors[tip - 1]!)} to ${pct(factors[tip]!)} of usual moves the share of customers under 3 months from ${pct(curve[tip - 1]!)} to ${pct(curve[tip]!)}, the steepest step on the curve.`,
  };
}

export function eiCap(ds: Dataset): EiCap {
  const capped = { ...STRESS_SHOCK, ei_cap_on: true };
  const rows = ds.accounts.map((a) => {
    const judges = a.runway_stress;
    const withCap = runway(a.core, capped);
    return { a, judges, withCap, lost: runwayValue(judges) - runwayValue(withCap) };
  });
  const affected = rows.filter((r) => r.lost > 0);
  return {
    ei_rate: EI_RATE,
    ei_weekly_max: EI_WEEKLY_MAX,
    ei_monthly_max: Math.round(EI_MONTHLY_MAX * 100) / 100,
    source_url: 'https://www.canada.ca/en/services/benefits/ei/ei-regular-benefit/benefit-amount.html',
    accounts_total: rows.length,
    accounts_affected: affected.length,
    avg_runway_lost: affected.length ? affected.reduce((s, r) => s + r.lost, 0) / affected.length : 0,
    under_3_judges: rows.filter((r) => isUnder3(r.judges)).length,
    under_3_capped: rows.filter((r) => isUnder3(r.withCap)).length,
    by_quintile: [1, 2, 3, 4, 5].map((q) => {
      const g = rows.filter((r) => r.a.income_quintile === q);
      return {
        income_quintile: q,
        median_runway_judges: median(g.map((r) => runwayValue(r.judges))),
        median_runway_capped: median(g.map((r) => runwayValue(r.withCap))),
        share_affected: g.length ? g.filter((r) => r.lost > 0).length / g.length : 0,
      };
    }),
  };
}

/** Placeholder until bench.py writes real numbers. `measured: false` makes the UI say so. */
export function benchmark(): Benchmark {
  const python = 184;
  const rows = [
    { engine: 'python' as const, label: 'Python loop', seconds: python },
    { engine: 'numpy' as const, label: 'NumPy', seconds: 4.6 },
    { engine: 'cpp_1' as const, label: 'C++ · 1 thread', seconds: 1.9 },
    { engine: 'cpp_all' as const, label: 'C++ · all threads', seconds: 0.24 },
  ];
  return {
    measured: false,
    machine: 'Placeholder values (bench.py has not run yet)',
    threads: 10,
    workload: { accounts: 4500, paths: 2000, months: 24 },
    rows: rows.map((r) => ({ ...r, speedup: python / r.seconds })),
  };
}

export const FLAG_THRESHOLD = 3;

function replayOf(a: MockAccount): TimeMachineReplay {
  const months = a.rows.map((row, i) => {
    const window = a.rows.slice(0, i + 1);
    const core = coreProfile(window);
    const r: Runway = runway(core, STRESS_SHOCK);
    return { month: row.month, runway: r, B: core.B, I: core.I, S: core.S, flagged: i >= 5 && isUnder3(r) };
  });
  const defaultIdx = MONTHS.indexOf(a.default_month!);
  const flag = months.find((m) => m.flagged && MONTHS.indexOf(m.month) <= defaultIdx);
  return {
    account_id: a.account_id,
    default_month: a.default_month!,
    flag_threshold_months: FLAG_THRESHOLD,
    first_flag_month: flag?.month ?? null,
    lead_months: flag ? defaultIdx - MONTHS.indexOf(flag.month) : null,
    months,
  };
}

export function timeMachineList(ds: Dataset): TimeMachineList {
  const accounts = ds.accounts
    .filter((a) => a.defaulted && a.default_month)
    .map((a) => {
      const r = replayOf(a);
      return { account_id: a.account_id, default_month: r.default_month, lead_months: r.lead_months };
    })
    .sort((x, y) => (y.lead_months ?? -1) - (x.lead_months ?? -1));
  return { flag_threshold_months: FLAG_THRESHOLD, accounts };
}

export function timeMachineReplay(ds: Dataset, id: number): TimeMachineReplay | null {
  const a = ds.byId.get(id);
  if (!a || !a.defaulted || !a.default_month) return null;
  return replayOf(a);
}
