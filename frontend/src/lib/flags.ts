import type { Profile } from '../api/schemas';
import { cad } from './format';

export interface RiskFlag {
  id: string;
  level: 'high' | 'medium' | 'info';
  label: string;
}

/** Risk flags are derived from the profile so the API stays small. */
export function riskFlags(p: Profile): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (p.I <= 0) flags.push({ id: 'no-income', level: 'high', label: 'No income recorded' });
  if (p.defaulted) flags.push({ id: 'defaulted', level: 'high', label: 'Defaulted loan' });
  if (p.days_below_zero_6m > 0)
    flags.push({ id: 'below-zero', level: 'high', label: `${p.days_below_zero_6m} days below zero in the last 6 months` });
  if (p.B < p.S) flags.push({ id: 'thin-buffer', level: 'medium', label: 'Buffer under 1 month of spending' });
  if (p.limited_history) flags.push({ id: 'limited', level: 'info', label: `Limited history (${p.months_of_data} months)` });
  if (p.S <= 0) flags.push({ id: 'no-spending', level: 'info', label: 'No spending recorded' });
  if (p.P > 0) flags.push({ id: 'loan', level: 'info', label: `Loan running: ${cad(p.P)}/month` });
  return flags;
}
