/**
 * The engine driver: `EngineApi` over the engine worker (DESIGN 10.1), with the sibling app's driver rules.
 *
 * Framework-free. The browser plugs in the Vite-bundled module worker (./browser.ts), tests plug in
 * a scripted fake worker. React access goes through `hooks/useZigoEngine.ts`, which keeps one shared
 * instance so the computer, the hint, the guard and the scoring proposal use one worker.
 *
 * Rules:
 * - Lazy: nothing is fetched until `load()` or the first search; a search loads stage 1 itself, and a
 *   search that needs the large net (a level 8–12 `genmove`, or `opts.net === 'large'`) loads that
 *   too. A search waits in the queue until its net is loaded, so a download runs under the loading
 *   rules (`initTimeoutMs`, re-armed by progress), never under the search watchdog. Its timeout (if
 *   any) counts from the call.
 * - `progress` follows the net that is being waited for: the large net while it loads (stage 2),
 *   else the small net. The small net finishing does not show 100 % while the large one loads.
 * - One search at a time. Searches queue in call order; the next is sent only after the worker has
 *   answered the previous one (also a stopped or timed-out one).
 * - `stop()` cancels everything: queued searches and the running one settle at once (`genmove` and
 *   `analyze` reject with an `AbortError`, `evaluate` resolves null) and the worker is told to stop.
 * - `evaluate(…, timeoutMs)` resolves null when the answer is not there in time (queue wait and
 *   loading included); a running search is then stopped. `evaluate` never rejects.
 * - Failure (worker error, no sign of life for `initTimeoutMs` while loading, a hung search): state
 *   `failed`; pending searches settle (evaluate → null, others reject with
 *   `EngineUnavailableError`); the worker is terminated. The next `load()` or search retries with a
 *   new worker.
 * - Backends: WASM always plays; WebGPU takes over once it is warm. The main worker runs WASM and
 *   answers every search from the first move. When `gpu()` says WebGPU exists and `storage` does not
 *   say `wasm`, a second worker starts on WebGPU once the small net is loaded. For every board size
 *   and net the searches ask for, it is warmed up in the background (`warm`: shaders compiled, then
 *   the probe position evaluated and compared with WASM's, and one network call timed on both).
 *   Once warm, a search goes to WebGPU when WebGPU is faster for its kind: a single evaluation
 *   (levels 1–9, the guard, the dame check) compares one WebGPU call with one WASM call, a search
 *   with many visits compares a WebGPU call's 8 rows with 8 WASM calls. Everything else, and
 *   everything while WebGPU warms up, goes to WASM.
 * - A WebGPU worker that errors, crashes, hangs in a search (`gpuWatchdogMs`) or disagrees with WASM
 *   is dropped for good on this device (`wasm` remembered); its running search goes back to the head
 *   of the queue and runs on WASM. A warm-up slower than `warmTimeoutMs` drops it for this page only.
 *   No WebGPU trouble ever fails the engine or reaches the player.
 */
import type { ClockInfo, EngineEvaluation, EngineGenmoveOptions, EngineMove, EngineNet, EngineSearchOptions, EngineState, Position } from '../types';
import { EngineAbortError, EngineUnavailableError, type EngineHandle, type EngineSnapshot } from './handle';
import type { EngineBackendChoice, FromWorker, ToWorker, WarmResult } from './protocol';
import { levelSpec, needsLargeNet } from '../levels';
import { probePosition, sameEvaluation } from './probe';

/** The part of `Worker` the driver uses. */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: ErrorEvent | Event) => void) | null;
}

export interface BackendStorage {
  get(): EngineBackendChoice | null;
  set(b: EngineBackendChoice): void;
}

export interface EngineDriverOptions {
  createWorker: () => WorkerLike;
  /** The page's base URL (`document.baseURI`); the worker resolves `engine/…` against it. */
  base: () => string;
  /** `zigo:engine-backend`. Default: nothing remembered. */
  storage?: BackendStorage;
  /** Give up loading when the worker shows no sign of life (progress or answer) for this long. Default 60 s. */
  initTimeoutMs?: number;
  /** A search that has not answered this long after its expected time is stopped, then the engine is failed. Default 30 s. */
  watchdogMs?: number;
  /** Whether to try WebGPU beside WASM (the browser: `'gpu' in navigator`). Default: never. */
  gpu?: () => boolean;
  /** The same slack for a search on the WebGPU worker, before that worker is dropped. Default 10 s. */
  gpuWatchdogMs?: number;
  /** The longest one WebGPU warm-up (a board size and net) may take before WebGPU is dropped for this page. Default 180 s. */
  warmTimeoutMs?: number;
}

/** The WebGPU worker beside the WASM one (see the file comment). */
interface GpuLane {
  readonly worker: WorkerLike;
  /** `size:net` keys warmed up and checked against WASM, with one network call's time on each. */
  readonly warm: Map<string, { readonly gpuMs: number; readonly wasmMs: number }>;
  /** The warm-up in progress, until its check against WASM is done. */
  warming: { readonly key: string; readonly id: number; readonly timer: ReturnType<typeof setTimeout> } | null;
}

const gpuKey = (size: number, net: EngineNet) => `${size}:${net}`;

/** Rows in one WebGPU network call (the worker's padded batch). */
const GPU_ROWS = 8;

/** `warm`: the WASM side of a WebGPU warm-up (reference evaluation and timing), always on WASM. */
type JobKind = 'genmove' | 'evaluate' | 'analyze' | 'warm';

type Outcome =
  | { readonly status: 'done'; readonly result: unknown }
  | { readonly status: 'timeout' }
  | { readonly status: 'aborted' }
  | { readonly status: 'failed'; readonly error: Error };

interface Job {
  readonly kind: JobKind;
  /** The net the search runs on; the job is sent only once the worker has it. */
  readonly net: EngineNet;
  /** The board size (WebGPU is warmed up per size). */
  readonly size: number;
  /** Many visits (batched on WebGPU), not a single network call. */
  readonly search: boolean;
  /** The worker the job was sent to. */
  lane: 'main' | 'gpu' | null;
  readonly build: (id: number) => ToWorker;
  /** The longest the search should take (for the watchdog). */
  readonly expectedMs: number;
  id: number;
  settled: boolean;
  sent: boolean;
  stopSent: boolean;
  timer?: ReturnType<typeof setTimeout>;
  settle(o: Outcome): void;
}

const STOP_GRACE_MS = 3000;
const NO_NETS = Object.freeze({ small: false, large: false });

export class EngineDriver implements EngineHandle {
  private readonly opts: EngineDriverOptions;
  private readonly initTimeoutMs: number;
  private readonly watchdogMs: number;
  private readonly gpuWatchdogMs: number;
  private readonly warmTimeoutMs: number;

  private snapshot: EngineSnapshot = Object.freeze({ state: 'idle', progress: 0, backend: null, nets: NO_NETS });
  private readonly listeners = new Set<() => void>();

  private worker: WorkerLike | null = null;
  private generation = 0;
  private nextId = 1;
  private disposed = false;
  private initTimer?: ReturnType<typeof setTimeout>;

  private gpu: GpuLane | null = null;
  private gpuGeneration = 0;
  /** WebGPU is not tried again on this page. */
  private gpuOff = false;
  /** `size:net` keys searches asked for that the WebGPU worker has not warmed up yet, in order. */
  private readonly gpuWants: string[] = [];

  /** Pending net loads: resolved when the worker reports the net, rejected on failure. */
  private readonly netWaits = new Map<EngineNet, { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void; id: number }>();
  private readonly loadIds = new Map<number, EngineNet>();
  /** Each net's own load progress (0..1), so one net's messages never move the other's figure. */
  private readonly netProgress: Record<EngineNet, number> = { small: 0, large: 0 };

  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private watchdog?: ReturnType<typeof setTimeout>;

  constructor(opts: EngineDriverOptions) {
    this.opts = opts;
    this.initTimeoutMs = opts.initTimeoutMs ?? 60_000;
    this.watchdogMs = opts.watchdogMs ?? 30_000;
    this.gpuWatchdogMs = opts.gpuWatchdogMs ?? 10_000;
    this.warmTimeoutMs = opts.warmTimeoutMs ?? 180_000;
  }

  /* ---------------------------------------------------------------- state */

  get state(): EngineState {
    return this.snapshot.state;
  }

  get progress(): number {
    return this.snapshot.progress;
  }

  get backend(): EngineSnapshot['backend'] {
    return this.snapshot.backend;
  }

  get nets(): EngineSnapshot['nets'] {
    return this.snapshot.nets;
  }

  readonly getSnapshot = (): EngineSnapshot => this.snapshot;

  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private set(patch: Partial<EngineSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    next.progress = Math.min(1, Math.max(0, next.progress));
    const s = this.snapshot;
    if (
      next.state === s.state &&
      next.progress === s.progress &&
      next.backend === s.backend &&
      next.nets.small === s.nets.small &&
      next.nets.large === s.nets.large
    )
      return;
    this.snapshot = Object.freeze({ ...next, nets: Object.freeze({ small: next.nets.small, large: next.nets.large }) });
    for (const cb of [...this.listeners]) cb();
  }

  /* ---------------------------------------------------------------- worker */

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const gen = ++this.generation;
    const alive = () => gen === this.generation && !this.disposed;
    const w = this.opts.createWorker();
    w.onmessage = (e) => {
      if (alive()) this.onMessage(e.data);
    };
    w.onerror = (e) => {
      if (!alive()) return;
      const msg = (e as ErrorEvent).message;
      this.fail(new EngineUnavailableError(msg ? `Engine worker error: ${msg}` : 'Engine worker error'));
    };
    this.worker = w;
    w.postMessage({ type: 'init', base: this.opts.base(), backend: 'wasm' });
    return w;
  }

  /* ---------------------------------------------------------------- WebGPU worker */

  private rememberBackend(b: EngineBackendChoice): void {
    try {
      this.opts.storage?.set(b);
    } catch {
      /* storage blocked: decide again next time */
    }
  }

  /** Starts the WebGPU worker once the small net is on the main worker (see the file comment). */
  private startGpu(): void {
    if (this.gpu || this.gpuOff || this.disposed || !this.snapshot.nets.small) return;
    if (!this.gpuWanted()) {
      this.gpuWants.length = 0;
      return;
    }
    const gen = ++this.gpuGeneration;
    const alive = () => gen === this.gpuGeneration && !this.disposed;
    const w = this.opts.createWorker();
    const lane: GpuLane = { worker: w, warm: new Map(), warming: null };
    w.onmessage = (e) => {
      if (alive()) this.onGpuMessage(lane, e.data);
    };
    w.onerror = (e) => {
      if (!alive()) return;
      const msg = (e as ErrorEvent).message;
      this.dropGpu(msg ? `worker error: ${msg}` : 'worker error', true);
    };
    this.gpu = lane;
    w.postMessage({ type: 'init', base: this.opts.base(), backend: 'webgpu' });
    this.pumpGpu();
  }

  /** WebGPU exists here and has not been found broken on this device before. */
  private gpuWanted(): boolean {
    try {
      return (this.opts.gpu?.() ?? false) && this.opts.storage?.get() !== 'wasm';
    } catch {
      return false;
    }
  }

  /** Asks for a warm-up of `size` and `net` on the WebGPU worker, if it is not warm for them yet. */
  private wantGpu(size: number, net: EngineNet): void {
    if (this.gpuOff || !this.gpuWanted()) return;
    const key = gpuKey(size, net);
    if (this.gpu?.warm.has(key) || this.gpu?.warming?.key === key || this.gpuWants.includes(key)) return;
    this.gpuWants.push(key);
    this.pumpGpu();
  }

  /** Starts the next warm-up whose net the main worker has (so it is on the device). */
  private pumpGpu(): void {
    const lane = this.gpu;
    if (!lane || lane.warming || this.running?.lane === 'gpu') return;
    const i = this.gpuWants.findIndex((k) => this.snapshot.nets[k.split(':')[1] as EngineNet]);
    if (i < 0) return;
    const key = this.gpuWants.splice(i, 1)[0];
    const [sizeText, netText] = key.split(':');
    const net = netText as EngineNet;
    const pos = probePosition(Number(sizeText) as Position['size']);
    const id = this.nextId++;
    const timer = setTimeout(() => this.dropGpu('warm-up took too long', false), this.warmTimeoutMs);
    lane.warming = { key, id, timer };
    // WASM's answer and timing for the same position, to check WebGPU's against.
    const reference = this.enqueue('warm', net, pos.size, false, (jid) => ({ type: 'warm', id: jid, pos, net }), 10_000).then((o) =>
      o.status === 'done' ? (o.result as WarmResult) : null,
    );
    lane.worker.postMessage({ type: 'warm', id, pos, net });
    this.warmReference.set(id, reference);
  }

  /** WASM's side of the warm-ups in progress, by warm-up id. */
  private readonly warmReference = new Map<number, Promise<WarmResult | null>>();

  /** Whether the WebGPU worker is warm for `job` and faster at it than WASM (see the file comment). */
  private gpuTakes(job: Job): boolean {
    const gpu = this.gpu;
    if (!gpu || gpu.warming || job.kind === 'warm') return false;
    const speed = gpu.warm.get(gpuKey(job.size, job.net));
    if (!speed) return false;
    return job.search ? speed.gpuMs < speed.wasmMs * GPU_ROWS : speed.gpuMs < speed.wasmMs;
  }

  private onGpuMessage(lane: GpuLane, m: FromWorker): void {
    if (m.type !== 'result' && m.type !== 'error') return;
    if (m.id === null) {
      if (m.type === 'error' && m.fatal) this.dropGpu(m.message, true);
      return;
    }
    const warming = lane.warming;
    if (warming && m.id === warming.id) {
      clearTimeout(warming.timer);
      const reference = this.warmReference.get(m.id);
      this.warmReference.delete(m.id);
      if (m.type === 'error') {
        this.dropGpu(`warm-up failed: ${m.message}`, true);
        return;
      }
      const got = m.result as WarmResult;
      void (reference ?? Promise.resolve(null)).then((ref) => {
        if (this.gpu !== lane) return;
        // No WASM answer to compare with (WASM failed meanwhile): try again with the next search.
        if (!ref) {
          lane.warming = null;
          this.wantGpu(Number(warming.key.split(':')[0]), warming.key.split(':')[1] as EngineNet);
          return;
        }
        if (!sameEvaluation(ref.evaluation, got.evaluation)) {
          this.dropGpu('WebGPU result differs from WASM', true);
          return;
        }
        lane.warming = null;
        lane.warm.set(warming.key, { gpuMs: got.ms, wasmMs: ref.ms });
        console.info(`Zigo engine: WebGPU ready for ${warming.key} (one call ${got.ms.toFixed(1)} ms; WASM ${ref.ms.toFixed(1)} ms).`);
        this.rememberBackend('webgpu');
        if (got.ms < ref.ms * GPU_ROWS) this.set({ backend: 'webgpu' });
        this.pump();
        this.pumpGpu();
      });
      return;
    }
    const job = this.running;
    if (!job || job.lane !== 'gpu' || job.id !== m.id) return;
    clearTimeout(this.watchdog);
    if (m.type === 'error') {
      this.dropGpu(`search failed: ${m.message}`, true);
      return;
    }
    this.running = null;
    job.settle({ status: 'done', result: m.result });
    this.pump();
    this.pumpGpu();
  }

  /**
   * Drops the WebGPU worker. Its running search goes back to the head of the queue and runs on WASM.
   * `remember`: WebGPU is broken here, so later launches do not try it (`wasm` stored).
   */
  private dropGpu(reason: string, remember: boolean): void {
    this.gpuOff = true;
    this.gpuWants.length = 0;
    const lane = this.gpu;
    if (!lane) return;
    this.gpu = null;
    this.gpuGeneration++;
    if (lane.warming) clearTimeout(lane.warming.timer);
    try {
      lane.worker.terminate();
    } catch {
      /* already gone */
    }
    if (remember) this.rememberBackend('wasm');
    console.warn(`Zigo engine: WebGPU dropped (${reason}); the computer plays on WASM.`);
    const job = this.running;
    if (job && job.lane === 'gpu') {
      clearTimeout(this.watchdog);
      this.running = null;
      if (!job.settled) {
        job.sent = false;
        job.stopSent = false;
        job.lane = null;
        this.queue.unshift(job);
      }
    }
    this.set({ backend: 'wasm' });
    this.pump();
  }

  private armInitTimer(): void {
    clearTimeout(this.initTimer);
    if (this.netWaits.size === 0) return;
    this.initTimer = setTimeout(() => {
      if (this.netWaits.size > 0) this.fail(new EngineUnavailableError('Engine did not start in time'));
    }, this.initTimeoutMs);
  }

  private onMessage(m: FromWorker): void {
    switch (m.type) {
      case 'progress': {
        this.armInitTimer();
        const total = m.total > 0 ? m.total : 1;
        // The download is most of the loading; building the network takes the rest.
        this.netProgress[m.net] = Math.max(this.netProgress[m.net], Math.min(1, m.loaded / total) * 0.9);
        if (m.net === this.progressNet()) this.set({ progress: this.netProgress[m.net] });
        return;
      }
      case 'net': {
        const nets = { ...this.snapshot.nets, [m.net]: true };
        this.netProgress[m.net] = 1;
        const w = this.netWaits.get(m.net);
        if (w) this.netWaits.delete(m.net);
        this.set({ nets, ...(m.net === 'small' ? { state: 'ready' as const } : {}), progress: this.pendingProgress() });
        w?.resolve();
        this.armInitTimer();
        this.pump();
        this.startGpu();
        this.pumpGpu();
        return;
      }
      case 'backend':
        if (m.note) console.warn(`Zigo engine: ${m.backend} worker note: ${m.note}.`);
        // The main worker runs WASM; the figure says WebGPU once a WebGPU warm-up has passed.
        if (!this.gpu || this.gpu.warm.size === 0) this.set({ backend: m.backend });
        return;
      case 'result':
      case 'error': {
        if (m.id === null) {
          if (m.type === 'error' && m.fatal) this.fail(new EngineUnavailableError(m.message));
          return;
        }
        const net = this.loadIds.get(m.id);
        if (net) {
          this.loadIds.delete(m.id);
          if (m.type === 'error') {
            console.error(`Zigo engine: loading the ${net} net failed: ${m.message}`);
            this.onLoadError(net, new EngineUnavailableError(m.message));
          }
          return;
        }
        const job = this.running;
        if (!job || job.lane !== 'main' || job.id !== m.id) return;
        this.running = null;
        clearTimeout(this.watchdog);
        if (m.type === 'result') job.settle({ status: 'done', result: m.result });
        else {
          console.error(`Zigo engine: ${job.kind} failed in the worker: ${m.message}`);
          job.settle({ status: 'failed', error: new EngineUnavailableError(m.message) });
        }
        this.pump();
        return;
      }
    }
  }

  /** The net whose load the progress figure shows: the large one while it loads, else the small one. */
  private progressNet(): EngineNet {
    return this.netWaits.has('large') ? 'large' : 'small';
  }

  /**
   * The progress figure after a net finished or failed: the figure of the net still loading (so the
   * small net done while the large one loads does not show 100 %), or 1 when nothing loads.
   */
  private pendingProgress(): number {
    return this.netWaits.size > 0 ? this.netProgress[this.progressNet()] : 1;
  }

  private onLoadError(net: EngineNet, error: Error): void {
    const w = this.netWaits.get(net);
    if (w) {
      this.netWaits.delete(net);
      w.reject(error);
    }
    if (net === 'small') this.fail(error);
    else {
      this.set({ progress: this.pendingProgress() });
      this.armInitTimer();
    }
  }

  private fail(err: Error): void {
    clearTimeout(this.initTimer);
    clearTimeout(this.watchdog);
    this.generation++;
    // The WebGPU worker goes with the engine (not for good: the next load starts it again).
    const lane = this.gpu;
    this.gpu = null;
    this.gpuGeneration++;
    if (lane) {
      if (lane.warming) clearTimeout(lane.warming.timer);
      try {
        lane.worker.terminate();
      } catch {
        /* already gone */
      }
    }
    this.gpuWants.length = 0;
    const w = this.worker;
    this.worker = null;
    try {
      w?.terminate();
    } catch {
      /* already gone */
    }
    const error = err instanceof EngineUnavailableError ? err : new EngineUnavailableError(err.message);
    if (!this.disposed) console.error(`Zigo engine failed: ${error.message}`);
    const jobs = [...(this.running ? [this.running] : []), ...this.queue.splice(0)];
    this.running = null;
    for (const j of jobs) j.settle({ status: 'failed', error });
    const waits = [...this.netWaits.values()];
    this.netWaits.clear();
    this.loadIds.clear();
    for (const wt of waits) wt.reject(error);
    this.netProgress.small = this.netProgress.large = 0;
    this.set({ state: this.disposed ? 'idle' : 'failed', progress: 0, nets: NO_NETS, backend: this.disposed ? null : this.snapshot.backend });
  }

  /* ---------------------------------------------------------------- loading */

  private loadNet(net: EngineNet): Promise<void> {
    if (this.disposed) return Promise.reject(new EngineUnavailableError('Engine disposed'));
    if (this.snapshot.nets[net]) return Promise.resolve();
    const have = this.netWaits.get(net);
    if (have) return have.promise;
    const w = this.ensureWorker();
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const id = this.nextId++;
    this.netWaits.set(net, { promise, resolve, reject, id });
    this.loadIds.set(id, net);
    this.netProgress[net] = 0;
    const progress = this.netProgress[this.progressNet()];
    this.set(this.snapshot.state === 'ready' ? { progress } : { state: 'loading', progress });
    this.armInitTimer();
    w.postMessage({ type: 'load', id, net });
    return promise;
  }

  /** Stage 1: the small net (levels 1–7, guard, hints, scoring); stage 2 also the large one. */
  readonly load = (stage: 1 | 2 = 1): Promise<void> => {
    const first = this.loadNet('small');
    if (stage === 1) return first;
    return Promise.all([first, this.loadNet('large')]).then(() => undefined);
  };

  /* ---------------------------------------------------------------- queue */

  private enqueue(
    kind: JobKind,
    net: EngineNet,
    size: number,
    search: boolean,
    build: (id: number) => ToWorker,
    expectedMs: number,
    timeoutMs?: number,
  ): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      const job: Job = {
        kind,
        net,
        size,
        search,
        lane: null,
        build,
        expectedMs,
        id: 0,
        settled: false,
        sent: false,
        stopSent: false,
        settle: (o) => {
          if (job.settled) return;
          job.settled = true;
          clearTimeout(job.timer);
          resolve(o);
        },
      };
      if (this.disposed) {
        job.settle({ status: 'failed', error: new EngineUnavailableError('Engine disposed') });
        return;
      }
      if (timeoutMs !== undefined) job.timer = setTimeout(() => this.onDeadline(job), Math.max(0, timeoutMs));
      this.queue.push(job);
      if (kind !== 'warm') this.wantGpu(size, net);
      if (!this.snapshot.nets.small) this.loadNet('small').catch(() => undefined);
      if (net === 'large' && !this.snapshot.nets.large) {
        // A failed large net fails this search only; the engine stays ready on the small net.
        this.loadNet('large').catch((error: Error) => {
          if (job.settled) return;
          const i = this.queue.indexOf(job);
          if (i >= 0) this.queue.splice(i, 1);
          job.settle({ status: 'failed', error: error instanceof EngineUnavailableError ? error : new EngineUnavailableError(error.message) });
          this.pump();
        });
      }
      this.pump();
    });
  }

  private pump(): void {
    if (this.running) return;
    while (this.queue.length > 0 && this.queue[0].settled) this.queue.shift();
    const head = this.queue[0];
    if (!head) return;
    // A warm WebGPU worker that is not busy warming up takes the search when it is faster; else WASM.
    const onGpu = this.gpuTakes(head);
    const worker = onGpu ? this.gpu!.worker : this.worker;
    // Searches run in call order: one waiting for its net holds back the ones behind it.
    if (!worker || !this.snapshot.nets.small || !this.snapshot.nets[head.net]) return;
    const job = this.queue.shift()!;
    job.id = this.nextId++;
    job.sent = true;
    job.lane = onGpu ? 'gpu' : 'main';
    this.running = job;
    worker.postMessage(job.build(job.id));
    this.armWatchdog(job);
  }

  private armWatchdog(job: Job): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.running !== job) return;
      this.sendStop(job);
      this.watchdog = setTimeout(() => {
        if (this.running !== job) return;
        if (job.lane === 'gpu') this.dropGpu('a search stopped answering', true);
        else this.fail(new EngineUnavailableError('Engine stopped answering'));
      }, STOP_GRACE_MS);
    }, job.expectedMs + (job.lane === 'gpu' ? this.gpuWatchdogMs : this.watchdogMs));
  }

  private sendStop(job: Job): void {
    if (job.stopSent || !job.sent || this.running !== job) return;
    job.stopSent = true;
    (job.lane === 'gpu' ? this.gpu?.worker : this.worker)?.postMessage({ type: 'stop', id: job.id });
  }

  private onDeadline(job: Job): void {
    if (job.settled) return;
    const i = this.queue.indexOf(job);
    if (i >= 0) this.queue.splice(i, 1);
    job.settle({ status: 'timeout' });
    this.sendStop(job);
  }

  /** Cancel the running search and everything queued (see the file comment). */
  readonly stop = (): void => {
    for (const j of this.queue.splice(0)) j.settle({ status: 'aborted' });
    const job = this.running;
    if (job) {
      job.settle({ status: 'aborted' });
      this.sendStop(job);
    }
  };

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.fail(new EngineUnavailableError('Engine disposed'));
    this.listeners.clear();
  };

  /* ---------------------------------------------------------------- API */

  readonly genmove = async (pos: Position, level: number, clock?: ClockInfo, opts: EngineGenmoveOptions = {}): Promise<EngineMove> => {
    const expected = clock ? Math.max(10_000, clock.left.mainMs / 10) : 10_000;
    const search = levelSpec(level).method === 'search';
    const o = await this.enqueue('genmove', needsLargeNet(level) ? 'large' : 'small', pos.size, search, (id) => ({ type: 'genmove', id, pos, level, clock, opts }), expected);
    return valueOf(o) as EngineMove;
  };

  readonly evaluate = async (pos: Position, opts: EngineSearchOptions, timeoutMs?: number): Promise<EngineEvaluation | null> => {
    const expected = opts.timeMs ?? 10_000;
    const search = (opts.visits ?? (opts.timeMs ? 2 : 1)) > 1;
    const o = await this.enqueue('evaluate', opts.net ?? 'small', pos.size, search, (id) => ({ type: 'evaluate', id, pos, opts }), expected, timeoutMs);
    return o.status === 'done' ? (o.result as EngineEvaluation) : null;
  };

  readonly analyze = async (
    pos: Position,
    n: number,
    opts: EngineSearchOptions = {},
  ): Promise<{ move: string; winrate: number; scoreLead: number; prior?: number; visits?: number }[]> => {
    const expected = opts.timeMs ?? 10_000;
    const o = await this.enqueue('analyze', opts.net ?? 'small', pos.size, true, (id) => ({ type: 'analyze', id, pos, n, opts }), expected);
    return valueOf(o) as { move: string; winrate: number; scoreLead: number }[];
  };
}

function valueOf(o: Outcome): unknown {
  if (o.status === 'done') return o.result;
  if (o.status === 'failed') throw o.error;
  if (o.status === 'aborted') throw new EngineAbortError();
  throw new EngineAbortError('Engine search timed out');
}
