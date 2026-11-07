import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SIM } from '../lib/config';
import { api } from './client';
import type { Shock } from './schemas';


export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useAccount(id: number | null) {
  return useQuery({
    queryKey: ['account', id],
    queryFn: ({ signal }) => api.account(id!, signal),
    enabled: id !== null,
    staleTime: Infinity,
    retry: false,
  });
}

export function useScenario(id: number | null, shock: Shock | null, target: number) {
  return useQuery({
    queryKey: ['scenario', id, shock, target],
    queryFn: ({ signal }) => api.scenario({ account_id: id!, shock: shock!, target_months: target }, signal),
    enabled: id !== null && shock !== null,
    // Keep the previous result on screen while a new one loads, but only for the same account.
    placeholderData: (prev) => (prev?.account_id === id ? prev : undefined),
    staleTime: Infinity,
    retry: false,
  });
}

export function useSimAccount(id: number | null, shock: Shock | null, target: number) {
  return useQuery({
    queryKey: ['simAccount', id, shock, target],
    queryFn: ({ signal }) =>
      api.simulateAccount(
        { account_id: id!, shock: shock!, n_paths: SIM.accountPaths, months: SIM.months, seed: SIM.seed, target_months: target },
        signal,
      ),
    enabled: id !== null && shock !== null,
    placeholderData: (prev) => (prev?.account_id === id ? prev : undefined),
    staleTime: Infinity,
    retry: false,
  });
}

export function useSimBank(shock: Shock | null, target: number, enabled = true) {
  return useQuery({
    queryKey: ['simBank', shock, target],
    queryFn: ({ signal }) =>
      api.simulateBank({ shock: shock!, n_paths: SIM.bankPaths, months: SIM.months, seed: SIM.seed, target_months: target }, signal),
    enabled: enabled && shock !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
}

const forever = { staleTime: Infinity, retry: false } as const;
export const useFinding = () => useQuery({ queryKey: ['finding'], queryFn: ({ signal }) => api.finding(signal), ...forever });
export const useDefaults = () => useQuery({ queryKey: ['defaults'], queryFn: ({ signal }) => api.defaults(signal), ...forever });
export const useTipping = () => useQuery({ queryKey: ['tipping'], queryFn: ({ signal }) => api.tipping(signal), ...forever });
export const useEiCap = () => useQuery({ queryKey: ['eiCap'], queryFn: ({ signal }) => api.eiCap(signal), ...forever });
export const useBenchmark = () => useQuery({ queryKey: ['benchmark'], queryFn: ({ signal }) => api.benchmark(signal), ...forever });
export const useTimeMachineList = (enabled: boolean) =>
  useQuery({ queryKey: ['tmList'], queryFn: ({ signal }) => api.timeMachineList(signal), enabled, ...forever });
export const useTimeMachine = (id: number | null) =>
  useQuery({ queryKey: ['tm', id], queryFn: ({ signal }) => api.timeMachine(id!, signal), enabled: id !== null, ...forever });
