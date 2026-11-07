import { useHealth } from '../api/hooks';
import { Badge } from '../components/ui';
import { AdvisorConsole } from '../features/advisor/AdvisorConsole';
import { BankTab } from '../features/bank/BankTab';
import { DiscoveryTab } from '../features/discovery/DiscoveryTab';
import { DATA_SOURCE } from '../lib/config';
import { useScenarioState, type Tab } from '../state/scenario';
import s from './shell.module.css';

const TABS: { id: Tab; label: string }[] = [
  { id: 'advisor', label: 'Advisor Console' },
  { id: 'bank', label: 'Bank' },
  { id: 'discovery', label: 'Discovery' },
];

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="17.5" r="12.5" fill="#EA7024" />
      <path d="M16 5.5c1.6-3.2 5.6-3.9 8-2-2 2.3-5 3.3-8 2z" fill="#175235" />
      <path d="M9.5 17.5a6.5 6.5 0 0 1 6.5-6.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity="0.85" />
    </svg>
  );
}

/** Mode badge: C++, NumPy fallback, JS mock, or offline (Req: never hide the fallback). */
function EngineBadge() {
  const h = useHealth();
  if (h.isError) return <Badge tone="bad" dot title="The health check failed. The last results stay on screen.">Engine offline</Badge>;
  if (!h.data) return <Badge dot>Connecting…</Badge>;
  const { engine, threads } = h.data;
  if (engine === 'cpp') return <Badge tone="good" dot title="resil_hpc C++ core with OpenMP">C++ core · {threads} threads</Badge>;
  if (engine === 'numpy') return <Badge tone="warn" dot title="resil_hpc failed to import; sim_numpy is serving simulations">NumPy mode</Badge>;
  return <Badge dot title="In-browser JavaScript mock of the simulation">JS mock engine</Badge>;
}

export function App() {
  const { tab, setTab } = useScenarioState();
  return (
    <>
      <header className={s.header}>
        <div className={s.headerInner}>
          <div className={s.brand}>
            <Logo />
            <div>
              <div className={s.brandName}>Resilience Rewired</div>
              <div className={s.brandSub}>Tangerine track · Sheridan Datathon 2026</div>
            </div>
          </div>
          <nav className={s.tabs} role="tablist" aria-label="Views">
            {TABS.map((t) => (
              <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} className={s.tab} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className={s.status}>
            {DATA_SOURCE === 'mock' ? (
              <Badge tone="accent" title="Synthetic accounts generated in the browser. Set VITE_DATA_SOURCE=live to use the FastAPI engine.">
                Mock data
              </Badge>
            ) : (
              <Badge tone="neutral" title="Data from the FastAPI engine">Live API</Badge>
            )}
            <EngineBadge />
          </div>
        </div>
      </header>
      <main className={s.main}>
        {/* Panels stay mounted so charts and state survive tab switches. */}
        {TABS.map((t) => (
          <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id}>
            {t.id === 'advisor' && <AdvisorConsole />}
            {t.id === 'bank' && tab === 'bank' && <BankTab />}
            {t.id === 'discovery' && tab === 'discovery' && <DiscoveryTab />}
          </div>
        ))}
      </main>
      <footer className={s.footer}>
        Runway uses the judges’ formula and is always the headline number. Simulation results add to it. Data: PKDD’99 Financial dataset (CTU Prague), EI maximum from canada.ca.
      </footer>
    </>
  );
}
