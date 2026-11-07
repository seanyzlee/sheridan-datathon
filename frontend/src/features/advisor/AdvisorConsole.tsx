import { useEffect, useRef } from 'react';
import { useAccount, useScenario, useSimAccount, useSimBank } from '../../api/hooks';
import { ErrorNote } from '../../components/ui';
import { featureOn } from '../../lib/config';
import { NO_DRAFT, PRESETS } from '../../lib/shock';
import { useScenarioState } from '../../state/scenario';
import { AccountBox, KpiRow, type AccountBoxHandle } from './AccountStrip';
import { BurnDownCard, WaterfallCard } from './Explain';
import { BreakdownCard, FlagsCard, HistoryCard } from './Customer';
import { Definitions } from './Definitions';
import { BackupPlanCard, GoalPlanCard } from './Plans';
import { BankMini, BreakingPointCard, RunwayHero, SummaryCard, SurvivalCard } from './Results';
import { ShockPanel, type ShockPanelHandle } from './ShockPanel';
import s from './advisor.module.css';

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function AdvisorConsole() {
  const { accountId, shock, target, setDraft, pendingInput } = useScenarioState();
  const account = useAccount(accountId);
  const ready = account.data?.profile.account_id === accountId ? accountId : null;
  const scenario = useScenario(ready, shock, target);
  const sim = useSimAccount(ready, shock, target);
  const bank = useSimBank(shock, target, featureOn('bank'));

  const accountBox = useRef<AccountBoxHandle>(null);
  const shockPanel = useRef<ShockPanelHandle>(null);

  // Presenter shortcuts: R random, A account box, / twist reader, 1–3 presets, 0 reset.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'r') accountBox.current?.random();
      else if (k === 'a') {
        e.preventDefault();
        accountBox.current?.focus();
      } else if (k === '/') {
        e.preventDefault();
        shockPanel.current?.focusTwist();
      } else if (k === '0') setDraft(NO_DRAFT);
      else if (['1', '2', '3'].includes(k)) setDraft(PRESETS[Number(k) - 1]!.draft);
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDraft]);

  const a = account.data;
  const sc = scenario.data?.account_id === ready ? scenario.data : undefined;
  const sm = sim.data?.account_id === ready ? sim.data : undefined;
  const recomputing = pendingInput || scenario.isFetching;

  return (
    <div className={s.page}>
      <div className={s.strip}>
        <AccountBox ref={accountBox} current={a} />
        {account.error && !a ? <ErrorNote error={account.error} /> : <KpiRow data={a} />}
      </div>

      <div className={s.twist}>
        <ShockPanel ref={shockPanel} S={a?.profile.S} busy={recomputing} />
        <div className={s.col}>
          <RunwayHero sc={sc} loading={recomputing} error={scenario.error} />
          <SurvivalCard sim={sm} sc={sc} loading={pendingInput || sim.isFetching} error={sim.error} />
        </div>
        <div className={s.col}>
          <BreakingPointCard sc={sc} loading={recomputing} />
          <SummaryCard profile={a?.profile} sc={sc} sim={sm} />
          {featureOn('bank') && <BankMini bank={bank.data} loading={pendingInput || bank.isFetching} />}
        </div>
      </div>

      <h2 className={s.sectionTitle}>Explain and plan</h2>
      <div className={s.row2}>
        <WaterfallCard sc={sc} loading={recomputing} />
        <BurnDownCard sc={sc} loading={recomputing} />
      </div>
      <div className={s.row2}>
        <GoalPlanCard sc={sc} account={a} />
        <BackupPlanCard sc={sc} account={a} loading={recomputing} />
      </div>

      <h2 className={s.sectionTitle}>Know the customer</h2>
      <div className={s.row3}>
        <HistoryCard data={a} />
        <BreakdownCard data={a} />
        <FlagsCard data={a} />
      </div>

      <Definitions />
    </div>
  );
}
