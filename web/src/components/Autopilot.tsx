import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, NO_SHOCK, type Shock } from "../api";
import { isNoShock } from "../format";
import { gsap, reducedMotion, useGSAP } from "../motion";
import { useAdvanced, useAppState, useDebounced } from "../state";
import { AnimatedNumber } from "./AnimatedNumber";
import { ErrorNote } from "./ui";
import { Staircase } from "../charts/Staircase";

// Shock Autopilot: notices an income drop in the customer's own months, then turns a shock into a ranked
// recovery plan. Each step is a real spending category, priced from their last 12 months; switching steps
// on and off re-runs the engine, and the runway meter animates to the new figure. Every figure shown here
// comes from /api/customer/{id}/autopilot; this file only formats, lays out and animates it.

const EI: Shock = { ...NO_SHOCK, income_factor: 0.55, income_months: 6 };
const BIG_BILL: Shock = { ...NO_SHOCK, one_off_x_S: 1 };
const pct = (p: number) => `${Math.round(p * 100)}%`;
const mo = (m: number) => (m >= 120 ? "120+" : m.toFixed(1));

/** Runway as distance along a track, against the target. The scale is layout only (how much track to show). */
function Meter({ before, after, target, reached }: { before: number; after: number; target: number; reached: boolean }) {
  const scale = Math.max(target * 1.6, Math.min(24, Math.max(before, after) * 1.1), 6);
  const frac = (m: number) => Math.min(1, m / scale);
  const fill = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (!fill.current) return;
    gsap.to(fill.current, { scaleX: Math.max(0.002, frac(after)), duration: reducedMotion() ? 0 : 0.8, ease: "power3.out" });
  }, { dependencies: [after, scale] });
  return (
    <div className={`ap-meter${reached ? " reached" : ""}`} role="img"
         aria-label={`Savings last ${mo(after)} months against a ${target}-month target${after !== before ? `, up from ${mo(before)}` : ""}.`}>
      <div className="ap-meter-track">
        <div className="ap-meter-before" style={{ transform: `scaleX(${frac(before)})` }} />
        <div className="ap-meter-fill" ref={fill} style={{ transform: "scaleX(0.002)" }} />
        <div className="ap-meter-target" style={{ left: `${frac(target) * 100}%` }}>
          <span>{reached ? "✓ " : ""}{target} months</span>
        </div>
      </div>
      <div className="ap-meter-scale" aria-hidden><span>Now</span><span>{Math.round(scale)} months</span></div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="ap ap-skeleton" role="status" aria-label="Loading the recovery plan">
      <div className="ap-grid">
        <div className="ap-plan">{[0, 1, 2].map((i) => <div key={i} className="sk sk-row" />)}</div>
        <div className="ap-result"><div className="sk sk-big" /><div className="sk sk-bar" /><div className="sk sk-row" /></div>
      </div>
    </div>
  );
}

export function Autopilot() {
  const { accountId, shock, setShock, useLive } = useAppState();
  const advanced = useAdvanced();
  const s = useDebounced(shock, 150);
  const [chosen, setChosen] = useState<string[]>([]);
  const steps = useDebounced(chosen, 120);
  useEffect(() => setChosen([]), [accountId, JSON.stringify(s)]);

  const q = useQuery({
    queryKey: ["autopilot", accountId, s, steps, useLive],
    queryFn: () => api.autopilot(accountId, s, steps, useLive),
    placeholderData: keepPreviousData,
  });
  const root = useRef<HTMLDivElement>(null);
  const hasShock = !isNoShock(s);
  const d = q.data;
  const res = d?.result;
  const reached = !!res?.makes_it;

  // Steps slide in one after another whenever a new plan arrives.
  useGSAP(() => {
    if (reducedMotion()) return;
    const items = root.current?.querySelectorAll(".ap-step");
    if (items?.length) gsap.fromTo(items, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, stagger: 0.07, duration: 0.45, clearProps: "transform" });
  }, { scope: root, dependencies: [accountId, hasShock, d?.ladder.length] });

  // A calm moment when the chosen steps first reach the target: a soft glow and the verdict settling in.
  const wasReached = useRef<boolean | null>(null);
  useGSAP(() => {
    const prev = wasReached.current;
    wasReached.current = reached;
    if (prev !== false || !reached || reducedMotion() || !root.current) return;
    const tl = gsap.timeline();
    tl.fromTo(".ap-glow", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: "power2.out" })
      .to(".ap-glow", { autoAlpha: 0, duration: 0.9, ease: "power2.inOut" }, "+=0.15")
      .fromTo(".ap-verdict", { scale: 0.97, autoAlpha: 0.4 }, { scale: 1, autoAlpha: 1, duration: 0.5, ease: "back.out(1.6)" }, 0.1)
      .fromTo(".ap-meter-target span", { y: 4 }, { y: 0, duration: 0.4 }, 0.1);
  }, { scope: root, dependencies: [reached, accountId, JSON.stringify(s)] });
  useEffect(() => { wasReached.current = null; }, [accountId, JSON.stringify(s)]);

  if (q.isError && !d) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  if (!d || !res) return <Skeleton />;
  const det = d.detection;
  const toggle = (id: string, on: boolean) => setChosen((c) => (on ? [...c, id] : c.filter((x) => x !== id)));
  const all = d.ladder.length > 0 && chosen.length === d.ladder.length;

  return (
    <div ref={root} className={`ap${q.isPlaceholderData ? " stale" : ""}`} aria-busy={q.isFetching}>
      {det.detected && (
        <div className="ap-alert" role="status">
          <span className="ap-alert-icon" aria-hidden>!</span>
          <div className="ap-alert-text">
            <strong>{advanced ? "Income shock detected" : "We noticed income dropped"}</strong>
            <p>{det.message}</p>
          </div>
          {!hasShock && det.suggested_shock && (
            <button type="button" className="btn btn-primary" onClick={() => setShock(det.suggested_shock!)}>Make a plan for it</button>
          )}
        </div>
      )}

      {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}

      {!hasShock ? (
        <div className="ap-start">
          <div>
            <h3>{advanced ? "Start a stress test" : det.detected ? "Or try another situation" : "What if income stopped tomorrow?"}</h3>
            <p>{det.detected
              ? "See how long savings would last and which steps would help most."
              : `No income drop in ${det.month ?? "the latest month"}. Pick a situation to see how long savings would last and what would help most.`}</p>
          </div>
          <div className="ap-start-btns">
            <button type="button" className={`btn${det.detected ? "" : " btn-primary"}`} onClick={() => setShock(EI)}>Job loss, EI for 6 months</button>
            <button type="button" className="btn" onClick={() => setShock(BIG_BILL)}>A surprise bill (a month's spending)</button>
          </div>
        </div>
      ) : (
        <div className="ap-grid">
          <div className="ap-plan">
            <div className="ap-plan-head">
              <div>
                <h3>{advanced ? "Recovery ladder" : "Steps that stretch the savings"}</h3>
                <p className="ap-plan-sub">{advanced ? "Ranked, easiest first. Switch steps on to re-run the engine." : "Easiest first. Switch a step on to see what it adds."}</p>
              </div>
              {d.ladder.length > 0 && (
                <div className="btn-row">
                  <button type="button" className="btn btn-quiet" onClick={() => setChosen(d.ladder.map((r) => r.id))} disabled={all}>Take every step</button>
                  <button type="button" className="btn btn-quiet" onClick={() => setChosen([])} disabled={!chosen.length}>Clear</button>
                </div>
              )}
            </div>
            {d.ladder.length === 0 ? (
              <p className="ap-empty">There's no flexible spending to trim in the last 12 months. A payment plan or a deferral is the next conversation to have.</p>
            ) : (
              <ol className="ap-steps">
                {d.ladder.map((r, i) => {
                  const on = chosen.includes(r.id);
                  return (
                    <li key={r.id}>
                      <label className={`ap-step${on ? " on" : ""}`}>
                        <span className="ap-step-n" aria-hidden>{on ? "✓" : i + 1}</span>
                        <span className="ap-step-body">
                          <span className="ap-step-title">{r.label}</span>
                          <span className="ap-step-detail">{r.detail} Frees up <b>{r.saving_text}</b>.</span>
                          {advanced && <span className="ap-step-run">Runway with steps 1 to {i + 1}: {r.runway_after_text}</span>}
                        </span>
                        <span className={`ap-chip${r.adds > 0 ? "" : " flat"}`}>{r.adds_text}</span>
                        <input type="checkbox" role="switch" className="ap-input" checked={on}
                               onChange={(e) => toggle(r.id, e.target.checked)}
                               aria-label={`${r.label}: ${r.adds_text}`} />
                        <span className="ap-toggle" aria-hidden />
                      </label>
                    </li>
                  );
                })}
              </ol>
            )}
            {d.ladder.length > 0 && <Staircase steps={d.ladder} chosen={chosen} target={res.target} />}
            {advanced && <p className="console-hint ap-foot">Months added assume the steps are taken in this order; each step's saving is the median of that spending over their last 12 months.</p>}
            <div className="ap-mini" aria-hidden>
              <span>Savings last</span>
              <strong>{res.after.text}</strong>
              <span className={reached ? "ok" : "short"}>{reached ? `✓ ${res.target} months reached` : `goal ${res.target} months`}</span>
            </div>
          </div>

          <div className={`ap-result${reached ? " reached" : ""}`}>
            <div className="ap-glow" aria-hidden />
            <span className="ap-label">{chosen.length ? "With these steps, savings last" : "If this happens, savings last"}</span>
            <div className="ap-big" aria-live="polite">
              <AnimatedNumber value={res.after.months} format={mo} text={mo(res.after.months)} />
              <span className="ap-unit">months</span>
            </div>
            <span className="ap-was">{chosen.length > 0 && res.after.months !== res.before.months ? `up from ${res.before.text} with no steps` : " "}</span>
            <Meter before={res.before.months} after={res.after.months} target={res.target} reached={reached} />
            <div className="ap-odds">
              <div>
                <span className="ap-label">Chance of lasting {res.target} months</span>
                <strong><AnimatedNumber value={res.after.survival * 100} format={(n) => `${Math.round(n)}%`} text={pct(res.after.survival)} /></strong>
                <span className="ap-was">{chosen.length > 0 ? `was ${pct(res.before.survival)}` : " "}</span>
              </div>
              <div>
                <span className="ap-label">Freed up</span>
                <strong>{chosen.length ? res.saving_text : "$0 a month"}</strong>
                <span className="ap-was">{chosen.length ? `${chosen.length} of ${d.ladder.length} steps on` : "no steps on yet"}</span>
              </div>
            </div>
            <p className={`ap-verdict ${reached ? "ok" : "short"}`}>
              <span className="ap-verdict-icon" aria-hidden>{reached ? "✓" : "!"}</span>
              <span>{res.verdict}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
