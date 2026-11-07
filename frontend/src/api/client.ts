/**
 * The only module that talks to a data source. Every response is validated against
 * the Zod contract, so a backend drift shows up as a named error, not a broken chart.
 */
import type { z } from 'zod';
import { DATA_SOURCE, MOCK_ENGINE, REQUEST_TIMEOUT_MS } from '../lib/config';
import type { WorkerRequest, WorkerResponse } from '../mock/worker';
import * as S from './schemas';

export class ApiError extends Error {
  readonly op: string;
  readonly status: number;
  readonly code: 'not_found' | 'validation_error' | 'internal' | 'network' | 'timeout' | 'bad_response';
  readonly field?: string;

  constructor(op: string, status: number, code: ApiError['code'], message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.op = op;
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

interface RawResponse {
  status: number;
  body: unknown;
}

// ---------- mock transport: two workers so bank runs never queue behind slider updates ----------

type Lane = 'core' | 'heavy';
const workers: Partial<Record<Lane, Worker>> = {};
const pending = new Map<number, (r: RawResponse) => void>();
let nextId = 1;

function worker(lane: Lane): Worker {
  let w = workers[lane];
  if (!w) {
    w = new Worker(new URL('../mock/worker.ts', import.meta.url), { type: 'module', name: `mock-${lane}` });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resolve = pending.get(e.data.id);
      pending.delete(e.data.id);
      resolve?.({ status: e.data.status, body: e.data.body });
    };
    workers[lane] = w;
  }
  return w;
}

function mockTransport(method: string, path: string, body: unknown): Promise<RawResponse> {
  const lane: Lane = path.startsWith('/api/simulate/bank') || path.startsWith('/api/discovery') || path.startsWith('/api/time-machine') ? 'heavy' : 'core';
  const id = nextId++;
  const msg: WorkerRequest = { id, method, path, body, cfg: { engine: MOCK_ENGINE } };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker(lane).postMessage(msg);
  });
}

/** Start both workers early so the dataset is built before the first request. */
export function prewarm(): void {
  if (DATA_SOURCE === 'mock') {
    worker('core');
    worker('heavy');
  }
}

// ---------- live transport ----------

async function liveTransport(op: string, method: string, path: string, body: unknown, signal?: AbortSignal): Promise<RawResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json: unknown = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) {
      throw new ApiError(op, 0, 'timeout', `The engine took longer than ${REQUEST_TIMEOUT_MS / 1000} s to answer.`);
    }
    if (signal?.aborted) throw e;
    throw new ApiError(op, 0, 'network', 'Could not reach the engine API.');
  } finally {
    clearTimeout(timer);
  }
}

// ---------- request ----------

async function request<T>(
  op: string,
  schema: z.ZodType<T>,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const raw = DATA_SOURCE === 'mock' ? await mockTransport(method, path, body) : await liveTransport(op, method, path, body, signal);

  if (raw.status < 200 || raw.status >= 300) {
    const parsed = S.ErrorBodySchema.safeParse(raw.body);
    if (parsed.success) {
      const e = parsed.data.error;
      throw new ApiError(op, raw.status, e.code, e.message, e.field);
    }
    throw new ApiError(op, raw.status, 'internal', `${op} failed with HTTP ${raw.status}`);
  }

  const parsed = schema.safeParse(raw.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || '(root)';
    throw new ApiError(op, raw.status, 'bad_response', `${op}: response field "${field}" ${issue?.message ?? 'is invalid'}`, field);
  }
  return parsed.data;
}

// ---------- one typed function per contract operation ----------

export const api = {
  health: (signal?: AbortSignal) => request('health', S.HealthSchema, 'GET', '/api/health', undefined, signal),
  randomAccount: (signal?: AbortSignal) => request('randomAccount', S.RandomAccountSchema, 'GET', '/api/accounts/random', undefined, signal),
  account: (id: number, signal?: AbortSignal) => request('account', S.AccountResponseSchema, 'GET', `/api/accounts/${id}`, undefined, signal),
  scenario: (req: S.ScenarioRequest, signal?: AbortSignal) => request('scenario', S.ScenarioResponseSchema, 'POST', '/api/scenario', req, signal),
  simulateAccount: (req: S.SimAccountRequest, signal?: AbortSignal) =>
    request('simulateAccount', S.SimAccountResponseSchema, 'POST', '/api/simulate/account', req, signal),
  simulateBank: (req: S.SimBankRequest, signal?: AbortSignal) => request('simulateBank', S.SimBankResponseSchema, 'POST', '/api/simulate/bank', req, signal),
  finding: (signal?: AbortSignal) => request('finding', S.FindingSchema, 'GET', '/api/discovery/finding', undefined, signal),
  defaults: (signal?: AbortSignal) => request('defaults', S.DefaultsSchema, 'GET', '/api/discovery/defaults', undefined, signal),
  tipping: (signal?: AbortSignal) => request('tipping', S.TippingSchema, 'GET', '/api/discovery/tipping', undefined, signal),
  eiCap: (signal?: AbortSignal) => request('eiCap', S.EiCapSchema, 'GET', '/api/discovery/ei-cap', undefined, signal),
  benchmark: (signal?: AbortSignal) => request('benchmark', S.BenchmarkSchema, 'GET', '/api/discovery/benchmark', undefined, signal),
  timeMachineList: (signal?: AbortSignal) => request('timeMachineList', S.TimeMachineListSchema, 'GET', '/api/time-machine', undefined, signal),
  timeMachine: (id: number, signal?: AbortSignal) => request('timeMachine', S.TimeMachineReplaySchema, 'GET', `/api/time-machine/${id}`, undefined, signal),
};
