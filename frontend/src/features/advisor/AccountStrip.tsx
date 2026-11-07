import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { AccountResponse } from '../../api/schemas';
import { Button, Skeleton } from '../../components/ui';
import { DATA_SOURCE } from '../../lib/config';
import { cad, runwayNumber } from '../../lib/format';
import { useTween } from '../../lib/hooks';
import { useScenarioState } from '../../state/scenario';
import s from './advisor.module.css';

export interface AccountBoxHandle {
  focus: () => void;
  random: () => void;
}

/** Account ID box + random button. A bad ID shows an error and keeps the current account. */
export const AccountBox = forwardRef<AccountBoxHandle, { current: AccountResponse | undefined }>(function AccountBox({ current }, ref) {
  const { accountId, setAccountId } = useScenarioState();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(accountId?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (accountId !== null) setText(String(accountId));
  }, [accountId]);

  async function load(id: number): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await qc.fetchQuery({ queryKey: ['account', id], queryFn: ({ signal }) => api.account(id, signal), staleTime: Infinity });
      setAccountId(id);
      history.replaceState(null, '', `#account=${id}`);
      return true;
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'not_found' ? `No account with ID ${id}.` : e instanceof Error ? e.message : 'Could not load the account.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function random() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.randomAccount();
      await load(r.account_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not pick an account.');
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!/^\d+$/.test(t)) {
      setError('Account IDs are whole numbers.');
      return;
    }
    void load(Number(t));
  }

  useImperativeHandle(ref, () => ({ focus: () => input.current?.select(), random: () => void random() }));

  // First load: account from the URL hash, otherwise a random one.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const m = location.hash.match(/account=(\d+)/);
    // If the linked account doesn't exist, keep the error visible but still show someone.
    if (m) void load(Number(m[1])).then((ok) => { if (!ok) void api.randomAccount().then((r) => qc.fetchQuery({ queryKey: ['account', r.account_id], queryFn: ({ signal }) => api.account(r.account_id, signal), staleTime: Infinity }).then(() => setAccountId(r.account_id))); });
    else void random();
  }, []);

  const p = current?.profile;
  return (
    <form className={s.accountBox} onSubmit={submit} noValidate>
      <label className={s.accountLabel} htmlFor="account-id">
        <span>Account ID</span>
        <span>
          <kbd>A</kbd> <kbd>R</kbd>
        </span>
      </label>
      <div className={s.accountRow}>
        <input
          ref={input}
          id="account-id"
          className={s.accountInput}
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={!!error}
          aria-describedby="account-msg"
          placeholder="Account ID"
        />
        <Button type="submit" variant="primary" disabled={busy}>
          Load
        </Button>
        <Button onClick={() => void random()} disabled={busy} title="Load a random account (R)">
          Random
        </Button>
      </div>
      <div id="account-msg" aria-live="polite">
        {error ? (
          <span className={s.fieldError}>{error}</span>
        ) : p ? (
          <span className={s.accountMeta}>
            {p.district_name} · {p.region} · income quintile {p.income_quintile} · {p.months_of_data} months of data
          </span>
        ) : (
          <span className={s.accountMeta}>{DATA_SOURCE === 'mock' ? 'Mock data. IDs 1–10 are edge cases.' : 'Loading…'}</span>
        )}
      </div>
    </form>
  );
});

function Kpi({ sym, label, value, hint }: { sym: string; label: string; value: string; hint: string }) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiLabel}>
        <b>{sym}</b>
        {label}
      </div>
      <div className={s.kpiValue}>{value}</div>
      <div className={s.kpiHint}>{hint}</div>
    </div>
  );
}

export function KpiRow({ data }: { data: AccountResponse | undefined }) {
  const p = data?.profile;
  const tween = useTween(p && p.runway_base.status !== 'no_shortfall' ? p.runway_base.months : 0);
  if (!p) {
    return (
      <div className={s.kpis} aria-busy>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={s.kpi}>
            <Skeleton h={12} w="60%" />
            <Skeleton h={26} w="80%" style={{ marginTop: 6 }} />
          </div>
        ))}
      </div>
    );
  }
  const r = p.runway_base;
  return (
    <div className={s.kpis}>
      <Kpi sym="I" label="Income / month" value={cad(p.I)} hint="Median money in" />
      <Kpi sym="S" label="Spending / month" value={cad(p.S)} hint={`Surplus ${cad(p.surplus)}`} />
      <Kpi sym="F" label="Fixed costs" value={cad(p.F)} hint={`Bills H ${cad(p.H)} · loan P ${cad(p.P)}`} />
      <Kpi sym="B" label="Buffer" value={cad(p.B)} hint={p.limited_history ? 'Mean of all rows (limited history)' : 'Mean balance, last 6 months'} />
      <div className={s.kpi}>
        <div className={s.kpiLabel}>Runway today (no shock)</div>
        <div className={s.kpiRunway}>
          {r.status === 'no_shortfall' ? '120+' : r.status === 'capped' ? '120' : tween.toFixed(1)}
          <small>{r.status === 'no_shortfall' ? 'no shortfall' : 'months'}</small>
        </div>
        <div className={s.kpiHint}>
          {r.status === 'no_shortfall' ? 'Income covers spending' : r.status === 'zero' ? 'No buffer left' : `Judges’ formula: ${runwayNumber(r)} months`}
        </div>
      </div>
    </div>
  );
}
