import type { Runway, Shock } from "./api";

export const RUNWAY_CAP = 120;

const cad0 = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

export function money(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return "n/a";
  return cad0.format(x).replace("CA", "");
}

export function compactMoney(x: number): string {
  const a = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000) return `${sign}$${Math.round(a / 1000)}K`;
  return `${sign}$${Math.round(a).toLocaleString("en-CA")}`;
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (x == null || Number.isNaN(x)) return "n/a";
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x: number, digits = 1): string {
  const v = (x * 100).toFixed(digits);
  return `${x > 0 ? "+" : x < 0 ? "" : "±"}${v} pts`;
}

export function isOpenEnded(r: Runway): boolean {
  return r.no_shortfall || r.months >= RUNWAY_CAP;
}

/** The runway as a short figure: "4.2" or "120+" (unit printed separately). */
export function runwayFigure(r: Runway): string {
  return isOpenEnded(r) ? "120+" : r.months.toFixed(1);
}

export function runwayLabel(r: Runway): string {
  return isOpenEnded(r) ? "120+ months" : `${r.months.toFixed(1)} months`;
}

export function months(m: number): string {
  return m >= RUNWAY_CAP ? "120+ months" : `${m.toFixed(1)} months`;
}

export function isNoShock(s: Shock): boolean {
  return s.income_factor === 1 && !s.bills_pct && !s.spend_delta && !s.one_off && !s.one_off_x_S && !s.ei_cap_on;
}

export function describeShock(s: Shock): string {
  if (isNoShock(s) && !s.income_months) return "No shock";
  const parts: string[] = [];
  if (s.income_factor !== 1) parts.push(`income at ${pct(s.income_factor)}${s.income_months ? ` for ${s.income_months} months` : ""}`);
  if (s.bills_pct) parts.push(`bills up ${pct(s.bills_pct)}`);
  if (s.spend_delta) parts.push(`other costs up ${money(s.spend_delta)} a month`);
  if (s.one_off) parts.push(`a ${money(s.one_off)} one-off`);
  if (s.one_off_x_S) parts.push(`a one-off of ${s.one_off_x_S} × a month's spending`);
  if (s.ei_cap_on) parts.push("EI weekly maximum applied");
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-CA", { month: "short", year: "numeric" });
}

export function shortMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-CA", { month: "short", year: "2-digit" });
}
