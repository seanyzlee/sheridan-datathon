import type { AccountResponse, ScenarioResponse } from '../../api/schemas';
import { Card, SkeletonBlock, Stat } from '../../components/ui';
import { cad, months1, pct, runwayPhrase } from '../../lib/format';
import s from './advisor.module.css';

export function GoalPlanCard({ sc, account }: { sc: ScenarioResponse | undefined; account: AccountResponse | undefined }) {
  if (!sc || !account) return <Card title="Goal plan"><SkeletonBlock lines={4} /></Card>;
  const g = sc.goal_plan;
  const p = account.profile;
  const progress = g.target > 0 ? Math.max(0, Math.min(1, g.current_buffer / g.target)) : 1;
  return (
    <Card title="Goal plan" tag="Emergency fund" sub={g.multiple === 6 ? '6 × S because the account has gone below zero' : '3 × S, the standard target'}>
      <p className={s.planHeadline}>
        {g.status === 'reached' && (
          <>
            Already holds the <b>{cad(g.target)}</b> target.
          </>
        )}
        {g.status === 'on_track' && g.months_to_target !== null && (
          <>
            Reach <b>{cad(g.target)}</b> in <b>{months1(g.months_to_target)} months</b> at the current surplus.
          </>
        )}
        {g.status === 'needs_cut' && g.monthly_cut_needed !== null && (
          <>
            No surplus today. Free up <b>{cad(g.monthly_cut_needed)}/month</b> to reach {cad(g.target)} in {g.cut_horizon_months} months.
          </>
        )}
      </p>
      <div className={s.progress} role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to emergency fund">
        <div style={{ width: `${progress * 100}%` }} />
      </div>
      <div className={s.planGrid}>
        <Stat label="Target" value={cad(g.target)} />
        <Stat label="Buffer B" value={cad(g.current_buffer)} />
        <Stat label="Surplus / month" value={cad(p.surplus)} />
      </div>
      <span className={s.fine}>Months to reach = (target − B) ÷ surplus. Based on today’s income and spending, not the shock.</span>
    </Card>
  );
}

export function BackupPlanCard({ sc, account, loading }: { sc: ScenarioResponse | undefined; account: AccountResponse | undefined; loading: boolean }) {
  if (!sc || !account) return <Card title="Backup plan"><SkeletonBlock lines={4} /></Card>;
  const b = sc.backup_plan;
  return (
    <Card title="Backup plan" tag="If the shock hits" busy={loading} sub="Cut flexible spending first. Bills, insurance and loans stay fixed.">
      <p className={s.planHeadline}>
        {b.status === 'not_needed' && (
          <>
            No cuts needed. They already last <b>{runwayPhrase(b.runway_after)}</b>.
          </>
        )}
        {b.status === 'cut_works' && b.cut_pct !== null && b.monthly_saving !== null && (
          <>
            Cut flexible spending by <b>{pct(b.cut_pct)}</b> ({cad(b.monthly_saving)}/month) to reach <b>{runwayPhrase(b.runway_after)}</b>.
          </>
        )}
        {b.status === 'not_enough' && (
          <>
            Flexible cuts alone aren’t enough. Even a 100% cut only reaches <b>{runwayPhrase(b.runway_after)}</b>.
          </>
        )}
        {b.status === 'buffer_gone' && <>The one-off wipes out the buffer, so spending cuts can’t add runway. They need a new buffer first.</>}
        {b.status === 'no_flexible' && <>There’s no flexible spending to cut, so the runway stays at {runwayPhrase(b.runway_after)}.</>}
      </p>
      <div className={s.planGrid}>
        <Stat label="Flexible / month" value={cad(b.flexible_monthly)} hint="Card, cash, transfers" />
        <Stat label="Cut needed" value={b.cut_pct === null ? '—' : pct(b.cut_pct)} />
        <Stat label="Target" value={`${b.target_months} months`} />
      </div>
    </Card>
  );
}
