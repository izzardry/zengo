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
 * - Backend: one per worker, named in `init`. The page runs a WASM worker that answers every search
 *   from the start, and beside it a WebGPU worker that it warms up (`warm`: the shaders of a board
 *   size compiled in parallel with TF.js's compile-only mode, then one evaluation the page compares
 *   with WASM's) and uses only once warm (EngineDriver). A WebGPU worker never falls back by itself:
 *   it reports errors, and the page drops it.
 * - WebGPU runs every forward pass at a fixed batch of 8 rows (NetRunner padTo), so each board size
 *   compiles one set of shaders instead of one per batch length.
 */
import { backend as tfBackend, env, ready, setBackend } from '@tensorflow/tfjs-core';
import { KataEngine, type EngineControl, type NetKind } from '@/lib/engine/katago/engine';
import { gunzip, isGzip, parseModel, type ParsedModel } from '@/lib/engine/katago/loadModel';
import { KataModel } from '@/lib/engine/katago/model';
import { NetRunner } from '@/lib/engine/katago/net';
import { ENGINE_CACHE } from '@/lib/engine/offline';
import { NET_BYTES, NET_PATHS, TFJS_WASM_DIR, type EngineBackendChoice, type FromWorker, type ToWorker } from '@/lib/engine/protocol';

declare const self: DedicatedWorkerGlobalScope;

type Active = 'webgpu' | 'wasm' | 'cpu';

let base = '';
let active: Active | null = null;
let initPromise: Promise<void> | null = null;
const parsed = new Map<NetKind, ParsedModel>();
const runners = new Map<NetKind, NetRunner>();
const loading = new Map<NetKind, Promise<NetRunner>>();
/** Leaves per network call: WebGPU gains from batches; single-threaded WASM does not. */
const GPU_BATCH = 8;
const batchSize = () => (active === 'webgpu' ? GPU_BATCH : 1);

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

/** Why WASM could not start, when the worker fell back to the plain CPU backend. */
let wasmError = '';

async function startWasm(): Promise<Active> {
  try {
    const wasm = await import('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths(new URL(TFJS_WASM_DIR, base).href);
    if (await setBackend('wasm')) {
      await ready();
      return 'wasm';
    }
    wasmError = 'TF.js could not set the wasm backend';
  } catch (e) {
    wasmError = describe(e);
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

async function init(wanted: EngineBackendChoice): Promise<void> {
  if (wanted === 'webgpu') {
    if (!(await startWebGpu())) throw new Error('WebGPU did not start');
    active = 'webgpu';
    post({ type: 'backend', backend: 'webgpu', decided: false });
    return;
  }
  active = await startWasm();
  post({ type: 'backend', backend: 'wasm', decided: false, note: active === 'cpu' ? `cpu: ${wasmError}` : undefined });
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
  return new NetRunner(new KataModel(p), { padTo: active === 'webgpu' ? GPU_BATCH : 1 });
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
 * Warm-up
 * --------------------------------------------------------------------------------------------- */

/**
 * Gets `net` ready for `pos`'s board size: on WebGPU its shaders are first created in parallel
 * (compile-only pass, then wait for the pipelines). Then `pos` is evaluated for the page to check,
 * and evaluated once more to time one warm network call (`ms`), which the page compares between the
 * WASM and the WebGPU worker.
 */
async function warm(pos: Parameters<typeof engine.evaluate>[0], net: NetKind, ctl: EngineControl) {
  const runner = await getNet(net);
  if (active === 'webgpu') {
    env().set('WEBGPU_ENGINE_COMPILE_ONLY', true);
    try {
      runner.forwardDiscard(pos.size);
    } finally {
      env().set('WEBGPU_ENGINE_COMPILE_ONLY', false);
    }
    await (tfBackend() as unknown as { checkCompileCompletionAsync(): Promise<void> }).checkCompileCompletionAsync();
  }
  const evaluation = await engine.evaluate(pos, { net }, ctl);
  const t0 = performance.now();
  await engine.evaluate(pos, { net }, ctl);
  return { evaluation, ms: performance.now() - t0 };
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
    case 'warm': {
      const r = await warm(job.pos, job.net, ctl);
      return { result: r, transfer: [r.evaluation.ownership.buffer, r.evaluation.policy.buffer] };
    }
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
    const out = await execute(job, ctl);
    post({ type: 'result', id: job.id, result: out.result }, out.transfer);
  } catch (e) {
    console.error(`Zigo engine worker (${active}): ${job.type} failed`, e);
    post({ type: 'error', id: job.id, message: describe(e) });
  } finally {
    current = null;
  }
}

/** Loads run beside the search queue (a large-net download must not hold up a hint or the guard). */
function load(id: number, net: NetKind): void {
  const ready = initPromise ?? Promise.reject(new Error('engine worker not initialised'));
  ready
    .then(() => getNet(net))
    .then(
      () => post({ type: 'result', id, result: null }),
      (e) => post({ type: 'error', id, message: describe(e) }),
    );
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      if (initPromise) return;
      base = m.base;
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
