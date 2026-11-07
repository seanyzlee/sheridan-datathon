import { NO_SHOCK, type Shock } from '../api/schemas';

/** What the shock panel edits. One-off can be typed in CAD or as a multiple of S. */
export interface ShockDraft extends Omit<Shock, 'one_off' | 'one_off_x_s'> {
  one_off_mode: 'cad' | 'xs';
  one_off_value: number;
}

export const NO_DRAFT: ShockDraft = {
  income_factor: NO_SHOCK.income_factor,
  income_months: NO_SHOCK.income_months,
  bills_pct: NO_SHOCK.bills_pct,
  spend_delta: NO_SHOCK.spend_delta,
  ei_cap_on: NO_SHOCK.ei_cap_on,
  one_off_mode: 'cad',
  one_off_value: 0,
};

export function oneOffCad(d: ShockDraft, S: number): number {
  return d.one_off_mode === 'xs' ? d.one_off_value * S : d.one_off_value;
}

/** Convert the draft to the API shock, clamped to the contract limits. */
export function toShock(d: ShockDraft): Shock {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
  const xs = d.one_off_mode === 'xs';
  return {
    income_factor: clamp(Math.round(d.income_factor * 100) / 100, 0, 1),
    income_months: clamp(Math.round(d.income_months), 0, 24),
    bills_pct: clamp(Math.round(d.bills_pct * 100) / 100, 0, 1),
    spend_delta: clamp(Math.round(d.spend_delta), 0, 20_000),
    one_off: xs ? 0 : clamp(Math.round(d.one_off_value), 0, 1_000_000),
    one_off_x_s: xs ? clamp(Math.round(d.one_off_value * 100) / 100, 0, 24) : 0,
    ei_cap_on: d.ei_cap_on,
  };
}

export const isNoShock = (s: Shock) =>
  s.income_factor === 1 && s.bills_pct === 0 && s.spend_delta === 0 && s.one_off === 0 && s.one_off_x_s === 0;

/** Survival target T: the EI length if set, otherwise 6 months. */
export const targetMonths = (s: Pick<Shock, 'income_months'>) => (s.income_months > 0 ? s.income_months : 6);

export interface Preset {
  id: string;
  title: string;
  card: string;
  draft: ShockDraft;
}

/** The three example twist cards from the roadmap. `card` is what the twist reader parses. */
export const PRESETS: Preset[] = [
  {
    id: 'ei6',
    title: 'Job loss',
    card: 'EI 55% for 6 months',
    draft: { ...NO_DRAFT, income_factor: 0.55, income_months: 6 },
  },
  {
    id: 'repair',
    title: 'Surprise bill',
    card: 'A one-off cost of a full month of spending',
    draft: { ...NO_DRAFT, one_off_mode: 'xs', one_off_value: 1 },
  },
  {
    id: 'ei-bills',
    title: 'Job loss + bills',
    card: 'EI 55% with bills up 15%',
    draft: { ...NO_DRAFT, income_factor: 0.55, bills_pct: 0.15 },
  },
];

export function sameDraft(a: ShockDraft, b: ShockDraft): boolean {
  return (
    a.income_factor === b.income_factor &&
    a.income_months === b.income_months &&
    a.bills_pct === b.bills_pct &&
    a.spend_delta === b.spend_delta &&
    a.ei_cap_on === b.ei_cap_on &&
    a.one_off_mode === b.one_off_mode &&
    a.one_off_value === b.one_off_value
  );
}

/** Short description used in the advisor summary, e.g. "income drops to 55% for 6 months". */
/** Pass S for one customer; omit it for bank-wide text, where "× S" differs per customer. */
export function describeShock(s: Shock, S?: number): string {
  const parts: string[] = [];
  if (s.income_factor < 1) {
    const ei = Math.abs(s.income_factor - 0.55) < 1e-9;
    const base = ei ? 'they go on EI at 55% of income' : `income drops to ${Math.round(s.income_factor * 100)}%`;
    parts.push(base + (s.income_months > 0 ? ` for ${s.income_months} months` : '') + (s.ei_cap_on ? ' (capped at the EI weekly maximum)' : ''));
  }
  if (s.bills_pct > 0) parts.push(`bills rise ${Math.round(s.bills_pct * 100)}%`);
  if (s.spend_delta > 0) parts.push(`spending rises $${Math.round(s.spend_delta).toLocaleString('en-CA')} a month`);
  if (S === undefined && s.one_off_x_s > 0) {
    parts.push(`a one-off cost of ${s.one_off_x_s} × each customer’s monthly spending hits`);
  } else {
    const oneOff = s.one_off + s.one_off_x_s * (S ?? 0);
    if (oneOff > 0) parts.push(`a $${Math.round(oneOff).toLocaleString('en-CA')} one-off cost hits`);
  }
  if (parts.length === 0) return 'nothing changes';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
