/**
 * JavaScript stand-in for sim_numpy.py / resil_hpc (docs/ROADMAP.md §3, "Simulation").
 * Same model, far fewer paths for the bank-wide run. Responses report the path count
 * actually run, so the UI never claims work the mock didn't do.
 */
import type { Shock } from '../api/schemas';
import { mixSeed, mulberry32, normalSampler } from './prng';
import { EI_MONTHLY_MAX, EI_RATE, effectiveOneOff } from './engine';

export interface SimInputs {
  I: number;
  S: number;
  H: number;
  B: number;
  sd_in: number;
  sd_out: number;
  p_jobloss_month: number;
  bills_growth_annual: number;
  repair_rate: number;
  repair_min_x: number;
  repair_max_x: number;
}

/** Mock assumption: a random (not shock-forced) job loss pays EI for 6 months, then work resumes. */
export const RANDOM_EI_MONTHS = 6;

export interface SimOptions {
  nPaths: number;
  months: number;
  target: number;
  seed: number;
  collectFan: boolean;
}

export interface SimResult {
  survival: number;
  firstNegative: { p10: number | null; p50: number | null; p90: number | null };
  fan: { p10: number[]; p50: number[]; p90: number[] } | null;
}

function percentile(sorted: Float64Array | number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function simulate(p: SimInputs, shock: Shock, opt: SimOptions): SimResult {
  const horizon = Math.max(opt.months, opt.target);
  const rand = mulberry32(opt.seed);
  const norm = normalSampler(rand);

  const forced = shock.income_factor < 1;
  const eiFactor = forced ? shock.income_factor : EI_RATE;
  const eiIncomeRaw = eiFactor * p.I;
  const eiIncome = shock.ei_cap_on ? Math.min(eiIncomeRaw, EI_MONTHLY_MAX) : eiIncomeRaw;
  const relIn = p.I > 0 ? p.sd_in / p.I : 0;
  const relOut = p.S > 0 ? p.sd_out / p.S : 0;
  const g = Math.pow(1 + p.bills_growth_annual, 1 / 12);
  const extraBills = shock.bills_pct * p.H;
  const start = p.B - effectiveOneOff(p, shock);

  const fan = opt.collectFan ? new Float64Array(opt.nPaths * (opt.months + 1)) : null;
  const firstNeg = new Float64Array(opt.nPaths);
  let survived = 0;

  for (let path = 0; path < opt.nPaths; path++) {
    let bal = start;
    let employed = !forced;
    let eiLeft = forced ? (shock.income_months > 0 ? shock.income_months : Infinity) : 0;
    let growth = 1;
    let fneg = bal <= 0 ? 0 : Infinity;
    if (fan) fan[path * (opt.months + 1)] = bal;

    for (let t = 0; t < horizon; t++) {
      if (employed && p.p_jobloss_month > 0 && rand() < p.p_jobloss_month) {
        employed = false;
        eiLeft = RANDOM_EI_MONTHS;
      }
      let income: number;
      if (employed) income = p.I;
      else if (eiLeft > 0) income = eiIncome;
      else income = 0;
      if (!employed) {
        eiLeft -= 1;
        // Random job loss ends after RANDOM_EI_MONTHS; a forced shock keeps income at 0 after EI.
        if (eiLeft <= 0 && !forced) employed = true;
      }
      if (relIn > 0 && income > 0) income = Math.max(0, income * (1 + relIn * norm()));

      let spend = p.S + extraBills * growth + shock.spend_delta;
      if (relOut > 0) spend = Math.max(0, spend * (1 + relOut * norm()));
      if (p.repair_rate > 0 && rand() < p.repair_rate) {
        spend += p.S * (p.repair_min_x + (p.repair_max_x - p.repair_min_x) * rand());
      }
      growth *= g;

      const next = bal + income - spend;
      if (fneg === Infinity && next <= 0) fneg = t + bal / (bal - next);
      bal = next;
      if (fan && t < opt.months) fan[path * (opt.months + 1) + t + 1] = bal;
    }
    firstNeg[path] = fneg;
    if (fneg >= opt.target) survived++;
  }

  firstNeg.sort();
  const pct = (q: number) => {
    const v = percentile(firstNeg, q);
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  };

  let fanOut: SimResult['fan'] = null;
  if (fan) {
    const col = new Float64Array(opt.nPaths);
    const p10: number[] = [];
    const p50: number[] = [];
    const p90: number[] = [];
    for (let t = 0; t <= opt.months; t++) {
      for (let path = 0; path < opt.nPaths; path++) col[path] = fan[path * (opt.months + 1) + t]!;
      col.sort();
      p10.push(Math.round(percentile(col, 0.1)));
      p50.push(Math.round(percentile(col, 0.5)));
      p90.push(Math.round(percentile(col, 0.9)));
    }
    fanOut = { p10, p50, p90 };
  }

  return {
    survival: survived / opt.nPaths,
    firstNegative: { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9) },
    fan: fanOut,
  };
}

/** Per-account seed, so single-account and bank runs agree for the same account. */
export function accountSeed(seed: number, accountId: number): number {
  return mixSeed(seed, accountId);
}
