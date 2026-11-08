import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, NO_SHOCK, type Shock } from "./api";

// App-wide state: the account on screen, the shock being applied, and the data-source switches.
// It is mirrored into the URL (?account=20396&inc=55&eim=6&bills=15 ...) so any view is a shareable
// demo link. ?twist=<card text> is read once on load and parsed by the server's twist reader.
//
// Two views of the same numbers:
//   simple   - an advisor with a customer, or the customer: how long do the savings last, will
//              they make it, what to do. Three levers, plain labels, no system details.
//   advanced - a risk analyst or the judges: every lever and chart, the model's internals, the
//              data-source switches, compute times and the whole-bank drill-downs.
// The choice is remembered per browser; ?view=advanced overrides it for demo links.

export type View = "simple" | "advanced";

function readView(p: URLSearchParams): View {
  const q = p.get("view");
  if (q === "simple" || q === "advanced") return q;
  try { return localStorage.getItem("rr-view") === "advanced" ? "advanced" : "simple"; } catch { return "simple"; }
}

interface AppState {
  accountId: number;
  setAccountId: (id: number) => void;
  shock: Shock;
  setShock: (s: Shock) => void;
  patchShock: (p: Partial<Shock>) => void;
  useLive: boolean;
  setUseLive: (v: boolean) => void;
  follow: boolean;
  setFollow: (v: boolean) => void;
  cardText: string;
  setCardText: (t: string) => void;
  view: View;
  setView: (v: View) => void;
}

const Ctx = createContext<AppState | null>(null);

const KEYS = { inc: "income_factor", eim: "income_months", bills: "bills_pct", other: "spend_delta", oneoff: "one_off", oneoffs: "one_off_x_S", cap: "ei_cap_on" } as const;

function shockFromParams(p: URLSearchParams): Shock {
  const num = (k: string) => (p.has(k) && !Number.isNaN(Number(p.get(k))) ? Number(p.get(k)) : null);
  const s: Shock = { ...NO_SHOCK };
  const inc = num("inc"); if (inc != null) s.income_factor = Math.min(1, Math.max(0, inc / 100));
  const eim = num("eim"); if (eim) s.income_months = Math.round(eim);
  const bills = num("bills"); if (bills != null) s.bills_pct = Math.max(0, bills / 100);
  const other = num("other"); if (other != null) s.spend_delta = Math.max(0, other);
  const oo = num("oneoff"); if (oo != null) s.one_off = Math.max(0, oo);
  const oos = num("oneoffs"); if (oos != null) s.one_off_x_S = Math.max(0, oos);
  if (p.get("cap") === "1") s.ei_cap_on = true;
  return s;
}

function shockToParams(s: Shock, p: URLSearchParams) {
  Object.keys(KEYS).forEach((k) => p.delete(k));
  if (s.income_factor !== 1) p.set("inc", String(Math.round(s.income_factor * 100)));
  if (s.income_months) p.set("eim", String(s.income_months));
  if (s.bills_pct) p.set("bills", String(Math.round(s.bills_pct * 100)));
  if (s.spend_delta) p.set("other", String(s.spend_delta));
  if (s.one_off) p.set("oneoff", String(s.one_off));
  if (s.one_off_x_S) p.set("oneoffs", String(s.one_off_x_S));
  if (s.ei_cap_on) p.set("cap", "1");
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const initial = useRef(new URLSearchParams(window.location.search));
  const [accountId, setAccountId] = useState<number>(() => {
    const a = Number(initial.current.get("account"));
    return Number.isInteger(a) && a > 0 ? a : 20111;
  });
  const [shock, setShock] = useState<Shock>(() => shockFromParams(initial.current));
  const [useLive, setUseLive] = useState(true);
  const [follow, setFollow] = useState(false);
  const [cardText, setCardText] = useState(() => initial.current.get("twist") ?? "");
  const [view, setViewState] = useState<View>(() => readView(initial.current));
  const setView = (v: View) => {
    setViewState(v);
    try { localStorage.setItem("rr-view", v); } catch { /* private window: the choice lasts this visit */ }
  };

  // ?twist= applies a twist card once, on first load
  useEffect(() => {
    const text = initial.current.get("twist");
    if (!text) return;
    api.parseTwist(text).then((r) => { if (r.understood) setShock(r.shock); }).catch(() => undefined);
  }, []);

  // Mirror state into the URL without adding history entries
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set("account", String(accountId));
    p.delete("twist");
    if (view === "advanced") p.set("view", "advanced"); else p.delete("view");
    shockToParams(shock, p);
    const next = `${window.location.pathname}?${p.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [accountId, shock, view]);

  const value = useMemo<AppState>(() => ({
    accountId, setAccountId, shock, setShock,
    patchShock: (p) => setShock((s) => ({ ...s, ...p })),
    useLive, setUseLive, follow, setFollow, cardText, setCardText, view, setView,
  }), [accountId, shock, useLive, follow, cardText, view]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState outside AppStateProvider");
  return v;
}

/** True in the advanced view. */
export function useAdvanced(): boolean {
  return useAppState().view === "advanced";
}

/** The value, held back until it stops changing for `ms` (slider drags send one request, not fifty). */
export function useDebounced<T>(value: T, ms = 140): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function targetFor(s: Shock): number {
  return s.income_months || 6;
}
