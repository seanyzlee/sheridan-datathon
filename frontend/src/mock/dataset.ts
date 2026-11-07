/**
 * Seeded synthetic stand-in for monthly_summary.csv, loans.csv, accounts.csv and
 * districts.csv. The shapes match what the real engine reads; the values are fake.
 * Account IDs 1–10 are fixed edge cases (see docs/frontend_implementation.md §6).
 */
import type { Runway } from '../api/schemas';
import { NO_SHOCK } from '../api/schemas';
import { mixSeed, mulberry32, normalSampler } from './prng';
import {
  type CoreProfile,
  type MonthRow,
  coreProfile,
  EI_RATE,
  median,
  runway,
  runwayValue,
  stdev,
} from './engine';

export const DATA_SEED = 20261107;
export const N_ACCOUNTS = 4500;
export const N_LOANS = 682;
export const N_DEFAULTS = 76;

export const MONTHS: string[] = (() => {
  const out: string[] = [];
  for (let y = 2024; y <= 2025; y++) for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  return out;
})();
const LAST_MONTH_INDEX = MONTHS.length - 1; // 2025-12

/** Stress twist used for discovery bands and the time machine: EI 55% for 6 months. */
export const STRESS_SHOCK = { ...NO_SHOCK, income_factor: EI_RATE, income_months: 6 };

export interface District {
  district_id: number;
  name: string;
  region: string;
  unemployment_rate_2023: number;
  salary_factor: number;
}

const REGION_DISTRICTS: [string, string[]][] = [
  ['Prague', ['Hl.m. Praha']],
  ['Central Bohemia', ['Benesov', 'Beroun', 'Kladno', 'Kolin']],
  ['South Bohemia', ['Ceske Budejovice', 'Cesky Krumlov', 'Pisek']],
  ['West Bohemia', ['Plzen - mesto', 'Cheb', 'Karlovy Vary']],
  ['North Bohemia', ['Usti nad Labem', 'Liberec', 'Most', 'Teplice']],
  ['East Bohemia', ['Hradec Kralove', 'Pardubice', 'Trutnov']],
  ['South Moravia', ['Brno - mesto', 'Zlin', 'Jihlava', 'Znojmo']],
  ['North Moravia', ['Ostrava - mesto', 'Olomouc', 'Opava', 'Karvina']],
];
export const REGIONS = REGION_DISTRICTS.map(([r]) => r);

export interface Loan {
  start_index: number; // index into MONTHS, may be negative (started before 2024-01)
  duration_months: number;
  monthly_payment: number;
  running_at_end: boolean;
}

export interface MockAccount {
  account_id: number;
  district: District;
  rows: MonthRow[];
  loan: Loan | null;
  defaulted: boolean;
  default_month: string | null;
  core: CoreProfile;
  P: number;
  surplus: number;
  runway_base: Runway;
  runway_stress: Runway;
  income_quintile: number;
  days_below_zero_6m: number;
  ever_below_zero: boolean;
  flex_monthly: number;
  sd_in: number;
  sd_out: number;
}

export interface Dataset {
  accounts: MockAccount[];
  byId: Map<number, MockAccount>;
  districts: District[];
}

interface Archetype {
  months?: number;
  income?: number;
  spendRatio?: number;
  bufferMonths?: number;
  balanceOverride?: number;
  noSpending?: boolean;
  forceLoan?: boolean;
  forceDefault?: boolean;
  district?: number;
}

/** Fixed edge cases on IDs 1–10 so rehearsal can hit every runway outcome. */
const EDGE_CASES: Record<number, Archetype> = {
  1: { income: 5200, spendRatio: 0.9, bufferMonths: 2.5, district: 0 }, // typical, no shortfall at base
  2: { income: 0, spendRatio: 1, bufferMonths: 4 }, // I = 0
  3: { income: 3800, spendRatio: 0.97, balanceOverride: -420 }, // B <= 0, runway 0
  4: { income: 4100, noSpending: true, bufferMonths: 3 }, // no money_out
  5: { income: 4600, spendRatio: 0.95, bufferMonths: 1.5, months: 4 }, // limited history
  6: { income: 6000, spendRatio: 1.02, bufferMonths: 140 }, // hits the 120 cap
  7: { income: 3300, spendRatio: 1.12, bufferMonths: 0.25 }, // base runway under 3
  8: { income: 4300, spendRatio: 1.05, bufferMonths: 1.6 }, // base runway 3–120
  9: { income: 12500, spendRatio: 0.82, bufferMonths: 2.2, district: 0 }, // hit by the EI cap
  10: { income: 3600, spendRatio: 0.99, bufferMonths: 0.6, forceLoan: true, forceDefault: true },
};

function buildDistricts(rand: () => number): District[] {
  const out: District[] = [];
  let id = 1;
  for (const [region, names] of REGION_DISTRICTS) {
    for (const name of names) {
      const isCity = name.includes('mesto') || name.includes('Praha');
      out.push({
        district_id: id++,
        name,
        region,
        unemployment_rate_2023: isCity ? 0.02 + rand() * 0.015 : 0.035 + rand() * 0.06,
        salary_factor: isCity ? 1.15 + rand() * 0.2 : 0.85 + rand() * 0.2,
      });
    }
  }
  return out;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r2 = (x: number) => Math.round(x * 100) / 100;

function generateAccount(
  account_id: number,
  districts: District[],
  arche: Archetype | undefined,
): Omit<MockAccount, 'income_quintile' | 'defaulted' | 'default_month'> & { loanEligible: boolean } {
  const rand = mulberry32(mixSeed(DATA_SEED, account_id));
  const norm = normalSampler(rand);

  const district =
    arche?.district !== undefined
      ? districts[arche.district]!
      : rand() < 0.15
        ? districts[0]!
        : districts[1 + Math.floor(rand() * (districts.length - 1))]!;

  const nMonths = arche?.months ?? (rand() < 0.04 ? 3 + Math.floor(rand() * 20) : 24);
  const monthIdx = MONTHS.slice(MONTHS.length - nMonths);

  const income = arche?.income ?? clamp(Math.exp(Math.log(4800) + 0.42 * norm()) * district.salary_factor, 1200, 22000);
  const spendRatio = arche?.spendRatio ?? clamp(0.93 + 0.08 * norm(), 0.62, 1.25);
  const spend = arche?.noSpending ? 0 : income > 0 ? income * spendRatio : 2600 * spendRatio;
  const bufferMonths = arche?.bufferMonths ?? clamp(Math.exp(Math.log(2.0) + 0.95 * norm()), 0.03, 30);

  // Edge cases get almost no noise so their runway outcome is guaranteed.
  const cvIn = arche ? 0.005 : 0.03 + rand() * 0.2;
  const cvOut = arche ? 0.005 : 0.04 + rand() * 0.16;
  const bonusChance = arche ? 0 : 0.06;
  const billsShare = 0.22 + rand() * 0.16;
  const insShare = rand() < 0.7 ? 0.02 + rand() * 0.04 : 0;
  const cardShare = 0.15 + rand() * 0.2;
  const cashShare = 0.3 + rand() * 0.2;

  const rows: MonthRow[] = [];
  const targetBalance = arche?.balanceOverride ?? bufferMonths * Math.max(spend, 800);
  let balance = targetBalance * (0.9 + rand() * 0.2);
  for (const month of monthIdx) {
    const money_in = income > 0 ? Math.max(0, income * (1 + cvIn * norm()) + (rand() < bonusChance ? income * 0.4 : 0)) : 0;
    const out = spend > 0 ? Math.max(0, spend * (1 + cvOut * norm())) : 0;
    const bills = out * billsShare;
    const ins = out * insShare;
    const flexible = out - bills - ins;
    const card = flexible * cardShare;
    const cash = flexible * cashShare;
    // Mean-reverting balance so B stays near the archetype's buffer.
    balance += 0.35 * (targetBalance - balance) + 0.08 * Math.max(spend, 600) * norm();
    const below = balance < 0 ? 8 + Math.floor(rand() * 20) : balance < 0.08 * spend ? Math.floor(rand() * 4) : 0;
    rows.push({
      month,
      money_in: r2(money_in),
      money_out: r2(out),
      household_bills: r2(bills),
      insurance: r2(ins),
      loan_payments: 0,
      card_withdrawals: r2(card),
      cash_withdrawals: r2(cash),
      other_transfers_out: r2(flexible - card - cash),
      avg_daily_balance: r2(arche?.balanceOverride ?? balance),
      days_below_zero: below,
    });
  }

  const core = coreProfile(rows);
  return {
    account_id,
    district,
    rows,
    loan: null,
    core,
    P: 0,
    surplus: core.I - core.S,
    runway_base: runway(core, NO_SHOCK),
    runway_stress: runway(core, STRESS_SHOCK),
    days_below_zero_6m: rows.slice(-6).reduce((a, r) => a + r.days_below_zero, 0),
    ever_below_zero: rows.some((r) => r.days_below_zero > 0),
    flex_monthly: median(rows.map((r) => r.card_withdrawals + r.cash_withdrawals + r.other_transfers_out)),
    sd_in: stdev(rows.map((r) => r.money_in)),
    sd_out: stdev(rows.map((r) => r.money_out)),
    loanEligible: !arche || !!arche.forceLoan,
  };
}

/** Move part of each month's spending into loan payments while the loan runs. */
function attachLoan(acc: MockAccount, loan: Loan): void {
  for (let i = 0; i < acc.rows.length; i++) {
    const row = acc.rows[i]!;
    const idx = MONTHS.indexOf(row.month);
    const active = idx >= loan.start_index && idx < loan.start_index + loan.duration_months;
    if (!active) continue;
    const pay = Math.min(loan.monthly_payment, row.money_out * 0.45);
    const flex = row.card_withdrawals + row.cash_withdrawals + row.other_transfers_out;
    const scale = flex > 0 ? Math.max(0, (flex - pay) / flex) : 0;
    row.loan_payments = r2(pay);
    row.card_withdrawals = r2(row.card_withdrawals * scale);
    row.cash_withdrawals = r2(row.cash_withdrawals * scale);
    row.other_transfers_out = r2(row.money_out - row.household_bills - row.insurance - pay - row.card_withdrawals - row.cash_withdrawals);
  }
  acc.loan = loan;
  acc.P = loan.running_at_end ? loan.monthly_payment : 0;
}

/** Defaulters drift into trouble in the months before default (feeds D5 and D6). */
function applyDeterioration(acc: MockAccount, defaultIdx: number, rand: () => number): void {
  const ramp = 6 + Math.floor(rand() * 5);
  for (const row of acc.rows) {
    const idx = MONTHS.indexOf(row.month);
    const k = idx - (defaultIdx - ramp);
    if (k <= 0) continue;
    const severity = Math.min(k / ramp, 1.2);
    row.money_in = r2(row.money_in * (1 - 0.12 * severity));
    row.avg_daily_balance = r2(row.avg_daily_balance * (1 - 0.45 * severity));
    if (row.avg_daily_balance < 0) row.days_below_zero = Math.max(row.days_below_zero, 6 + Math.floor(rand() * 15));
  }
}

function refresh(acc: MockAccount): void {
  acc.core = coreProfile(acc.rows);
  acc.surplus = acc.core.I - acc.core.S;
  acc.runway_base = runway(acc.core, NO_SHOCK);
  acc.runway_stress = runway(acc.core, STRESS_SHOCK);
  acc.days_below_zero_6m = acc.rows.slice(-6).reduce((a, r) => a + r.days_below_zero, 0);
  acc.ever_below_zero = acc.rows.some((r) => r.days_below_zero > 0);
  acc.flex_monthly = median(acc.rows.map((r) => r.card_withdrawals + r.cash_withdrawals + r.other_transfers_out));
  acc.sd_in = stdev(acc.rows.map((r) => r.money_in));
  acc.sd_out = stdev(acc.rows.map((r) => r.money_out));
}

function stressWeight(r: Runway): number {
  const v = runwayValue(r);
  if (v < 1) return 1.6;
  if (v < 3) return 1.3;
  if (v < 6) return 1.05;
  if (v < 12) return 0.9;
  return 0.75;
}

export function buildDataset(): Dataset {
  const rand = mulberry32(DATA_SEED);
  const districts = buildDistricts(rand);

  const raw: ReturnType<typeof generateAccount>[] = [];
  let nextId = 11;
  for (let k = 0; k < N_ACCOUNTS; k++) {
    const id = k < 10 ? k + 1 : nextId;
    if (k >= 10) nextId += 1 + Math.floor(rand() * 4);
    raw.push(generateAccount(id, districts, EDGE_CASES[id]));
  }

  const accounts: MockAccount[] = raw.map(({ loanEligible: _unused, ...a }) => ({
    ...a,
    income_quintile: 1,
    defaulted: false,
    default_month: null,
  }));

  // Loans: 682 accounts, including the forced edge case.
  const eligible = raw.map((a, i) => (a.loanEligible ? i : -1)).filter((i) => i >= 0);
  const loanIdx = new Set<number>([9]); // account 10
  while (loanIdx.size < N_LOANS) loanIdx.add(eligible[Math.floor(rand() * eligible.length)]!);
  for (const i of loanIdx) {
    const duration = [12, 24, 36, 48, 60][Math.floor(rand() * 5)]!;
    const start = -36 + Math.floor(rand() * 54);
    attachLoan(accounts[i]!, {
      start_index: start,
      duration_months: duration,
      monthly_payment: r2(150 + rand() * 750),
      running_at_end: start + duration > LAST_MONTH_INDEX,
    });
    refresh(accounts[i]!);
  }

  // Defaults: weighted towards low stress runway, sampled without replacement.
  const pool = [...loanIdx].filter((i) => i !== 9);
  const chosen = new Set<number>([9]);
  while (chosen.size < N_DEFAULTS) {
    const total = pool.reduce((s, i) => s + (chosen.has(i) ? 0 : stressWeight(accounts[i]!.runway_stress)), 0);
    let pick = rand() * total;
    for (const i of pool) {
      if (chosen.has(i)) continue;
      pick -= stressWeight(accounts[i]!.runway_stress);
      if (pick <= 0) {
        chosen.add(i);
        break;
      }
    }
  }
  for (const i of chosen) {
    const acc = accounts[i]!;
    const first = MONTHS.indexOf(acc.rows[0]!.month);
    const defaultIdx = Math.max(first + 8, 12 + Math.floor(rand() * 10));
    acc.defaulted = true;
    acc.default_month = MONTHS[Math.min(defaultIdx, LAST_MONTH_INDEX)]!;
    applyDeterioration(acc, defaultIdx, rand);
    refresh(acc);
  }

  // Income quintiles across the whole book.
  const sorted = [...accounts].sort((a, b) => a.core.I - b.core.I);
  sorted.forEach((a, rank) => {
    a.income_quintile = Math.min(5, 1 + Math.floor((rank * 5) / sorted.length));
  });

  return { accounts, byId: new Map(accounts.map((a) => [a.account_id, a])), districts };
}
