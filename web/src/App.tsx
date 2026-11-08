import { useIsFetching, useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { Assistant } from "./components/Assistant";
import { ShockConsole } from "./components/ShockConsole";
import { Loading } from "./components/ui";
import { gsap, reducedMotion, useGSAP } from "./motion";
import Customer from "./pages/Customer";
import { useAppState, type View } from "./state";
import { useTheme } from "./theme";

const Bank = lazy(() => import("./pages/Bank"));
const Finding = lazy(() => import("./pages/Finding"));
const TimeMachine = lazy(() => import("./pages/TimeMachine"));
const Method = lazy(() => import("./pages/Method"));

// The time machine and the method page are analyst tools, so they only appear in the advanced view.
// `short` is what phones show, so every link fits on one row at 390 px without scrolling.
const NAV: { to: string; label: string; short: string; advanced?: boolean }[] = [
  { to: "/", label: "Customer", short: "Customer" },
  { to: "/bank", label: "Whole bank", short: "Bank" },
  { to: "/finding", label: "Main finding", short: "Finding" },
  { to: "/time-machine", label: "Time machine", short: "Replay", advanced: true },
  { to: "/method", label: "How it works", short: "Method", advanced: true },
];

const TITLES: Record<string, string> = {
  "/": "Customer", "/bank": "Whole bank", "/finding": "Main finding", "/time-machine": "Time machine", "/method": "How it works",
};

/**
 * On every route change: fade the page in with a small rise (GSAP, transform and opacity only, skipped
 * under reduced motion), name the tab after the page, and, after the first load, move to the top and put
 * focus on <main> so keyboard and screen-reader users start at the new page rather than in the nav.
 */
function useRouteChange(ref: React.RefObject<HTMLElement>, focusRef: React.RefObject<HTMLElement>, pathname: string) {
  const first = useRef(true);
  useGSAP(() => {
    if (reducedMotion() || !ref.current) return;
    gsap.fromTo(ref.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.38, ease: "power2.out", clearProps: "opacity,transform" });
  }, { dependencies: [pathname], scope: ref });
  useEffect(() => {
    document.title = TITLES[pathname] ? `${TITLES[pathname]} · Toonie` : "Toonie";
    if (first.current) { first.current = false; return; }
    window.scrollTo({ top: 0 });
    focusRef.current?.focus({ preventScroll: true });
  }, [pathname, focusRef]);
}

function ViewSwitch() {
  const { view, setView } = useAppState();
  const opts: { v: View; label: string; title: string }[] = [
    { v: "simple", label: "Simple", title: "Plain-language answers: how long savings last and what to do" },
    { v: "advanced", label: "Advanced", title: "Every lever, chart and model detail, for analysts" },
  ];
  return (
    <div className="view-switch" role="group" aria-label="View">
      {opts.map((o) => (
        <button key={o.v} type="button" aria-pressed={view === o.v} title={o.title} onClick={() => setView(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

function AdvancedOnly({ children }: { children: React.ReactNode }) {
  const { view, setView } = useAppState();
  if (view === "advanced") return <>{children}</>;
  return (
    <div className="empty-shock">
      <h1 style={{ fontSize: "var(--t-xl)" }}>This page is part of the advanced view</h1>
      <p>It's built for analysts: the model's workings and month-by-month replays of past defaults.</p>
      <button type="button" className="btn btn-primary" onClick={() => setView("advanced")}>Switch to advanced view</button>
    </div>
  );
}

/** Toonie's mark: an original two-tone coin (silver ring, gold centre) carrying a rising runway line. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="mark">
      <circle cx="16" cy="16" r="15" fill="#c9ced6" stroke="#7d8590" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="9.6" fill="#e8b93a" stroke="#a8790f" strokeWidth="1.2" />
      <path d="M10.6 19.6l3.8-3.6 2.6 2.1 4.2-4.9" fill="none" stroke="#14202e" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 12.8h3.6v3.6" fill="none" stroke="#14202e" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ThemeButton() {
  const { mode, resolved, setMode } = useTheme();
  const next = mode === "system" ? (resolved === "dark" ? "light" : "dark") : mode === "dark" ? "light" : "dark";
  return (
    <button type="button" className="theme-btn" onClick={() => setMode(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {resolved === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="12" r="5" /><g stroke="currentColor" strokeWidth="2" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="12" y1="2" x2="12" y2="4" transform={`rotate(${a} 12 12)`} />)}</g></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
      )}
    </button>
  );
}

function Status() {
  const { view } = useAppState();
  const q = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 30_000, staleTime: 20_000 });
  if (!q.data || view !== "advanced") return null;
  return (
    <>
      <span className="chip hide-sm" title={q.data.live ? "Profiles read live from Tiger Data (TimescaleDB)" : "Tiger Data unreachable: using the local Parquet cache"}>
        <span className={`chip-dot${q.data.live ? " on" : ""}`} />{q.data.live ? "Tiger Data live" : "Offline cache"}
      </span>
      <span className="chip hide-sm" title="Simulation backend">
        <span className={`chip-dot${q.data.is_cpp ? " cpp" : ""}`} />{q.data.backend}
      </span>
    </>
  );
}

export default function App() {
  const { search, pathname } = useLocation();
  // The shock only drives the customer and whole-bank views; the other pages are fixed analyses.
  const showConsole = pathname === "/" || pathname === "/bank";
  const fetching = useIsFetching();
  const { view } = useAppState();
  const mainRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  useRouteChange(pageRef, mainRef, pathname);
  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); mainRef.current?.scrollIntoView(); }}>Skip to content</a>
      <header className="topbar">
        <NavLink to={{ pathname: "/", search }} className="wordmark" aria-label="Toonie, customer view">
          <Mark /><span>Toonie</span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          {NAV.filter((n) => !n.advanced || view === "advanced").map((n) => <NavLink key={n.to} to={{ pathname: n.to, search }} end={n.to === "/"}><span className="nav-full">{n.label}</span><span className="nav-short">{n.short}</span></NavLink>)}
        </nav>
        <div className="topbar-end">
          <Status />
          <ViewSwitch />
          <ThemeButton />
        </div>
      </header>
      {fetching > 0 && <div className="fetching" aria-hidden><div className="loading-bar" /></div>}
      <div className={`shell${showConsole ? "" : " no-console"}`}>
        {showConsole && <ShockConsole />}
        <main className="main" id="main" tabIndex={-1} ref={mainRef}>
          <div className="main-inner" ref={pageRef}>
            <Suspense fallback={<Loading what="the page" />}>
              <Routes>
                <Route path="/" element={<Customer />} />
                <Route path="/bank" element={<Bank />} />
                <Route path="/finding" element={<Finding />} />
                <Route path="/time-machine" element={<AdvancedOnly><TimeMachine /></AdvancedOnly>} />
                <Route path="/method" element={<AdvancedOnly><Method /></AdvancedOnly>} />
                <Route path="*" element={<div className="empty-shock"><h1 style={{ fontSize: "var(--t-xl)" }}>This page doesn't exist</h1><p>Pick a view from the bar at the top.</p></div>} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
      <Assistant />
    </>
  );
}
