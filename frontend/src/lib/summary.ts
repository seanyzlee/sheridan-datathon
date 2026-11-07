/**
 * Rule-based advisor summary (2–3 sentences). Uses the same formatters as the panels,
 * so every number in the text matches the number on screen.
 */
import type { Profile, ScenarioResponse, SimAccountResponse } from '../api/schemas';
import { cad, int, months1, pct, runwayPhrase } from './format';
import { describeShock, isNoShock } from './shock';

export function advisorSummary(profile: Profile, sc: ScenarioResponse, sim: SimAccountResponse | undefined): string[] {
  const out: string[] = [];
  const s = sc.shock;
  const r = sc.runway_shocked;
  const none = isNoShock(s);
  const lead = none ? 'Today' : `If ${describeShock(s, profile.S)}`;

  // 1. Runway and verdict
  if (r.status === 'zero') {
    out.push(
      profile.B <= 0
        ? `${lead}, they have no buffer to fall back on (average balance ${cad(profile.B)}), so any shortfall hits straight away.`
        : `${lead}, the one-off cost uses up their whole ${cad(profile.B)} buffer, leaving no runway.`,
    );
  } else if (r.status === 'no_shortfall') {
    out.push(`${lead}, their income still covers their spending, so the ${cad(profile.B)} buffer isn't drawn down.`);
  } else {
    let first = `${lead}, their ${cad(sc.components.buffer_left)} buffer covers the ${cad(sc.components.gap)} monthly gap for ${runwayPhrase(r)}.`;
    if (sc.verdict) {
      first +=
        sc.verdict === 'makes_it'
          ? ` That is enough to get through ${s.income_months} months on reduced income.`
          : ` That falls short of the ${s.income_months} months on reduced income.`;
    }
    out.push(first);
  }

  // 2. Simulation and breaking point
  const bp = sc.breaking_point;
  const limits: string[] = [];
  if (bp.income_factor.status === 'ok') limits.push(`income drops below ${pct(bp.income_factor.value!)}`);
  if (bp.one_off.status === 'ok') limits.push(`a one-off cost tops ${cad(bp.one_off.value!)}`);
  const simText = sim ? `Across ${int(sim.n_paths)} simulated futures, ${pct(sim.survival_prob)} stay above zero for ${sim.target_months} months. ` : '';
  if (limits.length) out.push(`${simText}They fall short of ${bp.target_months} months if ${limits.join(' or ')}.`);
  else if (simText) out.push(simText.trim());

  // 3. Plan
  const bk = sc.backup_plan;
  const g = sc.goal_plan;
  if (bk.status === 'cut_works' && bk.cut_pct !== null && bk.monthly_saving !== null) {
    out.push(
      `Cutting flexible spending (card, cash and transfers) by ${pct(bk.cut_pct)}, about ${cad(bk.monthly_saving)} a month, would stretch the runway to ${runwayPhrase(bk.runway_after)}.`,
    );
  } else if (bk.status === 'not_enough') {
    out.push(`Even cutting all flexible spending only reaches ${runwayPhrase(bk.runway_after)}, so fixed costs need a look too.`);
  } else if (g.status === 'reached') {
    out.push(`They already hold the ${g.multiple}-month emergency fund of ${cad(g.target)}.`);
  } else if (g.status === 'on_track' && g.months_to_target !== null) {
    out.push(`At their current surplus of ${cad(profile.surplus)} a month, they'd build a ${cad(g.target)} emergency fund in ${months1(g.months_to_target)} months.`);
  } else if (g.status === 'needs_cut' && g.monthly_cut_needed !== null) {
    out.push(`To build a ${cad(g.target)} emergency fund within ${g.cut_horizon_months} months, they'd need to free up ${cad(g.monthly_cut_needed)} a month.`);
  }
  return out.slice(0, 3);
}
