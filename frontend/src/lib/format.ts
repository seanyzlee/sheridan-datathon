import type { Limit, Runway } from '../api/schemas';

const cadFmt = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0, currencyDisplay: 'narrowSymbol' });
const numFmt = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 1 });

/** CAD rounded to the dollar with thousands separators; minus sign is a true minus. */
export const cad = (x: number) => (x < 0 ? `−${cadFmt.format(-x)}` : cadFmt.format(x));
export const cadCompact = (x: number) => (Math.abs(x) < 1000 ? cad(x) : `${x < 0 ? '−' : ''}$${compactFmt.format(Math.abs(x))}`);
export const int = (x: number) => numFmt.format(x);
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const pct1 = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
export const months1 = (x: number) => x.toFixed(1);

/** Runway number only, e.g. "4.2", "0.0", "120", "120+". */
export function runwayNumber(r: Runway): string {
  switch (r.status) {
    case 'zero':
      return '0.0';
    case 'finite':
      return r.months.toFixed(1);
    case 'capped':
      return '120';
    case 'no_shortfall':
      return '120+';
  }
}

/** Runway as a phrase for text, e.g. "4.2 months" or "no shortfall (120+)". */
export function runwayPhrase(r: Runway): string {
  switch (r.status) {
    case 'zero':
      return '0 months';
    case 'finite':
      return `${r.months.toFixed(1)} months`;
    case 'capped':
      return '120 months (the cap)';
    case 'no_shortfall':
      return 'no shortfall (120+)';
  }
}

/** Value used to draw bars: no shortfall and the cap both draw at 120. */
export const runwayBar = (r: Runway) => (r.status === 'no_shortfall' ? 120 : r.months);

export function seconds(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function monthLabel(m: string): string {
  const [y, mm] = m.split('-');
  const name = new Date(Number(y), Number(mm) - 1, 1).toLocaleString('en-CA', { month: 'short' });
  return `${name} ${y!.slice(2)}`;
}

export const limitValue = (l: Limit) => l.value ?? 0;
