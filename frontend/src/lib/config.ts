import type { EngineMode } from '../api/schemas';

const env = import.meta.env;

export type DataSource = 'mock' | 'live';
export const DATA_SOURCE: DataSource = env.VITE_DATA_SOURCE === 'live' ? 'live' : 'mock';

const mockEngine = String(env.VITE_MOCK_ENGINE ?? 'js');
export const MOCK_ENGINE: EngineMode = mockEngine === 'cpp' || mockEngine === 'numpy' ? mockEngine : 'js';

/** Live-mode request timeout. */
export const REQUEST_TIMEOUT_MS = 5000;

/** Simulation workload the frontend asks for. The mock may run fewer bank paths and says so. */
export const SIM = {
  accountPaths: 10_000,
  bankPaths: 2_000,
  months: 24,
  seed: 42,
} as const;

export const DEBOUNCE_MS = 250;

export type Feature = 'time-machine' | 'region-map' | 'peers' | 'twist-reader' | 'bank';
const disabled = new Set(
  String(env.VITE_DISABLED_FEATURES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
export const featureOn = (f: Feature) => !disabled.has(f);
