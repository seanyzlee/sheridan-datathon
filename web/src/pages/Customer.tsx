import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Customer as CustomerT, type Shock, type ShockResult } from "../api";
import { BurnDownChart, HistoryCharts, SpendingChart, WaterfallChart } from "../charts/CustomerCharts";
import { RunwayRuler } from "../components/RunwayRuler";
import { lazy, Suspense } from "react";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { Autopilot } from "../components/Autopilot";
import { FuturesDots } from "../charts/FuturesDots";
import { CliffMeter } from "../charts/CliffMeter";
import { MoneyFlow } from "../charts/MoneyFlow";
import { useReveal } from "../motion";
import { ChartFrame, DataTable, ErrorNote, Loading, SectionHead, Stat, Switch } from "../components/ui";
import { describeShock, isNoShock, monthLabel, money, pct, runwayFigure, signedPct } from "../format";
import { targetFor, useAdvanced, useAppState, useDebounced } from "../state";
import { usePalette } from "../theme";

function AccountBar({ customer }: { customer?: CustomerT }) {
  const { accountId, setAccountId, useLive, setUseLive, follow, setFollow } = useAppState();
  const advanced = useAdvanced();
  const [draft, setDraft] = useState(String(accountId));
  const [rolling, setRolling] = useState(false);
  useEffect(() => setDraft(String(accountId)), [accountId]);

  const commit = () => {
    const n = Number(draft.trim());
    if (Number.isInteger(n) && n > 0 && n !== accountId) setAccountId(n);
    else setDraft(String(accountId));
  };
  const random = async () => {
    setRolling(true);
    try { setAccountId((await api.randomAccount()).account_id); } finally { setRolling(false); }
  };

  return (
    <div className="page-head cust-head reveal">
      <div className="cust-title">
        <h1>{advanced ? `Account ${accountId}` : "Your money at a glance"}</h1>
        {customer ? (
          <p className="account-meta">
            {!advanced && <>Account {accountId}, </>}<strong>{customer.facts.district}</strong>, {customer.facts.region}.{" "}
            {advanced
              ? <>{customer.profile.months_of_data} months of data to {monthLabel(customer.facts.through)}{customer.profile.loan_running ? ", loan running" : ""}{customer.profile.defaulted ? ", loan in default" : ""}.</>
              : <>Based on the last {customer.profile.months_of_data} months of banking.</>}
          </p>
        ) : <p className="account-meta" aria-hidden>&nbsp;</p>}
      </div>
      <div className="account-bar">
        <label className="account-field">
          {advanced ? "Account" : "Open account"}
          <input className="input num" inputMode="numeric" value={draft} aria-label="Account ID"
                 onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
                 onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
        </label>
        <button type="button" className="btn" onClick={random} disabled={rolling}>Random account</button>
      </div>
      {advanced && <div className="toggles">
        <Switch label="Use Tiger Data" checked={useLive} onChange={setUseLive} help="Off: read everything from the local Parquet cache." />
        <Switch label="Follow live feed" checked={follow} onChange={setFollow} help="Re-reads Tiger Data every 2 seconds while replay.py streams transactions in." />
      </div>}
    </div>
  );
}

function Hero({ c, r, stale }: { c: CustomerT; r?: ShockResult; stale: boolean }) {
  const { shock } = useAppState();
  const advanced = useAdvanced();
  const target = targetFor(shock);
  const shocked = r && !isNoShock(shock);
  const targetLabel = shock.income_months ? `EI ends, month ${shock.income_months}` : `${target}-month goal`;
  return (
    <section className="hero" aria-label="Runway" style={{ opacity: stale ? 0.6 : 1, transition: "opacity 160ms" }}>
      <div className="hero-figures">
        {shocked ? (
          <>
            <div className="hero-figure">
              <span className="hero-label">{advanced ? "Runway after the shock" : "Their savings would last"}</span>
              <span className="hero-value is-shock">{runwayFigure(r.runway)}<span className="unit">months</span></span>
              {r.makes_it != null && (
                <span className={`verdict ${r.makes_it ? "yes" : "no"}`}>
                  {r.makes_it ? "✓ Lasts" : "✕ Doesn't last"} the {shock.income_months} months of EI
                </span>
              )}
            </div>
            <div className="hero-figure">
              <span className="hero-label">Chance of making {target} months</span>
              <span className="hero-secondary">{pct(r.survival.p)}</span>
              {advanced
                ? <span className="compute-note">{r.survival.n_paths.toLocaleString("en-CA")} futures in {r.survival.ms.toFixed(0)} ms, {r.survival.backend}</span>
                : <span className="compute-note">out of {r.survival.n_paths.toLocaleString("en-CA")} possible futures</span>}
            </div>
            <div className="hero-figure">
              <span className="hero-label">Today</span>
              <span className="hero-secondary">{runwayFigure(c.runway_base)}<span className="unit">months</span></span>
            </div>
          </>
        ) : (
          <div className="hero-figure">
            <span className="hero-label">{advanced ? "Runway today, with no shock" : "Their savings would last, if nothing changes"}</span>
            <span className="hero-value is-today">{runwayFigure(c.runway_base)}<span className="unit">months</span></span>
          </div>
        )}
      </div>
      <RunwayRuler today={c.runway_base} after={shocked ? r.runway : null} target={target} targetLabel={targetLabel}
                   afterLabel={advanced ? "After the shock" : "If this happens"} />
    </section>
  );
}

function Position({ c }: { c: CustomerT }) {
  const p = c.profile;
  const advanced = useAdvanced();
  if (!advanced) {
    const rw = c.runway_base;
    const open = rw.no_shortfall || rw.months >= 120;
    return (
      <div className="glance reveal" aria-label="Their money at a glance">
        <div className="glance-tile">
          <span className="glance-label">Money coming in</span>
          <AnimatedNumber className="glance-value" value={p.I} format={money} text={money(p.I)} />
          <span className="glance-sub">in a typical month</span>
        </div>
        <div className="glance-tile">
          <span className="glance-label">Bills you can't skip</span>
          <AnimatedNumber className="glance-value" value={p.F} format={money} text={money(p.F)} />
          <span className="glance-sub">bills, insurance and loan</span>
        </div>
        <div className="glance-tile">
          <span className="glance-label">Savings to fall back on</span>
          <AnimatedNumber className="glance-value" value={p.B} format={money} text={money(p.B)} />
          <span className="glance-sub">{p.surplus >= 0 ? `${money(p.surplus)} a month left over` : `${money(-p.surplus)} a month more goes out`}</span>
        </div>
        <div className="glance-tile accent">
          <span className="glance-label">How long savings last</span>
          <span className="glance-value">
            {open ? "120+" : <AnimatedNumber value={rw.months} format={(n) => n.toFixed(1)} text={rw.months.toFixed(1)} />}
            <span className="glance-unit"> months</span>
          </span>
          <span className="glance-sub">{open ? "income covers spending" : "if nothing changes"}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="stats" aria-label="Their position today">
      <Stat label="Income" abbr="I" value={money(p.I)} sub="median a month" title="Median monthly money in" />
      <Stat label="Spending" abbr="S" value={money(p.S)} sub={p.surplus >= 0 ? `${money(p.surplus)} left over` : `${money(-p.surplus)} short each month`}
            subTone={p.surplus < 0 ? "bad" : undefined} title="Median monthly money out" />
      <Stat label="Fixed costs" abbr="F" value={money(p.F)} sub="bills, insurance, loan" title="Median of household bills + insurance + loan payments, summed per month first" />
      <Stat label="Buffer" abbr="B" value={money(p.B)} sub="average balance, last 6 months" title="Mean average daily balance over the last 6 months" />
      <Stat label="Loan payment" abbr="P" value={p.loan_running ? money(p.P) : "None"} sub={p.loan_running ? "still running in Dec 2025" : undefined} title="Monthly loan payment if the loan runs past Dec 2025" />
    </div>
  );
}

/** The rule-based summary, plus an on-demand rewording by Gemini for talking to the customer.
 *  Gemini only sees numbers the engine produced, and the server rejects any reply with other figures. */
function AdvisorSummary({ summary, accountId, shock, live }: { summary: string; accountId: number; shock: Shock; live: boolean }) {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, staleTime: 30_000 });
  const advanced = useAdvanced();
  const [ask, setAsk] = useState(false);
  const key = JSON.stringify([accountId, shock, live]);
  useEffect(() => setAsk(false), [key]);
  const note = useQuery({ queryKey: ["note", key], queryFn: () => api.note(accountId, shock, live), enabled: ask, staleTime: Infinity, retry: 0 });
  const body = (
    <>
      <p className="summary" aria-live="polite">{summary}</p>
      {status.data?.gemini && !ask && (
        <button type="button" className="btn fit" onClick={() => setAsk(true)}>Say it for the customer</button>
      )}
      {ask && (note.isLoading ? <Loading what="a plain-language version" /> : note.data && (
        note.data.source === "gemini" ? (
          <div className="customer-note" aria-live="polite">
            <p>{note.data.text}</p>
            <span className="console-hint">Written by Gemini{advanced && note.data.model ? ` (${note.data.model})` : ""} from the numbers above. Every figure is checked against the engine.</span>
          </div>
        ) : <span className="console-hint">Gemini isn't available right now, so the summary above is the one to use.</span>
      ))}
    </>
  );
  if (advanced) return <div className="advisor">{body}</div>;
  // Simple view: the plan above already says what to do, so the long summary folds away for the advisor.
  return (
    <details className="advisor-fold">
      <summary>Read the advisor's summary</summary>
      <div className="advisor">{body}</div>
    </details>
  );
}

function Plans({ c, r, goalOnly = false }: { c: CustomerT; r?: ShockResult; goalOnly?: boolean }) {
  const g = c.goal;
  const b = r?.backup;
  return (
    <div className={goalOnly ? "plans-single" : "grid-2"}>
      <div className="panel">
        <h3>Build an emergency fund</h3>
        <p>Target <strong>{money(g.target)}</strong>, {g.reason}. They have {money(c.profile.B)} now.</p>
        {g.months_to_target === 0 ? (
          <div className="callout good">Already there.</div>
        ) : g.months_to_target != null ? (
          <p>Saving their usual surplus of {money(c.profile.surplus)} a month gets there in <strong className="panel-big">{g.months_to_target.toFixed(1)} months</strong>.</p>
        ) : (
          <p>They have no surplus today. Cutting <strong>{money(g.monthly_cut_needed)} a month</strong>
            {g.cut_pct_of_flexible != null ? ` (${pct(g.cut_pct_of_flexible)} of flexible spending)` : ""} gets there in 12 months.</p>
        )}
      </div>
      {!goalOnly && (
      <div className="panel">
        <h3>If the shock hits</h3>
        {!b ? (
          <p>Apply a shock to see what they'd need to cut.</p>
        ) : b.already_ok ? (
          <div className="callout good">No cuts needed. Runway is already at least {b.target_months} months.</div>
        ) : b.possible && b.cut_pct != null ? (
          <p>Cut flexible spending (card, cash and other transfers) by <strong className="panel-big">{pct(b.cut_pct)}</strong>, about <strong>{money(b.cut_amount)} a month</strong> of {money(b.flexible)}.
            Runway becomes <strong>{b.new_runway.toFixed(1)} months</strong>. Bills, insurance and loans stay as they are.</p>
        ) : (
          <div className="callout warn">Cutting flexible spending alone can't reach {b.target_months} months. Talk about a payment plan, deferring the loan, or topping up their emergency fund.</div>
        )}
      </div>
      )}
    </div>
  );
}

function Peers({ c }: { c: CustomerT }) {
  const pr = c.peers;
  return (
    <div className="panel">
      <h3>Compared with similar customers</h3>
      <p>
        Their buffer covers <strong>{pr.buffer_months == null ? "more than 10 years" : `${pr.buffer_months.toFixed(1)} months`}</strong> of spending.
        That's more than <strong>{pct(pr.pct_better)}</strong> of the {pr.n_peers} customers in {pr.region} with similar income (band {pr.income_band} of 5),
        where the middle customer has {pr.peer_median_buffer_months?.toFixed(1) ?? "n/a"} months.
      </p>
    </div>
  );
}

function Flags({ c }: { c: CustomerT }) {
  const icon = { high: "!", medium: "!", ok: "✓" } as const;
  const level = { high: "Serious", medium: "Watch", ok: "Fine" } as const;
  return (
    <div className="panel">
      <h3>Warning signs</h3>
      <ul className="flags">
        {c.flags.map((f) => (
          <li key={f.text} className={`flag ${f.level}`}>
            <span className="flag-icon" aria-hidden>{icon[f.level]}</span>
            <span><span className="sr-only">{level[f.level]}: </span>{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BankStrip() {
  const { shock } = useAppState();
  const s = useDebounced(shock, 250);
  const q = useQuery({ queryKey: ["bank", s], queryFn: () => api.bank(s), placeholderData: keepPreviousData, staleTime: Infinity });
  if (!q.data) return null;
  const k = q.data.kpis;
  const change = k.under3 - k.under3_base;
  return (
    <div className="bank-strip" style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
      <Stat label="Whole bank under 3 months" value={pct(k.under3)} sub={Math.abs(change) >= 0.0005 ? `${signedPct(change)} vs no shock` : "same as with no shock"} subTone={change > 0.0005 ? "bad" : undefined} />
      <Stat label={`Expected to run out within ${q.data.target} months`} value={pct(k.expected_run_out)} />
      <span className="compute-note">
        {q.data.customers.toLocaleString("en-CA")} customers × {q.data.paths.toLocaleString("en-CA")} futures × {q.data.months} months in {q.data.seconds.toFixed(2)} s, {q.data.backend}
      </span>
      <Link to={{ pathname: "/bank", search: window.location.search }}>Open the whole-bank view</Link>
    </div>
  );
}

const Futures3D = lazy(() => import("../charts/Futures3D"));

function FuturesFrame({ r, stale, simple }: { r: ShockResult; stale: boolean; simple: boolean }) {
  const pal = usePalette();
  const rows = r.burn_down;
  return (
    <ChartFrame title={simple ? "Your balance, month by month" : "Simulated futures in 3D"}
                sub={simple ? `The orange band is where 8 in 10 of ${r.survival.n_paths.toLocaleString("en-CA")} possible futures land. Hover or tap for any month.` : `10th to 90th percentile of ${r.survival.n_paths.toLocaleString("en-CA")} futures, median tube, judges' line, and $0. Hover for any month.`}
                legend={[{ label: "Most likely", color: pal.shock, shape: "line" }, { label: "8 in 10 futures", color: pal.shockWash, shape: "band" },
                         { label: simple ? "Straight-line estimate" : "Judges' formula", color: pal.ink, shape: "line" }, { label: "$0, money runs out", color: pal.critical, shape: "rect" }]}
                stale={stale} label="3D view of the range of simulated balances over the coming months"
                table={<DataTable caption="Simulated balance by month" rows={rows} maxHeight={320} columns={[
                  { key: "m", label: "Month", align: "r", render: (d) => (d.month === 0 ? "Now" : d.month) },
                  { key: "p50", label: "Most likely", align: "r", render: (d) => money(d.p50) },
                  { key: "p10", label: "Low (10th pct)", align: "r", render: (d) => money(d.p10) },
                  { key: "p90", label: "High (90th pct)", align: "r", render: (d) => money(d.p90) },
                  { key: "b", label: simple ? "Straight-line estimate" : "Judges' formula", align: "r", render: (d) => money(d.balance) },
                ]} />}>
      <Suspense fallback={<div className="f3d"><div className="f3d-fallback"><Loading what="the 3D view" /></div></div>}>
        <Futures3D r={r} simple={simple} />
      </Suspense>
    </ChartFrame>
  );
}

export default function Customer() {
  const { accountId, shock, useLive, follow, setView } = useAppState();
  const pageRef = useRef<HTMLDivElement>(null);
  const advanced = useAdvanced();
  const s = useDebounced(shock);
  const hasShock = !isNoShock(s);

  const cust = useQuery({
    queryKey: ["customer", accountId, useLive],
    queryFn: () => api.customer(accountId, useLive),
    placeholderData: keepPreviousData,
    refetchInterval: follow ? 2000 : false,
    retry: (n, e: unknown) => (e as { status?: number })?.status !== 404 && n < 2,
  });
  const shk = useQuery({
    queryKey: ["shock", accountId, useLive, s, follow ? cust.dataUpdatedAt : 0],
    queryFn: () => api.shock(accountId, s, useLive),
    enabled: hasShock && cust.isSuccess,
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const c = cust.data;
  const r = hasShock ? shk.data : undefined;
  const staleCustomer = cust.isPlaceholderData || (cust.isFetching && !follow);
  const staleShock = shk.isPlaceholderData || s !== shock;
  const wrongAccount = cust.isError && (cust.error as { status?: number })?.status === 404;

  useEffect(() => { document.title = `Account ${accountId}, Toonie`; }, [accountId]);
  useReveal(pageRef, `${accountId}-${!!c}`);

  return (
    <div ref={pageRef} className="cust">
      <AccountBar customer={c && !wrongAccount && c.account_id === accountId ? c : undefined} />
      {cust.isError && (wrongAccount
        ? <ErrorNote error={cust.error} />
        : <ErrorNote error={cust.error} onRetry={() => cust.refetch()} />)}
      {!c && cust.isLoading && <Loading what="the customer" />}
      {c && !wrongAccount && (
        <>
          {advanced && <Hero c={c} r={r} stale={staleCustomer || (hasShock && staleShock)} />}
          <Position c={c} />

          <section className="section reveal" aria-label={advanced ? "Shock Autopilot" : "Your plan if things change"}>
            <SectionHead title={advanced ? "Shock Autopilot" : "Your plan if things change"}>
              {advanced ? "Detects an income drop in their own months, then ranks the steps that stretch the runway." : undefined}
            </SectionHead>
            <Autopilot />
          </section>

          {hasShock && <section className="section reveal" aria-label={advanced ? "What the shock does" : "Where the savings could go"}>
            <SectionHead title={advanced ? "What the shock does" : "Where the savings could go"}>
              {describeShock(s)}
            </SectionHead>
            {shk.isError ? (
              <ErrorNote error={shk.error} onRetry={() => shk.refetch()} />
            ) : !r ? (
              <Loading what="the shock" />
            ) : (
              <div className="shock-stack">
                {advanced && <AdvisorSummary summary={r.summary} accountId={accountId} shock={s} live={useLive} />}
                {advanced ? (
                  <>
                    <FuturesFrame r={r} stale={staleShock} simple={false} />
                    <div className="grid-2">
                      <BurnDownChart r={r} stale={staleShock} />
                      <WaterfallChart r={r} stale={staleShock} />
                    </div>
                    <div className="grid-2">
                      <FuturesDots r={r} stale={staleShock} />
                      <MoneyFlow r={r} stale={staleShock} />
                    </div>
                    <CliffMeter r={r} stale={staleShock} />
                  </>
                ) : (
                  <>
                    <FuturesFrame r={r} stale={staleShock} simple />
                    <div className="grid-2">
                      <FuturesDots r={r} stale={staleShock} simple />
                      <MoneyFlow r={r} stale={staleShock} simple />
                    </div>
                    <CliffMeter r={r} stale={staleShock} simple />
                    <AdvisorSummary summary={r.summary} accountId={accountId} shock={s} live={useLive} />
                  </>
                )}
              </div>
            )}
          </section>}

          <section className="section reveal" aria-label={advanced ? "Make a plan" : "Build a safety net"}>
            <SectionHead title={advanced ? "Make a plan" : "Build a safety net"} />
            <Plans c={c} r={r} goalOnly={!advanced} />
          </section>

          <section className="section reveal" aria-label={advanced ? "How they got here" : "Their everyday money"}>
            <SectionHead title={advanced ? "How they got here" : "Their everyday money"}>{advanced ? "Medians over all their months; the buffer is the last 6 months." : undefined}</SectionHead>
            {advanced ? (
              <div className="grid-3-2">
                <HistoryCharts data={c.monthly} stale={staleCustomer} />
                <SpendingChart data={c.spending} stale={staleCustomer} />
              </div>
            ) : (
              <div className="spend-simple"><SpendingChart data={c.spending} stale={staleCustomer} /></div>
            )}
            <div className="grid-2" style={{ marginTop: 32 }}>
              <Flags c={c} />
              <Peers c={c} />
            </div>
          </section>

          {!advanced && (
            <p className="advanced-hint">
              Want the month-by-month history, the breaking point and the whole bank's numbers?
              <button type="button" className="btn" onClick={() => setView("advanced")}>Switch to advanced view</button>
            </p>
          )}

          {advanced && <BankStrip />}

          {advanced && <details className="section fine">
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink-2)" }}>How each number is defined</summary>
            <dl className="defs" style={{ marginTop: 12 }}>
              <dt>I</dt><dd>median monthly money in</dd>
              <dt>S</dt><dd>median monthly money out</dd>
              <dt>F</dt><dd>median of household bills + insurance + loan payments, summed per month first</dd>
              <dt>H</dt><dd>median household bills</dd>
              <dt>B</dt><dd>mean of the average daily balance over the last 6 months</dd>
              <dt>P</dt><dd>monthly loan payment if the loan is still running in Dec 2025, else 0</dd>
              <dt>Runway</dt><dd>(B − one-off) ÷ (spending − income), where income = income factor × I and spending = S + bills % × H + other increase. 0 if the buffer is used up, 120+ with no shortfall, rounded to 0.1.</dd>
              <dt>Chance</dt><dd>from the Monte Carlo simulation (C++ core). With every random part switched off it gives exactly the judges' runway; it never replaces it.</dd>
            </dl>
          </details>}
        </>
      )}
    </div>
  );
}
