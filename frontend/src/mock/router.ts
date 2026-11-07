/**
 * In-browser implementation of every API route. Takes (method, path, body) and returns
 * (status, json) exactly like the FastAPI server would, so the client code is identical.
 */
import { z } from 'zod';
import type { AccountResponse, EngineMode, ErrorBody, Runway, ScenarioResponse, SimAccountResponse, SimBankResponse } from '../api/schemas';
import { ScenarioRequestSchema, SimAccountRequestSchema, SimBankRequestSchema } from '../api/schemas';
import { type Dataset, type MockAccount, buildDataset, MONTHS, REGIONS } from './dataset';
import {
  backupPlan,
  breakingPoint,
  burnDown,
  components,
  EI_WEEKLY_MAX,
  goalPlan,
  isUnder3,
  median,
  round1,
  runway,
  runwayFrom,
  verdict,
  waterfall,
} from './engine';
import { accountSeed, simulate, type SimInputs } from './sim';
import * as disc from './discovery';

export interface MockResponse {
  status: number;
  body: unknown;
}

export interface MockConfig {
  engine: EngineMode;
}

/** Bank-wide paths the JS mock actually runs (the C++ core runs the requested count). */
const MOCK_BANK_PATHS = 150;
const BILLS_GROWTH_ANNUAL = 0.024;
const REPAIR_RATE = 0.05;

let ds: Dataset | null = null;
const data = () => (ds ??= buildDataset());

const err = (status: number, code: ErrorBody['error']['code'], message: string, field?: string): MockResponse => ({
  status,
  body: { error: { code, message, ...(field ? { field } : {}) } },
});

function parse<T>(schema: z.ZodType<T>, body: unknown): { ok: true; value: T } | { ok: false; res: MockResponse } {
  const r = schema.safeParse(body);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0]!;
  const field = issue.path.join('.');
  return { ok: false, res: err(422, 'validation_error', `${field || 'body'}: ${issue.message}`, field || undefined) };
}

function risk(a: MockAccount) {
  return {
    sd_in: a.sd_in,
    sd_out: a.sd_out,
    flex_share: a.core.S > 0 ? Math.min(1, Math.max(0, a.flex_monthly / a.core.S)) : 0,
    flex_monthly: a.flex_monthly,
    p_jobloss_month: a.district.unemployment_rate_2023 / 12,
    bills_growth_annual: BILLS_GROWTH_ANNUAL,
    repair_rate: REPAIR_RATE,
    repair_size_min_x_s: 0.5,
    repair_size_max_x_s: 2,
    ei_weekly_max: EI_WEEKLY_MAX,
  };
}

function simInputs(a: MockAccount): SimInputs {
  const r = risk(a);
  return {
    I: a.core.I,
    S: a.core.S,
    H: a.core.H,
    B: a.core.B,
    sd_in: r.sd_in,
    sd_out: r.sd_out,
    p_jobloss_month: r.p_jobloss_month,
    bills_growth_annual: r.bills_growth_annual,
    repair_rate: r.repair_rate,
    repair_min_x: r.repair_size_min_x_s,
    repair_max_x: r.repair_size_max_x_s,
  };
}

/** Ordering value: no shortfall ranks above the 120 cap. */
const rank = (r: Runway) => (r.status === 'no_shortfall' ? 121 : r.months);
const unrank = (v: number): Runway =>
  v > 120 ? { status: 'no_shortfall', months: null } : v >= 120 ? { status: 'capped', months: 120 } : v <= 0 ? { status: 'zero', months: 0 } : { status: 'finite', months: round1(v) };

let peerIndex: Map<string, MockAccount[]> | null = null;
function peers(a: MockAccount): AccountResponse['peers'] {
  if (!peerIndex) {
    peerIndex = new Map();
    for (const x of data().accounts) {
      const k = `${x.district.district_id}:${x.income_quintile}`;
      peerIndex.set(k, [...(peerIndex.get(k) ?? []), x]);
    }
  }
  const group = (peerIndex.get(`${a.district.district_id}:${a.income_quintile}`) ?? []).filter((x) => x !== a);
  if (group.length === 0) return { group_size: 0, better_than: null, peer_median_runway: null };
  const own = rank(a.runway_base);
  return {
    group_size: group.length,
    better_than: group.filter((x) => rank(x.runway_base) < own).length / group.length,
    peer_median_runway: unrank(median(group.map((x) => rank(x.runway_base)))),
  };
}

function account(a: MockAccount): AccountResponse {
  const med = (k: keyof MockAccount['rows'][number]) => median(a.rows.map((r) => r[k] as number));
  return {
    profile: {
      account_id: a.account_id,
      district_id: a.district.district_id,
      district_name: a.district.name,
      region: a.district.region,
      income_quintile: a.income_quintile,
      ...a.core,
      P: a.P,
      surplus: a.surplus,
      runway_base: a.runway_base,
      months_of_data: a.rows.length,
      limited_history: a.rows.length < 6,
      days_below_zero_6m: a.days_below_zero_6m,
      ever_below_zero: a.ever_below_zero,
      has_loan: a.loan !== null,
      defaulted: a.defaulted,
    },
    risk: risk(a),
    history: a.rows.map((r) => ({
      month: r.month,
      money_in: r.money_in,
      money_out: r.money_out,
      avg_daily_balance: r.avg_daily_balance,
      days_below_zero: r.days_below_zero,
    })),
    breakdown: {
      household_bills: med('household_bills'),
      insurance: med('insurance'),
      loan_payments: med('loan_payments'),
      card_withdrawals: med('card_withdrawals'),
      cash_withdrawals: med('cash_withdrawals'),
      other_transfers_out: med('other_transfers_out'),
    },
    peers: peers(a),
  };
}

function scenario(a: MockAccount, shock: ScenarioResponse['shock'], T: number): ScenarioResponse {
  const p = { ...a.core, surplus: a.surplus };
  const c = components(p, shock);
  const shocked = runwayFrom(c);
  return {
    account_id: a.account_id,
    shock,
    target_months: T,
    components: c,
    runway_base: a.runway_base,
    runway_shocked: shocked,
    verdict: verdict(shocked, shock.income_months),
    breaking_point: breakingPoint(p, shock, T),
    waterfall: waterfall(p, shock),
    burn_down: burnDown(p, shock),
    goal_plan: goalPlan(p, a.days_below_zero_6m > 0 || a.ever_below_zero),
    backup_plan: backupPlan(p, shock, a.flex_monthly),
  };
}

const HIST_BINS: [string, number | null, number | null, boolean][] = [
  ['0', null, 0, true],
  ['0–1', 0, 1, true],
  ['1–2', 1, 2, true],
  ['2–3', 2, 3, true],
  ['3–4', 3, 4, false],
  ['4–5', 4, 5, false],
  ['5–6', 5, 6, false],
  ['6–9', 6, 9, false],
  ['9–12', 9, 12, false],
  ['12–24', 12, 24, false],
  ['24–120', 24, 120, false],
  ['120+', 120, null, false],
];

function binIndex(r: Runway): number {
  if (r.status === 'zero') return 0;
  if (r.status !== 'finite') return HIST_BINS.length - 1;
  for (let i = 1; i < HIST_BINS.length - 1; i++) if (r.months < HIST_BINS[i]![2]!) return i;
  return HIST_BINS.length - 1;
}

function bank(req: z.infer<typeof SimBankRequestSchema>, engine: EngineMode): SimBankResponse {
  const t0 = performance.now();
  const accts = data().accounts;
  const nPaths = Math.min(req.n_paths, MOCK_BANK_PATHS);
  const counts = HIST_BINS.map(() => 0);
  const cells = new Map<string, { n: number; u: number }>();
  let under = 0;
  let baseUnder = 0;
  let survSum = 0;
  let survLow = 0;
  for (const a of accts) {
    const r = runway(a.core, req.shock);
    const u = isUnder3(r);
    if (u) under++;
    if (isUnder3(a.runway_base)) baseUnder++;
    counts[binIndex(r)]!++;
    const key = `${a.district.region}:${a.income_quintile}`;
    const cell = cells.get(key) ?? { n: 0, u: 0 };
    cell.n++;
    if (u) cell.u++;
    cells.set(key, cell);
    const sim = simulate(simInputs(a), req.shock, {
      nPaths,
      months: req.target_months,
      target: req.target_months,
      seed: accountSeed(req.seed, a.account_id),
      collectFan: false,
    });
    survSum += sim.survival;
    if (sim.survival < 0.5) survLow++;
  }
  const n = accts.length;
  return {
    engine,
    compute_ms: performance.now() - t0,
    n_paths: nPaths,
    months: req.months,
    seed: req.seed,
    target_months: req.target_months,
    n_accounts: n,
    share_under_3: under / n,
    count_under_3: under,
    base_share_under_3: baseUnder / n,
    mean_survival_prob: survSum / n,
    share_survival_below_50: survLow / n,
    histogram: HIST_BINS.map(([label, lo, hi, u3], i) => ({ label, lo, hi, count: counts[i]!, under_3: u3 })),
    regions: REGIONS.flatMap((region) =>
      [1, 2, 3, 4, 5].map((q) => {
        const c = cells.get(`${region}:${q}`) ?? { n: 0, u: 0 };
        return { region, income_quintile: q, accounts: c.n, share_under_3: c.n ? c.u / c.n : 0 };
      }),
    ),
  };
}

const cache = new Map<string, unknown>();
const once = <T>(key: string, f: () => T): T => {
  if (!cache.has(key)) cache.set(key, f());
  return cache.get(key) as T;
};

export function handle(method: string, path: string, body: unknown, cfg: MockConfig): MockResponse {
  const d = data();
  const url = new URL(path, 'http://mock');
  const p = url.pathname;
  const notFound = (id: number) => err(404, 'not_found', `No account with ID ${id}`, 'account_id');
  const getAccount = (id: number) => d.byId.get(id);

  if (method === 'GET' && p === '/api/health') {
    return {
      status: 200,
      body: {
        status: 'ok',
        engine: cfg.engine,
        threads: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1,
        accounts: d.accounts.length,
        data_first_month: MONTHS[0],
        data_last_month: MONTHS[MONTHS.length - 1],
        version: 'mock-0.1.0',
      },
    };
  }
  if (method === 'GET' && p === '/api/accounts/random') {
    const a = d.accounts[Math.floor(Math.random() * d.accounts.length)]!;
    return { status: 200, body: { account_id: a.account_id } };
  }
  const acct = p.match(/^\/api\/accounts\/(-?\d+)$/);
  if (method === 'GET' && acct) {
    const id = Number(acct[1]);
    const a = getAccount(id);
    return a ? { status: 200, body: account(a) } : notFound(id);
  }
  if (method === 'POST' && p === '/api/scenario') {
    const r = parse(ScenarioRequestSchema, body);
    if (!r.ok) return r.res;
    const a = getAccount(r.value.account_id);
    return a ? { status: 200, body: scenario(a, r.value.shock, r.value.target_months) } : notFound(r.value.account_id);
  }
  if (method === 'POST' && p === '/api/simulate/account') {
    const r = parse(SimAccountRequestSchema, body);
    if (!r.ok) return r.res;
    const a = getAccount(r.value.account_id);
    if (!a) return notFound(r.value.account_id);
    const t0 = performance.now();
    const sim = simulate(simInputs(a), r.value.shock, {
      nPaths: r.value.n_paths,
      months: r.value.months,
      target: r.value.target_months,
      seed: accountSeed(r.value.seed, a.account_id),
      collectFan: true,
    });
    const res: SimAccountResponse = {
      account_id: a.account_id,
      engine: cfg.engine,
      compute_ms: performance.now() - t0,
      n_paths: r.value.n_paths,
      months: r.value.months,
      seed: r.value.seed,
      target_months: r.value.target_months,
      survival_prob: sim.survival,
      first_negative: sim.firstNegative,
      fan: sim.fan!,
    };
    return { status: 200, body: res };
  }
  if (method === 'POST' && p === '/api/simulate/bank') {
    const r = parse(SimBankRequestSchema, body);
    if (!r.ok) return r.res;
    return { status: 200, body: bank(r.value, cfg.engine) };
  }
  if (method === 'GET' && p === '/api/discovery/finding') return { status: 200, body: once('finding', () => disc.finding(d)) };
  if (method === 'GET' && p === '/api/discovery/defaults') return { status: 200, body: once('defaults', () => disc.defaults(d)) };
  if (method === 'GET' && p === '/api/discovery/tipping') return { status: 200, body: { ...once('tipping', () => disc.tipping(d)), engine: cfg.engine } };
  if (method === 'GET' && p === '/api/discovery/ei-cap') return { status: 200, body: once('eicap', () => disc.eiCap(d)) };
  if (method === 'GET' && p === '/api/discovery/benchmark') return { status: 200, body: disc.benchmark() };
  if (method === 'GET' && p === '/api/time-machine') return { status: 200, body: once('tm', () => disc.timeMachineList(d)) };
  const tm = p.match(/^\/api\/time-machine\/(-?\d+)$/);
  if (method === 'GET' && tm) {
    const id = Number(tm[1]);
    const r = disc.timeMachineReplay(d, id);
    return r ? { status: 200, body: r } : err(404, 'not_found', `No defaulted account with ID ${id}`, 'account_id');
  }
  return err(404, 'not_found', `No route ${method} ${p}`);
}

/** Build the dataset up front so the first request is fast. */
export function warm(): number {
  return data().accounts.length;
}
