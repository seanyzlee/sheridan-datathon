// Typed client for the FastAPI backend (api.py). Every number is computed server-side by the engine.

export interface Shock {
  income_factor: number;
  income_months: number | null;
  bills_pct: number;
  spend_delta: number;
  one_off: number;
  one_off_x_S: number;
  ei_cap_on: boolean;
}

export const NO_SHOCK: Shock = {
  income_factor: 1, income_months: null, bills_pct: 0, spend_delta: 0, one_off: 0, one_off_x_S: 0, ei_cap_on: false,
};

export interface Status {
  source: string; live: boolean; backend: string; is_cpp: boolean; accounts: number;
  bank_paths: number; bank_months: number; one_paths: number; ei_weekly_max: number;
  presets: Record<string, Shock>;
  gemini: boolean; gemini_model: string;
}

export interface Runway { months: number; no_shortfall: boolean; buffer_left: number; income: number; spending: number; gap: number }

export interface Profile {
  account_id: number; I: number; S: number; F: number; H: number; B: number; P: number;
  months_of_data: number; days_below_zero_6m: number; has_loan: boolean; loan_running: boolean; defaulted: boolean;
  surplus: number;
}

export interface Customer {
  account_id: number; source: string; live: boolean; profile: Profile;
  facts: { district: string; region: string; through: string };
  runway_base: Runway;
  monthly: { month: string; money_in: number; money_out: number; balance: number }[];
  spending: { category: string; amount: number; fixed: boolean }[];
  flags: { level: "high" | "medium" | "ok"; text: string }[];
  peers: { pct_better: number; n_peers: number; region: string; income_band: number; buffer_months: number | null; peer_median_buffer_months: number | null };
  goal: { target: number; months_to_target: number | null; monthly_cut_needed: number; cut_pct_of_flexible: number | null; reason: string };
}

export interface ShockResult {
  account_id: number; source: string; shock: Shock; target: number;
  runway_base: Runway; runway: Runway; makes_it: boolean | null;
  survival: { p: number; n_paths: number; ms: number; backend: string };
  breaking_point: { target_months: number; income_factor: number | null; one_off: number; bills_pct: number | null; already_broken: boolean };
  summary: string;
  waterfall: { step: string; months: number; measure: "absolute" | "relative" | "total" }[];
  burn_down: { month: number; balance: number; ei_ends: number | null; p10: number | null; p50: number | null; p90: number | null }[];
  backup: { target_months: number; already_ok: boolean; cut_amount: number | null; flexible: number; cut_pct: number | null; possible: boolean; new_runway: number };
}

export interface Bank {
  shock: Shock; target: number; seconds: number; backend: string; paths: number; months: number; customers: number;
  kpis: { under3: number; under3_base: number; out_of_money: number; expected_run_out: number; likely_run_out: number };
  histogram: { months: number; label: string; under3: number; over3: number }[];
  heatmap: { region: string; band: string; share: number | null; n: number | null }[];
  regions: string[]; bands: string[];
  worst: { account_id: number; region: string; district_name: string; I: number; S: number; B: number; runway: number; no_shortfall: boolean; survival: number }[];
}

export interface AutopilotStep { id: string; label: string; detail: string; saving: number; saving_text: string; adds: number; adds_text: string; runway_after_text: string }
export interface Autopilot {
  account_id: number; source: string;
  detection: { detected: boolean; month?: string; ratio?: number; message?: string; drop?: string; income_seen?: string; income_usual?: string; suggested_shock?: Shock };
  ladder: AutopilotStep[];
  result: {
    target: number; chosen: string[]; saving_text: string; makes_it: boolean; verdict: string;
    before: { months: number; text: string; survival: number }; after: { months: number; text: string; survival: number };
  };
}

export interface Surface {
  income: number[]; bills: number[]; under3: number[][];          // under3[income index][bills index], share 0..1
  marker: { income: number; bills: number; under3: number };    // the current shock, exact
  held: string[]; customers: number; seconds: number; max: number;
}

export interface Finding {
  main: { headline: string; caught: number; false_alarms: number; ratio: number; median_lead: number; rate_flagged: number; rate_not_flagged: number; ei_under6: number; under3_default_rate: number; no_shortfall_default_rate: number };
  rules: { rule: string; label: string; caught: number; false_alarms: number; default_rate_flagged: number; default_rate_not_flagged: number; ratio: number; median_lead_months: number; flagged: number; defaults: number; loans: number }[];
  default_by_band: { band: string; default_rate: number; defaults: number; loans: number }[];
  fragile_groups: { dimension: string; group: string; share_fail_6m_ei: number; customers: number }[];
  tipping_point: { income: string; bills_pct: number; under_3: number; under_6: number }[];
  twist_impact: { twist: string; under_3: number; under_6: number; out_of_money: number; median_runway: number }[];
  ei_cap: { hit: number; crossed: number };
  regional: { r_unemployment: number; r_salary: number; districts: number; rows: { district_name: string; region: string; share_fail: number; customers: number; unemployment: number; salary: number }[] };
}

export interface TimeMachineItem { account_id: number; lead_months: number | null; status: string }
export interface TimeMachine {
  account_id: number; loan_start: string; known: string; status: string; lead_months: number | null; first_flag: string | null;
  months: { month: string; runway: number; runway_ei: number; buffer: number }[];
}

export interface Method {
  backend: string; ei_weekly_max: number; cpi: number; noise_scale: number; repair_rate: number;
  bench: { method: string; threads: number; seconds: number; note: string; speedup_vs_python: number; million_steps_per_s: number }[];
  backtest: { model: string; noise_scale: number; predicted_share: number; actual_share: number; brier: number; accounts: number }[];
}

export interface TwistReading { understood: boolean; notes: string[]; shock: Shock; parsed: Record<string, number | boolean> }
export interface ParsedTwist extends TwistReading {
  source: "rules" | "gemini";
  rules: TwistReading;
  gemini: TwistReading | null;
  agree: boolean | null;      // null when the rule-based reader found nothing to compare
  model?: string;
}
export type ChatAction =
  | { type: "open_account"; account_id: number }
  | { type: "set_shock"; shock: Shock }
  | { type: "set_view"; view: "simple" | "advanced" }
  | { type: "set_theme"; theme: "light" | "dark" | "system" }
  | { type: "navigate"; path: string }
  | { type: "set_data_source"; use_live?: boolean; follow?: boolean };
export interface ChatReply { reply: string; actions: ChatAction[]; tools_used: string[]; unchecked: string[]; ok: boolean; model?: string }
export interface ChatRequest {
  messages: { role: "user" | "assistant"; text: string }[];
  account_id: number; shock: Shock; page: string; view: "simple" | "advanced";
}

export interface AdvisorNote { text: string; source: "rules" | "gemini"; model: string | null }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(0, "The server isn't answering. Check that the API is running (uvicorn api:app).");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try { const body = await res.json(); if (typeof body.detail === "string") detail = body.detail; } catch { /* not JSON */ }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  status: () => request<Status>("/api/status"),
  accounts: () => request<{ ids: number[] }>("/api/accounts"),
  randomAccount: () => request<{ account_id: number }>("/api/accounts/random"),
  parseTwist: (text: string) => post<ParsedTwist>("/api/twist/parse", { text }),
  customer: (id: number, live: boolean) => request<Customer>(`/api/customer/${id}?live=${live}`),
  shock: (id: number, shock: Shock, live: boolean) => post<ShockResult>(`/api/customer/${id}/shock?live=${live}`, shock),
  autopilot: (id: number, shock: Shock, steps: string[], live: boolean) => post<Autopilot>(`/api/customer/${id}/autopilot?live=${live}`, { shock, steps }),
  note: (id: number, shock: Shock, live: boolean) => post<AdvisorNote>(`/api/customer/${id}/note?live=${live}`, shock),
  chat: (body: ChatRequest) => post<ChatReply>("/api/chat", body),
  bank: (shock: Shock) => post<Bank>("/api/bank", shock),
  surface: (shock: Shock) => post<Surface>("/api/bank/surface", shock),
  finding: () => request<Finding>("/api/finding"),
  timeMachineList: () => request<{ customers: TimeMachineItem[] }>("/api/time-machine"),
  timeMachine: (id: number) => request<TimeMachine>(`/api/time-machine/${id}`),
  method: () => request<Method>("/api/method"),
};
