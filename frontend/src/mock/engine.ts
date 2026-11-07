/**
 * TypeScript mirror of engine.py, used only by the mock layer.
 * engine.py is the source of truth. Formulas follow docs/ROADMAP.md §3 exactly.
 */
import type { Runway, Shock, Limit, ScenarioResponse, WaterfallKey } from '../api/schemas';
import { NO_SHOCK } from '../api/schemas';

export const EI_RATE = 0.55;
export const EI_WEEKLY_MAX = 729; // canada.ca, 2026 maximum weekly benefit
export const EI_MONTHLY_MAX = (EI_WEEKLY_MAX * 52) / 12;
export const RUNWAY_CAP = 120;

export interface MonthRow {
  month: string;
  money_in: number;
  money_out: number;
  household_bills: number;
  insurance: number;
  loan_payments: number;
  card_withdrawals: number;
  cash_withdrawals: number;
  other_transfers_out: number;
  avg_daily_balance: number;
  days_below_zero: number;
}

export interface CoreProfile {
  I: number;
  S: number;
  F: number;
  H: number;
  B: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

/** Python-style round half to even at 1 decimal, to match round(x, 1). */
export function round1(x: number): number {
  const scaled = x * 10;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const eps = 1e-9;
  let r: number;
  if (diff > 0.5 + eps) r = floor + 1;
  else if (diff < 0.5 - eps) r = floor;
  else r = floor % 2 === 0 ? floor : floor + 1;
  return r / 10;
}

/** I, S, F, H, B from monthly rows (rows sorted by month ascending). */
export function coreProfile(rows: readonly MonthRow[]): CoreProfile {
  const last6 = rows.slice(-6);
  return {
    I: median(rows.map((r) => r.money_in)),
    S: median(rows.map((r) => r.money_out)),
    F: median(rows.map((r) => r.household_bills + r.insurance + r.loan_payments)),
    H: median(rows.map((r) => r.household_bills)),
    // Fewer than 6 rows: slice(-6) is all rows, which is the agreed fallback.
    B: mean(last6.map((r) => r.avg_daily_balance)),
  };
}

export interface Components {
  buffer_left: number;
  income: number;
  spending: number;
  gap: number;
  ei_capped: boolean;
}

/** Shocked income. ei_cap_on also applies the EI weekly maximum (D8). */
export function shockedIncome(I: number, shock: Shock): { income: number; capped: boolean } {
  const raw = shock.income_factor * I;
  if (shock.ei_cap_on && shock.income_factor < 1 && raw > EI_MONTHLY_MAX) {
    return { income: EI_MONTHLY_MAX, capped: true };
  }
  return { income: raw, capped: false };
}

/** one_off in CAD plus one_off_x_s multiples of this account's S. */
export function effectiveOneOff(p: Pick<CoreProfile, 'S'>, shock: Shock): number {
  return shock.one_off + shock.one_off_x_s * p.S;
}

export function components(p: CoreProfile, shock: Shock): Components {
  const { income, capped } = shockedIncome(p.I, shock);
  const spending = p.S + shock.bills_pct * p.H + shock.spend_delta;
  return {
    buffer_left: p.B - effectiveOneOff(p, shock),
    income,
    spending,
    gap: spending - income,
    ei_capped: capped,
  };
}

/** The judges' runway formula, including rounding and the 120 cap. */
export function runwayFrom(c: Pick<Components, 'buffer_left' | 'gap'>): Runway {
  if (c.buffer_left <= 0) return { status: 'zero', months: 0 };
  if (c.gap <= 0) return { status: 'no_shortfall', months: null };
  const raw = Math.min(c.buffer_left / c.gap, RUNWAY_CAP);
  const months = round1(raw);
  if (months >= RUNWAY_CAP) return { status: 'capped', months: 120 };
  return { status: 'finite', months };
}

export function runway(p: CoreProfile, shock: Shock): Runway {
  return runwayFrom(components(p, shock));
}

/** Numeric value for sorting and averages: no shortfall counts as 120. */
export function runwayValue(r: Runway): number {
  return r.status === 'no_shortfall' ? RUNWAY_CAP : r.months;
}

export function isUnder3(r: Runway): boolean {
  return r.status === 'zero' || (r.status === 'finite' && r.months < 3);
}

export function lastsAtLeast(r: Runway, months: number): boolean {
  return r.status === 'no_shortfall' || r.status === 'capped' || runwayValue(r) >= months;
}

/** Breaking point (D4): the formula worked in reverse for a target of T months. */
export function breakingPoint(p: CoreProfile, shock: Shock, T: number): ScenarioResponse['breaking_point'] {
  const c = components(p, shock);
  const bufferGone = c.buffer_left <= 0;

  // f* = (S' - (B - one_off) / T) / I
  let income_factor: Limit;
  if (p.I <= 0) income_factor = { status: 'not_applicable', value: null };
  else if (bufferGone) income_factor = { status: 'already_short', value: null };
  else {
    const f = (c.spending - c.buffer_left / T) / p.I;
    if (f <= 0) income_factor = { status: 'always_safe', value: 0 };
    else if (f > 1) income_factor = { status: 'already_short', value: f };
    else income_factor = { status: 'ok', value: f };
  }

  // X* = B - T * gap. With no gap the only limit is the buffer itself.
  let one_off: Limit;
  const x = c.gap > 0 ? p.B - T * c.gap : p.B;
  if (x <= 0) one_off = { status: 'already_short', value: x };
  else one_off = { status: 'ok', value: x };

  // b* = ((B - one_off) / T + income - S - spend_delta) / H
  let bills_pct: Limit;
  if (p.H <= 0) bills_pct = { status: 'not_applicable', value: null };
  else if (bufferGone) bills_pct = { status: 'already_short', value: null };
  else {
    const b = (c.buffer_left / T + c.income - p.S - shock.spend_delta) / p.H;
    bills_pct = b < 0 ? { status: 'already_short', value: b } : { status: 'ok', value: b };
  }

  return { target_months: T, income_factor, one_off, bills_pct };
}

/** Waterfall: apply income, bills, other spending and one-off in turn. */
export function waterfall(p: CoreProfile, shock: Shock): { key: WaterfallKey; runway: Runway }[] {
  const steps: [WaterfallKey, Shock][] = [
    ['base', NO_SHOCK],
    ['income', { ...NO_SHOCK, income_factor: shock.income_factor, income_months: shock.income_months, ei_cap_on: shock.ei_cap_on }],
  ];
  const s2 = { ...steps[1]![1], bills_pct: shock.bills_pct };
  const s3 = { ...s2, spend_delta: shock.spend_delta };
  const s4 = { ...s3, one_off: shock.one_off, one_off_x_s: shock.one_off_x_s };
  steps.push(['bills', s2], ['other', s3], ['one_off', s4]);
  return steps.map(([key, s]) => ({ key, runway: runway(p, s) }));
}

/** Deterministic balance after the shock, month by month (judges' constant gap). */
export function burnDown(p: CoreProfile, shock: Shock, horizon = 24): ScenarioResponse['burn_down'] {
  const c = components(p, shock);
  const balance: number[] = [];
  for (let t = 0; t <= horizon; t++) balance.push(c.buffer_left - c.gap * t);
  let zero_month: number | null = null;
  if (c.buffer_left <= 0) zero_month = 0;
  else if (c.gap > 0 && c.buffer_left / c.gap <= horizon) zero_month = c.buffer_left / c.gap;
  return { balance, zero_month };
}

export const GOAL_CUT_HORIZON = 12;

export function goalPlan(
  p: CoreProfile & { surplus: number },
  beenBelowZero: boolean,
): ScenarioResponse['goal_plan'] {
  const multiple = beenBelowZero ? 6 : 3;
  const target = multiple * p.S;
  const shortfall = Math.max(target - p.B, 0);
  const base = { target, multiple, current_buffer: p.B, shortfall, cut_horizon_months: GOAL_CUT_HORIZON } as const;
  if (shortfall <= 0) return { ...base, status: 'reached', months_to_target: 0, monthly_cut_needed: null };
  if (p.surplus > 0) {
    return { ...base, status: 'on_track', months_to_target: round1(shortfall / p.surplus), monthly_cut_needed: null };
  }
  // No surplus: the cut that reaches the target in GOAL_CUT_HORIZON months.
  const cut = shortfall / GOAL_CUT_HORIZON - p.surplus;
  return { ...base, status: 'needs_cut', months_to_target: null, monthly_cut_needed: cut };
}

export const BACKUP_TARGET = 6;

export function backupPlan(p: CoreProfile, shock: Shock, flexibleMonthly: number): ScenarioResponse['backup_plan'] {
  const c = components(p, shock);
  const now = runwayFrom(c);
  const base = { flexible_monthly: flexibleMonthly, target_months: BACKUP_TARGET };
  if (c.buffer_left <= 0) return { ...base, status: 'buffer_gone', cut_pct: null, monthly_saving: null, runway_after: now };
  if (lastsAtLeast(now, BACKUP_TARGET)) return { ...base, status: 'not_needed', cut_pct: 0, monthly_saving: 0, runway_after: now };
  if (flexibleMonthly <= 0) return { ...base, status: 'no_flexible', cut_pct: null, monthly_saving: null, runway_after: now };

  // buffer_left / (gap - c * flex) >= 6  =>  c >= (gap - buffer_left / 6) / flex
  const needed = (c.gap - c.buffer_left / BACKUP_TARGET) / flexibleMonthly;
  if (needed > 1) {
    const full = runwayFrom({ buffer_left: c.buffer_left, gap: c.gap - flexibleMonthly });
    return { ...base, status: 'not_enough', cut_pct: 1, monthly_saving: flexibleMonthly, runway_after: full };
  }
  const pct = Math.min(Math.ceil(needed * 100 - 1e-9) / 100, 1);
  const saving = pct * flexibleMonthly;
  return {
    ...base,
    status: 'cut_works',
    cut_pct: pct,
    monthly_saving: saving,
    runway_after: runwayFrom({ buffer_left: c.buffer_left, gap: c.gap - saving }),
  };
}

export function verdict(r: Runway, incomeMonths: number): 'makes_it' | 'falls_short' | null {
  if (incomeMonths <= 0) return null;
  return lastsAtLeast(r, incomeMonths) ? 'makes_it' : 'falls_short';
}

/** Survival target T: the EI length if set, otherwise 6 months. */
export function defaultTarget(shock: Shock): number {
  return shock.income_months > 0 ? shock.income_months : 6;
}
