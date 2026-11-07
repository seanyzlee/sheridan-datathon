import { handle, warm, type MockConfig } from './router';

export interface WorkerRequest {
  id: number;
  method: string;
  path: string;
  body: unknown;
  cfg: MockConfig;
}

export interface WorkerResponse {
  id: number;
  status: number;
  body: unknown;
}

// Typed narrowly so the app can keep the DOM lib without pulling in the WebWorker lib.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};
warm();

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, method, path, body, cfg } = e.data;
  let res: WorkerResponse;
  try {
    const out = handle(method, path, body, cfg);
    res = { id, status: out.status, body: out.body };
  } catch (err) {
    res = { id, status: 500, body: { error: { code: 'internal', message: String(err) } } };
  }
  ctx.postMessage(res);
};
