/**
 * The engine driver: `EngineApi` over the engine worker (DESIGN 10.1), with the sibling app's driver rules.
 *
 * Framework-free. The browser plugs in the Vite-bundled module worker (./browser.ts), tests plug in
 * a scripted fake worker. React access goes through `hooks/useZigoEngine.ts`, which keeps one shared
 * instance so the computer, the hint, the guard and the scoring proposal use one worker.
 *
 * Rules:
 * - Lazy: nothing is fetched until `load()` or the first search; a search loads stage 1 itself. A
 *   search started while the engine loads waits in the queue; its timeout (if any) counts from the
 *   call.
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
 * - Backend: the remembered choice is read from `storage` and sent to the worker; a decision the
 *   worker reports (WebGPU probe) is written back.
 */
import type { ClockInfo, EngineEvaluation, EngineGenmoveOptions, EngineMove, EngineNet, EngineSearchOptions, EngineState, Position } from '../types';
import { EngineAbortError, EngineUnavailableError, type EngineHandle, type EngineSnapshot } from './handle';
import type { EngineBackendChoice, FromWorker, ToWorker } from './protocol';

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
}

type JobKind = 'genmove' | 'evaluate' | 'analyze';

type Outcome =
  | { readonly status: 'done'; readonly result: unknown }
  | { readonly status: 'timeout' }
  | { readonly status: 'aborted' }
  | { readonly status: 'failed'; readonly error: Error };

interface Job {
  readonly kind: JobKind;
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

  private snapshot: EngineSnapshot = Object.freeze({ state: 'idle', progress: 0, backend: null, nets: NO_NETS });
  private readonly listeners = new Set<() => void>();

  private worker: WorkerLike | null = null;
  private generation = 0;
  private nextId = 1;
  private disposed = false;
  private initTimer?: ReturnType<typeof setTimeout>;

  /** Pending net loads: resolved when the worker reports the net, rejected on failure. */
  private readonly netWaits = new Map<EngineNet, { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void; id: number }>();
  private readonly loadIds = new Map<number, EngineNet>();

  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private watchdog?: ReturnType<typeof setTimeout>;

  constructor(opts: EngineDriverOptions) {
    this.opts = opts;
    this.initTimeoutMs = opts.initTimeoutMs ?? 60_000;
    this.watchdogMs = opts.watchdogMs ?? 30_000;
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
    let remembered: EngineBackendChoice | null = null;
    try {
      remembered = this.opts.storage?.get() ?? null;
    } catch {
      remembered = null;
    }
    w.postMessage({ type: 'init', base: this.opts.base(), backend: remembered });
    return w;
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
        this.set({ progress: Math.max(this.snapshot.progress, Math.min(1, m.loaded / total) * 0.9) });
        return;
      }
      case 'net': {
        const nets = { ...this.snapshot.nets, [m.net]: true };
        this.set({ nets, ...(m.net === 'small' ? { state: 'ready' as const } : {}), progress: 1 });
        const w = this.netWaits.get(m.net);
        if (w) {
          this.netWaits.delete(m.net);
          w.resolve();
        }
        this.armInitTimer();
        this.pump();
        return;
      }
      case 'backend':
        this.set({ backend: m.backend });
        if (m.decided) {
          try {
            this.opts.storage?.set(m.backend);
          } catch {
            /* storage blocked: decide again next time */
          }
        }
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
          if (m.type === 'error') this.onLoadError(net, new EngineUnavailableError(m.message));
          return;
        }
        const job = this.running;
        if (!job || job.id !== m.id) return;
        this.running = null;
        clearTimeout(this.watchdog);
        if (m.type === 'result') job.settle({ status: 'done', result: m.result });
        else job.settle({ status: 'failed', error: new EngineUnavailableError(m.message) });
        this.pump();
        return;
      }
    }
  }

  private onLoadError(net: EngineNet, error: Error): void {
    const w = this.netWaits.get(net);
    if (w) {
      this.netWaits.delete(net);
      w.reject(error);
    }
    if (net === 'small') this.fail(error);
    else {
      this.set({ progress: 1 });
      this.armInitTimer();
    }
  }

  private fail(err: Error): void {
    clearTimeout(this.initTimer);
    clearTimeout(this.watchdog);
    this.generation++;
    const w = this.worker;
    this.worker = null;
    try {
      w?.terminate();
    } catch {
      /* already gone */
    }
    const error = err instanceof EngineUnavailableError ? err : new EngineUnavailableError(err.message);
    const jobs = [...(this.running ? [this.running] : []), ...this.queue.splice(0)];
    this.running = null;
    for (const j of jobs) j.settle({ status: 'failed', error });
    const waits = [...this.netWaits.values()];
    this.netWaits.clear();
    this.loadIds.clear();
    for (const wt of waits) wt.reject(error);
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
    if (net === 'small') this.set({ state: 'loading', progress: 0 });
    else if (this.snapshot.state !== 'ready') this.set({ state: 'loading' });
    else this.set({ progress: 0 });
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

  private enqueue(kind: JobKind, build: (id: number) => ToWorker, expectedMs: number, timeoutMs?: number): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      const job: Job = {
        kind,
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
      if (!this.snapshot.nets.small) this.loadNet('small').catch(() => undefined);
      this.pump();
    });
  }

  private pump(): void {
    if (this.running || !this.worker || !this.snapshot.nets.small) return;
    let job = this.queue.shift();
    while (job && job.settled) job = this.queue.shift();
    if (!job) return;
    job.id = this.nextId++;
    job.sent = true;
    this.running = job;
    this.worker.postMessage(job.build(job.id));
    this.armWatchdog(job);
  }

  private armWatchdog(job: Job): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.running !== job) return;
      this.sendStop(job);
      this.watchdog = setTimeout(() => {
        if (this.running === job) this.fail(new EngineUnavailableError('Engine stopped answering'));
      }, STOP_GRACE_MS);
    }, job.expectedMs + this.watchdogMs);
  }

  private sendStop(job: Job): void {
    if (job.stopSent || !job.sent || this.running !== job) return;
    job.stopSent = true;
    this.worker?.postMessage({ type: 'stop', id: job.id });
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
    const o = await this.enqueue('genmove', (id) => ({ type: 'genmove', id, pos, level, clock, opts }), expected);
    return valueOf(o) as EngineMove;
  };

  readonly evaluate = async (pos: Position, opts: EngineSearchOptions, timeoutMs?: number): Promise<EngineEvaluation | null> => {
    const expected = opts.timeMs ?? 10_000;
    const o = await this.enqueue('evaluate', (id) => ({ type: 'evaluate', id, pos, opts }), expected, timeoutMs);
    return o.status === 'done' ? (o.result as EngineEvaluation) : null;
  };

  readonly analyze = async (
    pos: Position,
    n: number,
    opts: EngineSearchOptions = {},
  ): Promise<{ move: string; winrate: number; scoreLead: number; prior?: number; visits?: number }[]> => {
    const expected = opts.timeMs ?? 10_000;
    const o = await this.enqueue('analyze', (id) => ({ type: 'analyze', id, pos, n, opts }), expected);
    return valueOf(o) as { move: string; winrate: number; scoreLead: number }[];
  };
}

function valueOf(o: Outcome): unknown {
  if (o.status === 'done') return o.result;
  if (o.status === 'failed') throw o.error;
  if (o.status === 'aborted') throw new EngineAbortError();
  throw new EngineAbortError('Engine search timed out');
}
