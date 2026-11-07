import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Shock } from '../api/schemas';
import { DEBOUNCE_MS } from '../lib/config';
import { useDebounced } from '../lib/hooks';
import { NO_DRAFT, toShock, targetMonths, type ShockDraft } from '../lib/shock';

export type Tab = 'advisor' | 'bank' | 'discovery';

interface ScenarioState {
  tab: Tab;
  setTab: (t: Tab) => void;
  accountId: number | null;
  setAccountId: (id: number) => void;
  draft: ShockDraft;
  setDraft: (d: ShockDraft) => void;
  /** Debounced shock, ready for the API. Shared by every tab. */
  shock: Shock;
  /** True while slider input hasn't been sent yet (inside the debounce window). */
  pendingInput: boolean;
  /** Survival / breaking-point target T in months. */
  target: number;
}

const Ctx = createContext<ScenarioState | null>(null);

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>('advisor');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ShockDraft>(NO_DRAFT);
  const debounced = useDebounced(draft, DEBOUNCE_MS);
  const shock = useMemo(() => toShock(debounced), [debounced]);

  const value: ScenarioState = {
    tab,
    setTab,
    accountId,
    setAccountId,
    draft,
    setDraft,
    shock,
    pendingInput: debounced !== draft,
    target: targetMonths(shock),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScenarioState(): ScenarioState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScenarioState must be used inside ScenarioProvider');
  return v;
}
