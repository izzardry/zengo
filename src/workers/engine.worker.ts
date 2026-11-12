/// <reference lib="webworker" />
/**
 * The engine worker (DESIGN 10.1): TF.js (WebGPU or single-threaded WASM-SIMD) and the KataGo port of
 * `src/lib/engine/katago/`. Driven by `EngineDriver` (src/lib/engine/driver.ts) through the messages
 * of src/lib/engine/protocol.ts; jobs run one at a time, in order.
 *
 * - Paths: everything under `engine/` resolves against the page's `document.baseURI`, sent with
 *   `init`, so the app works under any sub-path (`base: "./"`). TF.js loads its `.wasm` from
 *   `engine/tfjs/`.
 * - Networks: read compressed from Cache Storage `engine-cache` (where the offline manager stores
 *   them), else fetched (the service worker serves `engine/` CacheFirst); inflated here with
 *   `DecompressionStream`. Progress counts compressed bytes.
 * - Backend: the remembered choice from `zigo:engine-backend`. Without one, the worker starts on
 *   WASM at once and, after the small net has loaded, probes WebGPU: adapter, then an evaluation of a
 *   fixed position compared with the WASM result. On any error or a mismatch it stays on WASM. The
 *   decision is reported (`backend`, `decided`) for the page to remember. A remembered WebGPU that
 *   fails later falls back to WASM the same way.
 */
import { getBackend, ready, setBackend } from '@tensorflow/tfjs-core';
import { KataEngine, type EngineControl, type NetKind } from '@/lib/engine/katago/engine';
import { gunzip, isGzip, parseModel, type ParsedModel } from '@/lib/engine/katago/loadModel';
import { KataModel } from '@/lib/engine/katago/model';
import { NetRunner } from '@/lib/engine/katago/net';
import { ENGINE_CACHE } from '@/lib/engine/offline';
import { NET_BYTES, NET_PATHS, TFJS_WASM_DIR, type EngineBackendChoice, type FromWorker, type ToWorker } from '@/lib/engine/protocol';
import { probePosition, sameEvaluation } from '@/lib/engine/probe';
import type { EngineEvaluation } from '@/lib/types';

declare const self: DedicatedWorkerGlobalScope;

type Active = 'webgpu' | 'wasm' | 'cpu';

let base = '';
let active: Active | null = null;
let initPromise: Promise<void> | null = null;
let probeWanted = false;
const parsed = new Map<NetKind, ParsedModel>();
const runners = new Map<NetKind, NetRunner>();
const loading = new Map<NetKind, Promise<NetRunner>>();
/** Held while the WebGPU probe switches backends. */
let backendLock: Promise<void> = Promise.resolve();

/** Leaves per network call: WebGPU gains from batches; single-threaded WASM does not. */
const batchSize = () => (active === 'webgpu' ? 8 : 1);

function post(m: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(m, transfer);
}

const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------------------------------------
 * Backends
 * --------------------------------------------------------------------------------------------- */

async function startWasm(): Promise<Active> {
  try {
    const wasm = await import('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths(new URL(TFJS_WASM_DIR, base).href);
    if (await setBackend('wasm')) {
      await ready();
      return 'wasm';
    }
  } catch {
    /* CPU below */
  }
  await import('@tensorflow/tfjs-backend-cpu');
  if (!(await setBackend('cpu'))) throw new Error('No TF.js backend could start');
  await ready();
  return 'cpu';
}

async function startWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu || !(await gpu.requestAdapter())) return false;
    await import('@tensorflow/tfjs-backend-webgpu');
    if (!(await setBackend('webgpu'))) return false;
    await ready();
    return true;
  } catch {
    return false;
  }
}

async function init(remembered: EngineBackendChoice | null): Promise<void> {
  if (remembered === 'webgpu' && (await startWebGpu())) {
    active = 'webgpu';
    post({ type: 'backend', backend: 'webgpu', decided: false });
    return;
  }
  active = await startWasm();
  if (remembered === 'webgpu') post({ type: 'backend', backend: 'wasm', decided: true, note: 'WebGPU did not start' });
  else post({ type: 'backend', backend: 'wasm', decided: false, note: active === 'cpu' ? 'cpu' : undefined });
}

/* ------------------------------------------------------------------------------------------------
 * Networks
 * --------------------------------------------------------------------------------------------- */

async function readNet(kind: NetKind): Promise<Uint8Array> {
  const url = new URL(NET_PATHS[kind], base).href;
  try {
    if (self.caches) {
      const hit = await (await self.caches.open(ENGINE_CACHE)).match(url);
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer());
        post({ type: 'progress', net: kind, loaded: bytes.byteLength, total: bytes.byteLength });
        return bytes;
      }
    }
  } catch {
    /* no Cache Storage here: fetch */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`network download: ${res.status} for ${url}`);
  const type = res.headers.get('content-type');
  if (type && /^\s*text\/html/i.test(type)) throw new Error(`network download: HTML instead of a network for ${url}`);
  const length = Number(res.headers.get('content-length'));
  let total = length > 0 && !res.headers.get('content-encoding') ? length : NET_BYTES[kind];
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    total = Math.max(total, loaded);
    const now = performance.now();
    if (now - lastPost > 100) {
      lastPost = now;
      post({ type: 'progress', net: kind, loaded, total });
    }
  }
  post({ type: 'progress', net: kind, loaded, total: loaded });
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function build(p: ParsedModel): NetRunner {
  return new NetRunner(new KataModel(p));
}

function getNet(kind: NetKind): Promise<NetRunner> {
  const have = runners.get(kind);
  if (have) return Promise.resolve(have);
  let p = loading.get(kind);
  if (!p) {
    p = (async () => {
      let model = parsed.get(kind);
      if (!model) {
        const bytes = await readNet(kind);
        if (!isGzip(bytes) && bytes[0] === 0x3c) throw new Error('network download: not a network file');
        model = parseModel(await gunzip(bytes));
        parsed.set(kind, model);
      }
      // Never build while the probe switches backends; it rebuilds what it finds parsed.
      await backendLock;
      const built = runners.get(kind);
      if (built) return built;
      const r = build(model);
      runners.set(kind, r);
      post({ type: 'net', net: kind });
      return r;
    })().finally(() => loading.delete(kind));
    loading.set(kind, p);
  }
  return p;
}

const engine = new KataEngine({ getNet, batchSize });

/* ------------------------------------------------------------------------------------------------
 * WebGPU probe
 * --------------------------------------------------------------------------------------------- */

const NO_STOP: EngineControl = { stopped: () => false, yieldNow };

/** Rebuilds every loaded network on the backend that is active now. */
function rebuildAll(): Map<NetKind, NetRunner> {
  const next = new Map<NetKind, NetRunner>();
  for (const [k, p] of parsed) next.set(k, build(p));
  return next;
}

function swapRunners(next: Map<NetKind, NetRunner>): void {
  for (const r of runners.values()) r.model.dispose();
  runners.clear();
  for (const [k, r] of next) runners.set(k, r);
}

async function probe(): Promise<void> {
  if (active !== 'wasm' && active !== 'cpu') return;
  const pos = probePosition();
  let reference: EngineEvaluation;
  try {
    await getNet('small');
    reference = await engine.evaluate(pos, {}, NO_STOP);
  } catch {
    return;
  }
  const from = active;
  let candidates: Map<NetKind, NetRunner> | null = null;
  let release!: () => void;
  backendLock = new Promise<void>((r) => (release = r));
  try {
    if (!(await startWebGpu())) {
      post({ type: 'backend', backend: 'wasm', decided: true, note: 'no WebGPU adapter' });
      return;
    }
    candidates = rebuildAll();
    const gpuEngine = new KataEngine({ getNet: async (k) => candidates!.get(k) ?? Promise.reject(new Error('net')) });
    const got = await gpuEngine.evaluate(pos, {}, NO_STOP);
    if (!sameEvaluation(reference, got)) throw new Error('WebGPU result differs from WASM');
    swapRunners(candidates);
    candidates = null;
    active = 'webgpu';
    post({ type: 'backend', backend: 'webgpu', decided: true });
  } catch (e) {
    if (candidates) for (const r of candidates.values()) r.model.dispose();
    if (getBackend() !== from) await setBackend(from);
    await ready();
    post({ type: 'backend', backend: 'wasm', decided: true, note: describe(e) });
  } finally {
    release();
  }
}

/** After a WebGPU failure in a job: back to WASM for good. */
async function fallBackToWasm(reason: string): Promise<void> {
  active = await startWasm();
  swapRunners(rebuildAll());
  post({ type: 'backend', backend: 'wasm', decided: true, note: reason });
}

/* ------------------------------------------------------------------------------------------------
 * Jobs
 * --------------------------------------------------------------------------------------------- */

type Job = Exclude<ToWorker, { type: 'init' } | { type: 'stop' } | { type: 'load' }>;

let chain: Promise<void> = Promise.resolve();
let current: { id: number; stopped: boolean } | null = null;
const cancelled = new Set<number>();
/** Highest job id started; a stop for an older id comes too late and is dropped. */
let lastStarted = 0;

function enqueue(f: () => Promise<void>): void {
  chain = chain.then(f).catch(() => undefined);
}

async function execute(job: Job, ctl: EngineControl): Promise<{ result: unknown; transfer: Transferable[] }> {
  switch (job.type) {
    case 'evaluate': {
      const r = await engine.evaluate(job.pos, job.opts, ctl);
      return { result: r, transfer: [r.ownership.buffer, r.policy.buffer] };
    }
    case 'analyze':
      return { result: await engine.analyze(job.pos, job.n, job.opts, ctl), transfer: [] };
    case 'genmove':
      return { result: await engine.genmove(job.pos, job.level, job.clock, job.opts, ctl), transfer: [] };
  }
}

async function run(job: Job): Promise<void> {
  if (cancelled.delete(job.id)) {
    post({ type: 'error', id: job.id, message: 'stopped' });
    return;
  }
  lastStarted = Math.max(lastStarted, job.id);
  const me = { id: job.id, stopped: false };
  current = me;
  const ctl: EngineControl = { stopped: () => me.stopped, yieldNow };
  try {
    if (!initPromise) throw new Error('engine worker not initialised');
    await initPromise;
    let out: { result: unknown; transfer: Transferable[] };
    try {
      out = await execute(job, ctl);
    } catch (e) {
      if (active !== 'webgpu') throw e;
      await fallBackToWasm(`WebGPU failed: ${describe(e)}`);
      out = await execute(job, ctl);
    }
    post({ type: 'result', id: job.id, result: out.result }, out.transfer);
  } catch (e) {
    post({ type: 'error', id: job.id, message: describe(e) });
  } finally {
    current = null;
  }
}

/**
 * Loads run beside the search queue (a large-net download must not hold up a hint or the guard).
 * After the small net, a first launch probes WebGPU, queued between searches.
 */
function load(id: number, net: NetKind): void {
  const ready = initPromise ?? Promise.reject(new Error('engine worker not initialised'));
  ready
    .then(() => getNet(net))
    .then(
      () => {
        post({ type: 'result', id, result: null });
        if (probeWanted && net === 'small') {
          probeWanted = false;
          enqueue(probe);
        }
      },
      (e) => post({ type: 'error', id, message: describe(e) }),
    );
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      if (initPromise) return;
      base = m.base;
      probeWanted = m.backend === null;
      initPromise = init(m.backend);
      initPromise.catch((err) => post({ type: 'error', id: null, message: describe(err), fatal: true }));
      return;
    case 'stop':
      if (current?.id === m.id) current.stopped = true;
      else if (m.id > lastStarted) cancelled.add(m.id);
      return;
    case 'load':
      load(m.id, m.net);
      return;
    default:
      enqueue(() => run(m));
  }
};
