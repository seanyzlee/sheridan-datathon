import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, NO_SHOCK, type ParsedTwist, type Shock } from "../api";
import { describeShock, isNoShock, money, pct } from "../format";
import { useAdvanced, useAppState } from "../state";
import { Switch } from "./ui";

const PRESET_LABELS: Record<string, string> = {
  ei_6m: "EI at 55% for 6 months",
  one_month: "One-off cost of a month's spending",
  ei_bills: "EI at 55%, bills up 15%",
};

const PARSED_LABELS: Record<string, (v: number | boolean) => string> = {
  income_factor: (v) => `Income ${pct(v as number)} of normal`,
  income_months: (v) => `For ${v} months`,
  bills_pct: (v) => `Bills up ${pct(v as number)}`,
  spend_delta: (v) => `Other costs up ${money(v as number)} a month`,
  one_off: (v) => `One-off cost ${money(v as number)}`,
  one_off_x_S: (v) => `One-off of ${v} × a month's spending`,
  ei_cap_on: () => "EI weekly maximum applied",
};

const COLLAPSE_KEY = "rr-console-collapsed";

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
}

/**
 * Desktop only: the console folds to a slim rail so the page gets the full width. The choice is kept in
 * localStorage and mirrored on <html data-console="collapsed">, which styles.css uses to narrow the grid.
 */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    const root = document.documentElement;
    if (collapsed) root.dataset.console = "collapsed"; else delete root.dataset.console;
    try { if (collapsed) localStorage.setItem(COLLAPSE_KEY, "1"); else localStorage.removeItem(COLLAPSE_KEY); } catch { /* private window */ }
    // Charts size themselves from their container; tell them the layout changed.
    const t = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => window.clearTimeout(t);
  }, [collapsed]);
  useEffect(() => () => { delete document.documentElement.dataset.console; }, []);
  return [collapsed, setCollapsed] as const;
}

function sameShock(a: Shock, b: Shock) {
  return a.income_factor === b.income_factor && (a.income_months || null) === (b.income_months || null) && a.bills_pct === b.bills_pct
    && a.spend_delta === b.spend_delta && a.one_off === b.one_off && a.one_off_x_S === b.one_off_x_S && a.ei_cap_on === b.ei_cap_on;
}

function Slider({ id, label, value, min, max, step, format, onChange, help, base }: {
  id: string; label: string; value: number; min: number; max: number; step: number; format: (v: number) => string;
  onChange: (v: number) => void; help?: string; base: number;
}) {
  return (
    <div className="field">
      <div className="field-top">
        <label htmlFor={id}>{label}</label>
        <span className={`field-value${value !== base ? " changed" : ""}`}>{format(value)}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={format(value)} />
      {help && <span className="field-help">{help}</span>}
    </div>
  );
}

function MoneyInput({ id, label, value, onChange, step, help }: { id: string; label: string; value: number; onChange: (v: number) => void; step: number; help?: string }) {
  return (
    <div className="field">
      <div className="field-top"><label htmlFor={id}>{label}</label></div>
      <div className="input-prefix">
        <span aria-hidden>$</span>
        <input id={id} name={id} className="input" type="number" inputMode="decimal" min={0} step={step} value={value || ""} placeholder="0"
               autoComplete="off"
               onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
      </div>
      {help && <span className="field-help">{help}</span>}
    </div>
  );
}

export function ShockConsole() {
  const { shock, setShock, patchShock, cardText, setCardText } = useAppState();
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, staleTime: 30_000 });
  const [parsed, setParsed] = useState<ParsedTwist | null>(null);
  const [open, setOpen] = useState(false);
  const read = useMutation({ mutationFn: api.parseTwist, onSuccess: setParsed });
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useCollapsed();
  const railRef = useRef<HTMLButtonElement>(null);
  const foldRef = useRef<HTMLButtonElement>(null);
  const userFolded = useRef(false);
  // Keep keyboard focus on the control that replaces the one just pressed.
  useEffect(() => {
    if (!userFolded.current) return;
    (collapsed ? railRef : foldRef).current?.focus();
  }, [collapsed]);
  const fold = (v: boolean) => { userFolded.current = true; setCollapsed(v); };

  const presets = status.data?.presets ?? {};
  const eiMax = status.data?.ei_weekly_max ?? 729;
  const advanced = useAdvanced();
  // Levers the simple view hides; if a preset or card set one, say so rather than hide it silently.
  const hidden = [
    shock.bills_pct ? `bills up ${pct(shock.bills_pct)}` : null,
    shock.spend_delta ? `other costs up ${money(shock.spend_delta)} a month` : null,
    shock.one_off_x_S ? `a one-off of ${shock.one_off_x_S} × a month's spending` : null,
    shock.ei_cap_on ? "the EI weekly maximum" : null,
  ].filter(Boolean) as string[];

  return (
    <aside className={`console${open ? " open" : ""}${collapsed ? " collapsed" : ""}`} aria-label="Shock controls"
           onKeyDown={(e) => { if (e.key === "Escape" && open) { setOpen(false); toggleRef.current?.focus(); } }}>
      {/* Phones and tablets only: the console folds into one line showing the current shock. */}
      <button ref={toggleRef} type="button" className="console-toggle" aria-expanded={open} aria-controls="console-body" onClick={() => setOpen((v) => !v)}>
        <span><strong>Shock</strong><span className="sr-only">:</span></span>
        <span className={`desc${isNoShock(shock) && !shock.income_months ? " none" : ""}`}>{describeShock(shock)}</span>
        <span className="console-toggle-act" aria-hidden>{open ? "Close" : "Edit"}</span>
      </button>

      {/* Desktop rail, shown only while the console is folded away. */}
      <button ref={railRef} type="button" className="console-rail" aria-expanded={false} aria-controls="console-body"
              onClick={() => fold(false)} title="Show the shock controls">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
        </svg>
        <span className="console-rail-label">Shock<span className="sr-only">: {describeShock(shock)}. Show the controls</span></span>
        {!(isNoShock(shock) && !shock.income_months) && <span className="console-rail-dot" aria-hidden />}
      </button>

      <div className="console-body" id="console-body">
        <div className="console-fold">
          <span className="console-fold-title">Shock controls</span>
          <button ref={foldRef} type="button" className="btn btn-quiet console-fold-btn" aria-expanded={true} aria-controls="console-body"
                  onClick={() => fold(true)} title="Hide the shock controls to widen the page">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            <span className="sr-only">Hide the shock controls</span>
          </button>
        </div>
        <section className="console-section" aria-labelledby="card-h">
          <div className="console-head">
            <h2 id="card-h">{advanced ? "Twist card" : "What happens?"}</h2>
            <span className="console-hint">{advanced ? "Paste the judge's card" : "In your own words"}</span>
          </div>
          <label htmlFor="card" className="sr-only">Twist card text</label>
          <textarea id="card" name="card" autoComplete="off" className="card-input" aria-describedby="card-keys" value={cardText} onChange={(e) => { setCardText(e.target.value); setParsed(null); }}
                    placeholder="Lost their job: EI at 55% for 6 months, and bills up 15%…"
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && cardText.trim()) read.mutate(cardText); }} />
          <span id="card-keys" className="sr-only">Press Control and Enter to read it.</span>
          <div className="btn-row">
            <button type="button" className="btn" disabled={!cardText.trim() || read.isPending} onClick={() => read.mutate(cardText)}>
              {read.isPending ? "Reading…" : advanced ? "Read card" : "Read it"}
            </button>
            <button type="button" className="btn btn-primary" disabled={!parsed?.understood}
                    onClick={() => parsed && setShock(parsed.shock)}>{advanced ? "Apply shock" : "Show the effect"}</button>
          </div>
          {/* One live region that stays mounted, so screen readers announce what the reader found. */}
          <div aria-live="polite" className="parsed-live">
          {read.isError && <div className="parsed miss">The reader isn't reachable. Set the sliders by hand.</div>}
          {parsed && (parsed.understood ? (
            <div className="parsed">
              <span>{parsed.source === "gemini" ? <>Gemini read it as{advanced && parsed.model ? <span className="console-hint"> ({parsed.model})</span> : null}:</> : "The reader found:"}</span>
              <ul>{Object.entries(parsed.parsed).filter(([k, v]) => !(k === "income_factor" && v === 1)).map(([k, v]) => <li key={k}>{PARSED_LABELS[k]?.(v) ?? `${k}: ${v}`}</li>)}</ul>
              {parsed.source === "gemini" && (
                parsed.agree === true ? <span className="console-hint">The rule-based reader agrees.</span>
                : parsed.agree === false ? (
                  <span className="console-hint">
                    The rule-based reader read it differently: {parsed.rules.notes.join("; ")}.{" "}
                    <button type="button" className="btn btn-quiet" style={{ padding: 0, fontSize: "inherit" }}
                            onClick={() => setParsed({ ...parsed, ...parsed.rules, source: "rules" })}>Use that instead</button>
                  </span>
                ) : <span className="console-hint">The rule-based reader found nothing here, so this reading is Gemini's alone.</span>
              )}
              <span className="console-hint">Check it, then apply. The engine does the maths.</span>
            </div>
          ) : (
            <div className="parsed miss">No shock found in that text. Set the sliders by hand.</div>
          ))}
          </div>
        </section>

        <section className="console-section" aria-labelledby="preset-h">
          <h2 id="preset-h">{advanced ? "Example twists" : "Common situations"}</h2>
          <div className="preset-list">
            {Object.entries(presets).map(([key, s]) => {
              const on = sameShock(shock, s);
              return (
                <button key={key} type="button" className="preset" aria-pressed={on} onClick={() => setShock(on ? NO_SHOCK : s)}>
                  <span>{PRESET_LABELS[key] ?? key}</span>
                  {on && <span className="tick" aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="console-section" aria-labelledby="shock-h">
          <div className="console-head">
            <h2 id="shock-h">{advanced ? "Shock" : "Adjust"}</h2>
            <button type="button" className="btn btn-quiet" disabled={isNoShock(shock) && !shock.income_months} onClick={() => setShock(NO_SHOCK)} aria-label="Clear the shock">Clear</button>
          </div>
          <Slider id="inc" label="Income" value={Math.round(shock.income_factor * 100)} min={0} max={100} step={5} base={100}
                  format={(v) => `${v}% of normal`} onChange={(v) => patchShock({ income_factor: v / 100 })}
                  help={advanced ? "55% is the EI rate in the judges' formula." : "Employment Insurance pays about 55%."} />
          <Slider id="eim" label="EI lasts" value={shock.income_months ?? 0} min={0} max={24} step={1} base={0}
                  format={(v) => (v ? `${v} months` : "Not set")} onChange={(v) => patchShock({ income_months: v || null })}
                  help={advanced ? "Sets the target for the verdict and the simulation. The judges' runway ignores it." : "How long the lower income lasts."} />
          {advanced && <>
          <Slider id="bills" label="Bills increase" value={Math.round(shock.bills_pct * 100)} min={0} max={50} step={1} base={0}
                  format={(v) => `+${v}%`} onChange={(v) => patchShock({ bills_pct: v / 100 })} />
          <MoneyInput id="other" label="Rent or other increase, per month" value={shock.spend_delta} step={50}
                      onChange={(v) => patchShock({ spend_delta: v })} />
          </>}
          <MoneyInput id="oneoff" label="One-off cost" value={shock.one_off} step={250}
                      onChange={(v) => patchShock({ one_off: v })} help={advanced ? undefined : "A repair, a move, a bill that can't wait."} />
          {advanced ? <>
          <Slider id="oneoffs" label="One-off, in months of spending" value={shock.one_off_x_S} min={0} max={3} step={0.25} base={0}
                  format={(v) => (v ? `${v} × spending` : "None")} onChange={(v) => patchShock({ one_off_x_S: v })} />
          <Switch label={`Cap EI at $${eiMax} a week`} checked={shock.ei_cap_on} onChange={(v) => patchShock({ ei_cap_on: v })}
                  help="Off: the judges' 55% of income. On: also apply the 2026 EI weekly maximum." />
          </> : hidden.length > 0 && (
            <p className="also-applied">Also applied: {hidden.join(", ")}. Switch to the advanced view to change these.</p>
          )}
        </section>
      </div>
    </aside>
  );
}
