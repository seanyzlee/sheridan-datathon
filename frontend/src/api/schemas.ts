/**
 * API contract shared by the mock layer and the FastAPI server.
 *
 * Units: money is CAD per month unless the name says otherwise, durations are
 * months, shares and probabilities are fractions 0..1, timings are milliseconds.
 * docs/frontend_implementation.md §3 documents every route that uses these.
 */
import { z } from 'zod';

// ---------- shared ----------

export const EngineModeSchema = z.enum(['cpp', 'numpy', 'js']);
export type EngineMode = z.infer<typeof EngineModeSchema>;

/** Judges' runway. `no_shortfall` is never encoded as the number 120. */
export const RunwaySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('zero'), months: z.literal(0) }),
  // finite can be 0.0 when buffer_left / gap < 0.05 (the judges' rounding).
  z.object({ status: z.literal('finite'), months: z.number().min(0).lt(120) }),
  z.object({ status: z.literal('capped'), months: z.literal(120) }),
  z.object({ status: z.literal('no_shortfall'), months: z.null() }),
]);
export type Runway = z.infer<typeof RunwaySchema>;

export const SHOCK_LIMITS = {
  income_factor: [0, 1],
  income_months: [0, 24],
  bills_pct: [0, 1],
  spend_delta: [0, 20_000],
  one_off: [0, 1_000_000],
} as const;

/**
 * The effective one-off for an account is one_off + one_off_x_s × S, so
 * "a full month of spending" (one_off_x_s = 1) scales per customer in bank-wide runs.
 */
export const ShockSchema = z.object({
  income_factor: z.number().min(0).max(1),
  income_months: z.number().int().min(0).max(24),
  bills_pct: z.number().min(0).max(1),
  spend_delta: z.number().min(0).max(20_000),
  one_off: z.number().min(0).max(1_000_000),
  one_off_x_s: z.number().min(0).max(24),
  ei_cap_on: z.boolean(),
});
export type Shock = z.infer<typeof ShockSchema>;

export const NO_SHOCK: Shock = {
  income_factor: 1,
  income_months: 0,
  bills_pct: 0,
  spend_delta: 0,
  one_off: 0,
  one_off_x_s: 0,
  ei_cap_on: false,
};

export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(['not_found', 'validation_error', 'internal']),
    message: z.string(),
    field: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

const money = z.number();
const fraction = z.number().min(0).max(1);
const monthStr = z.string().regex(/^\d{4}-\d{2}$/);

// ---------- GET /api/health ----------

export const HealthSchema = z.object({
  status: z.literal('ok'),
  engine: EngineModeSchema,
  threads: z.number().int().min(1),
  accounts: z.number().int(),
  data_first_month: monthStr,
  data_last_month: monthStr,
  version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

// ---------- GET /api/accounts/random ----------

export const RandomAccountSchema = z.object({ account_id: z.number().int() });

// ---------- GET /api/accounts/{account_id} ----------

export const ProfileSchema = z.object({
  account_id: z.number().int(),
  district_id: z.number().int(),
  district_name: z.string(),
  region: z.string(),
  income_quintile: z.number().int().min(1).max(5),
  I: money,
  S: money,
  F: money,
  H: money,
  B: money,
  P: money,
  surplus: money,
  runway_base: RunwaySchema,
  months_of_data: z.number().int().min(0),
  limited_history: z.boolean(),
  days_below_zero_6m: z.number().int().min(0),
  ever_below_zero: z.boolean(),
  has_loan: z.boolean(),
  defaulted: z.boolean(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const RiskFactorsSchema = z.object({
  sd_in: money,
  sd_out: money,
  flex_share: fraction,
  flex_monthly: money,
  p_jobloss_month: fraction,
  bills_growth_annual: z.number(),
  repair_rate: fraction,
  repair_size_min_x_s: z.number(),
  repair_size_max_x_s: z.number(),
  ei_weekly_max: money,
});
export type RiskFactors = z.infer<typeof RiskFactorsSchema>;

export const HistoryRowSchema = z.object({
  month: monthStr,
  money_in: money,
  money_out: money,
  avg_daily_balance: money,
  days_below_zero: z.number().int().min(0),
});
export type HistoryRow = z.infer<typeof HistoryRowSchema>;

export const BreakdownSchema = z.object({
  household_bills: money,
  insurance: money,
  loan_payments: money,
  card_withdrawals: money,
  cash_withdrawals: money,
  other_transfers_out: money,
});
export type Breakdown = z.infer<typeof BreakdownSchema>;

export const PeersSchema = z.object({
  group_size: z.number().int().min(0),
  better_than: fraction.nullable(),
  peer_median_runway: RunwaySchema.nullable(),
});
export type Peers = z.infer<typeof PeersSchema>;

export const AccountResponseSchema = z.object({
  profile: ProfileSchema,
  risk: RiskFactorsSchema,
  history: z.array(HistoryRowSchema).max(24),
  breakdown: BreakdownSchema,
  peers: PeersSchema,
});
export type AccountResponse = z.infer<typeof AccountResponseSchema>;

// ---------- POST /api/scenario ----------

export const ScenarioRequestSchema = z.object({
  account_id: z.number().int(),
  shock: ShockSchema,
  target_months: z.number().int().min(1).max(24),
});
export type ScenarioRequest = z.infer<typeof ScenarioRequestSchema>;

export const LimitSchema = z.object({
  status: z.enum(['ok', 'always_safe', 'already_short', 'not_applicable']),
  value: z.number().nullable(),
});
export type Limit = z.infer<typeof LimitSchema>;

export const WaterfallKeySchema = z.enum(['base', 'income', 'bills', 'other', 'one_off']);
export type WaterfallKey = z.infer<typeof WaterfallKeySchema>;

export const ScenarioResponseSchema = z.object({
  account_id: z.number().int(),
  shock: ShockSchema,
  target_months: z.number().int(),
  components: z.object({
    buffer_left: money,
    income: money,
    spending: money,
    gap: money,
    ei_capped: z.boolean(),
  }),
  runway_base: RunwaySchema,
  runway_shocked: RunwaySchema,
  verdict: z.enum(['makes_it', 'falls_short']).nullable(),
  breaking_point: z.object({
    target_months: z.number().int(),
    income_factor: LimitSchema,
    one_off: LimitSchema,
    bills_pct: LimitSchema,
  }),
  waterfall: z.array(z.object({ key: WaterfallKeySchema, runway: RunwaySchema })).length(5),
  burn_down: z.object({
    balance: z.array(money),
    zero_month: z.number().nullable(),
  }),
  goal_plan: z.object({
    target: money,
    multiple: z.union([z.literal(3), z.literal(6)]),
    current_buffer: money,
    shortfall: money,
    status: z.enum(['reached', 'on_track', 'needs_cut']),
    months_to_target: z.number().nullable(),
    monthly_cut_needed: money.nullable(),
    cut_horizon_months: z.number().int(),
  }),
  backup_plan: z.object({
    flexible_monthly: money,
    target_months: z.number().int(),
    status: z.enum(['not_needed', 'cut_works', 'not_enough', 'buffer_gone', 'no_flexible']),
    cut_pct: fraction.nullable(),
    monthly_saving: money.nullable(),
    runway_after: RunwaySchema,
  }),
});
export type ScenarioResponse = z.infer<typeof ScenarioResponseSchema>;

// ---------- POST /api/simulate/account ----------

const SimParams = {
  shock: ShockSchema,
  n_paths: z.number().int().min(100).max(100_000),
  months: z.number().int().min(1).max(120),
  seed: z.number().int().min(0),
  target_months: z.number().int().min(1).max(120),
};

export const SimAccountRequestSchema = z.object({ account_id: z.number().int(), ...SimParams });
export type SimAccountRequest = z.infer<typeof SimAccountRequestSchema>;

const SimMeta = {
  engine: EngineModeSchema,
  compute_ms: z.number().min(0),
  n_paths: z.number().int(),
  months: z.number().int(),
  seed: z.number().int(),
  target_months: z.number().int(),
};

export const SimAccountResponseSchema = z.object({
  account_id: z.number().int(),
  ...SimMeta,
  survival_prob: fraction,
  first_negative: z.object({
    p10: z.number().nullable(),
    p50: z.number().nullable(),
    p90: z.number().nullable(),
  }),
  fan: z.object({
    p10: z.array(money),
    p50: z.array(money),
    p90: z.array(money),
  }),
});
export type SimAccountResponse = z.infer<typeof SimAccountResponseSchema>;

// ---------- POST /api/simulate/bank ----------

export const SimBankRequestSchema = z.object(SimParams);
export type SimBankRequest = z.infer<typeof SimBankRequestSchema>;

export const HistogramBinSchema = z.object({
  label: z.string(),
  lo: z.number().nullable(),
  hi: z.number().nullable(),
  count: z.number().int(),
  under_3: z.boolean(),
});

export const SimBankResponseSchema = z.object({
  ...SimMeta,
  n_accounts: z.number().int(),
  share_under_3: fraction,
  count_under_3: z.number().int(),
  base_share_under_3: fraction,
  mean_survival_prob: fraction,
  share_survival_below_50: fraction,
  histogram: z.array(HistogramBinSchema),
  regions: z.array(
    z.object({
      region: z.string(),
      income_quintile: z.number().int().min(1).max(5),
      accounts: z.number().int(),
      share_under_3: fraction,
    }),
  ),
});
export type SimBankResponse = z.infer<typeof SimBankResponseSchema>;

// ---------- Discovery ----------

export const FindingSchema = z.object({
  headline: z.string(),
  sentence: z.string(),
  chart: z.object({
    x_label: z.string(),
    y_label: z.string(),
    y_format: z.enum(['percent', 'months', 'number']),
    categories: z.array(z.string()),
    values: z.array(z.number()),
    highlight_index: z.number().int().nullable(),
  }),
  method: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const DefaultsSchema = z.object({
  loans_total: z.number().int(),
  defaults_total: z.number().int(),
  bands: z.array(
    z.object({
      label: z.string(),
      lo: z.number(),
      hi: z.number().nullable(),
      loans: z.number().int(),
      defaults: z.number().int(),
      default_rate: fraction,
    }),
  ),
  bottom_band_rate: fraction,
  top_band_rate: fraction,
  ratio: z.number().nullable(),
  overall_rate: fraction,
});
export type Defaults = z.infer<typeof DefaultsSchema>;

export const TippingSchema = z.object({
  engine: EngineModeSchema,
  compute_ms: z.number().min(0),
  n_accounts: z.number().int(),
  axis: z.object({
    key: z.enum(['income_factor', 'bills_pct', 'one_off_x_s']),
    label: z.string(),
    values: z.array(z.number()),
  }),
  series: z.array(
    z.object({
      label: z.string(),
      share_under_3: z.array(fraction),
    }),
  ),
  headline_series: z.number().int(),
  tipping_index: z.number().int(),
  sentence: z.string(),
});
export type Tipping = z.infer<typeof TippingSchema>;

export const EiCapSchema = z.object({
  ei_rate: fraction,
  ei_weekly_max: money,
  ei_monthly_max: money,
  source_url: z.string(),
  accounts_total: z.number().int(),
  accounts_affected: z.number().int(),
  avg_runway_lost: z.number(),
  under_3_judges: z.number().int(),
  under_3_capped: z.number().int(),
  by_quintile: z.array(
    z.object({
      income_quintile: z.number().int().min(1).max(5),
      median_runway_judges: z.number(),
      median_runway_capped: z.number(),
      share_affected: fraction,
    }),
  ),
});
export type EiCap = z.infer<typeof EiCapSchema>;

export const BenchmarkSchema = z.object({
  measured: z.boolean(),
  machine: z.string(),
  threads: z.number().int(),
  workload: z.object({
    accounts: z.number().int(),
    paths: z.number().int(),
    months: z.number().int(),
  }),
  rows: z.array(
    z.object({
      engine: z.enum(['python', 'numpy', 'cpp_1', 'cpp_all']),
      label: z.string(),
      seconds: z.number().positive(),
      speedup: z.number().positive(),
    }),
  ),
});
export type Benchmark = z.infer<typeof BenchmarkSchema>;

export const TimeMachineListSchema = z.object({
  flag_threshold_months: z.number(),
  accounts: z.array(
    z.object({
      account_id: z.number().int(),
      default_month: monthStr,
      lead_months: z.number().int().nullable(),
    }),
  ),
});
export type TimeMachineList = z.infer<typeof TimeMachineListSchema>;

export const TimeMachineReplaySchema = z.object({
  account_id: z.number().int(),
  default_month: monthStr,
  flag_threshold_months: z.number(),
  first_flag_month: monthStr.nullable(),
  lead_months: z.number().int().nullable(),
  months: z.array(
    z.object({
      month: monthStr,
      runway: RunwaySchema,
      B: money,
      I: money,
      S: money,
      flagged: z.boolean(),
    }),
  ),
});
export type TimeMachineReplay = z.infer<typeof TimeMachineReplaySchema>;
