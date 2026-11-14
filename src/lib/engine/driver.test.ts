import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineDriver, type WorkerLike } from './driver';
import { isEngineAbort } from './handle';
import type { EngineBackendChoice, FromWorker, ToWorker } from './protocol';
import { makeSettings, newGame, position } from '../zengo';
import type { EngineApi } from '../types';

const POS = position(newGame(makeSettings(9)));

class FakeWorker implements WorkerLike {
  readonly sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent | Event) => void) | null = null;

  postMessage(m: ToWorker): void {
    this.sent.push(m);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(m: FromWorker): void {
    this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
  }

  /** Last message of a type. */
  last<T extends ToWorker['type']>(type: T): Extract<ToWorker, { type: T }> | undefined {
    return [...this.sent].reverse().find((m) => m.type === type) as Extract<ToWorker, { type: T }> | undefined;
  }

  of(type: ToWorker['type']): ToWorker[] {
    return this.sent.filter((m) => m.type === type);
  }

  /** Answers the pending load of `net`. */
  loaded(net: 'small' | 'large'): void {
    const load = this.sent.find((m) => m.type === 'load' && m.net === net) as Extract<ToWorker, { type: 'load' }>;
    this.emit({ type: 'net', net });
    this.emit({ type: 'result', id: load.id, result: null });
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(
  opts: {
    remembered?: EngineBackendChoice | null;
    initTimeoutMs?: number;
    watchdogMs?: number;
    gpu?: boolean;
    gpuWatchdogMs?: number;
    warmTimeoutMs?: number;
  } = {},
) {
  const workers: FakeWorker[] = [];
  const stored: EngineBackendChoice[] = [];
  const driver = new EngineDriver({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    base: () => 'https://example.test/zengo/',
    storage: { get: () => opts.remembered ?? null, set: (b) => stored.push(b) },
    initTimeoutMs: opts.initTimeoutMs,
    watchdogMs: opts.watchdogMs,
    gpu: () => opts.gpu ?? false,
    gpuWatchdogMs: opts.gpuWatchdogMs,
    warmTimeoutMs: opts.warmTimeoutMs,
  });
  return { driver, workers, stored, w: () => workers[workers.length - 1] };
}

describe('EngineDriver', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('implements EngineApi', () => {
    const api: EngineApi = setup().driver;
    expect(api.state).toBe('idle');
    expect(api.backend).toBeNull();
    expect(api.nets).toEqual({ small: false, large: false });
  });

  it('is lazy: no worker until load or a search', () => {
    const { workers } = setup();
    expect(workers).toHaveLength(0);
  });

  it('loads stage 1: init on WASM with the base URL, then the small net', async () => {
    const { driver, w } = setup({ remembered: 'webgpu' });
    const seen: string[] = [];
    driver.subscribe(() => seen.push(`${driver.state}:${driver.progress}`));
    const p = driver.load(1);
    expect(w().sent[0]).toEqual({ type: 'init', base: 'https://example.test/zengo/', backend: 'wasm' });
    expect(w().last('load')?.net).toBe('small');
    expect(driver.state).toBe('loading');
    w().emit({ type: 'progress', net: 'small', loaded: 50, total: 100 });
    expect(driver.progress).toBeCloseTo(0.45);
    w().emit({ type: 'backend', backend: 'wasm', decided: false });
    w().loaded('small');
    await p;
    expect(driver.state).toBe('ready');
    expect(driver.progress).toBe(1);
    expect(driver.backend).toBe('wasm');
    expect(driver.nets).toEqual({ small: true, large: false });
    expect(seen[0]).toBe('loading:0');
  });

  it('without WebGPU: one WASM worker, nothing remembered', async () => {
    const { driver, workers, stored } = setup({ gpu: false });
    void driver.load(1);
    workers[0].loaded('small');
    void driver.genmove(POS, 1);
    expect(workers).toHaveLength(1);
    expect(workers[0].last('genmove')).toBeDefined();
    expect(stored).toEqual([]);
  });

  it('stage 2 loads the large net and stays ready meanwhile', async () => {
    const { driver, w } = setup();
    const one = driver.load(1);
    w().loaded('small');
    await one;
    const two = driver.load(2);
    expect(w().last('load')?.net).toBe('large');
    expect(driver.state).toBe('ready');
    expect(driver.progress).toBe(0);
    w().emit({ type: 'progress', net: 'large', loaded: 10, total: 100 });
    expect(driver.progress).toBeCloseTo(0.09);
    w().loaded('large');
    await two;
    expect(driver.nets).toEqual({ small: true, large: true });
    expect(driver.progress).toBe(1);
    // Loading again asks nothing more.
    const before = w().sent.length;
    await driver.load(2);
    expect(w().sent.length).toBe(before);
  });

  it('stage 2 from idle: progress follows the large net, not the small net finishing first', async () => {
    const { driver, w } = setup();
    const two = driver.load(2);
    expect(w().of('load').map((m) => (m as Extract<ToWorker, { type: 'load' }>).net)).toEqual(['small', 'large']);
    expect(driver.state).toBe('loading');
    expect(driver.progress).toBe(0);
    // The small net (cached) reports and finishes; the large one is what the pill waits for.
    w().emit({ type: 'progress', net: 'small', loaded: 100, total: 100 });
    expect(driver.progress).toBe(0);
    w().loaded('small');
    expect(driver.state).toBe('ready');
    expect(driver.progress).toBe(0);
    w().emit({ type: 'progress', net: 'large', loaded: 500_000, total: 11_138_361 });
    expect(driver.progress).toBeGreaterThan(0);
    expect(driver.progress).toBeLessThan(0.1);
    w().emit({ type: 'progress', net: 'large', loaded: 20, total: 100 });
    expect(driver.progress).toBeCloseTo(0.18);
    w().emit({ type: 'progress', net: 'large', loaded: 50, total: 100 });
    expect(driver.progress).toBeCloseTo(0.45);
    w().emit({ type: 'progress', net: 'large', loaded: 100, total: 100 });
    expect(driver.progress).toBeCloseTo(0.9);
    w().loaded('large');
    await two;
    expect(driver.progress).toBe(1);
  });

  it('stage 2 from idle: the large net finishing first still shows the small net loading', async () => {
    const { driver, w } = setup();
    const two = driver.load(2);
    w().emit({ type: 'progress', net: 'small', loaded: 30, total: 100 });
    w().loaded('large');
    expect(driver.progress).toBeCloseTo(0.27);
    expect(driver.state).toBe('loading');
    w().loaded('small');
    await two;
    expect(driver.progress).toBe(1);
  });

  it('a level 8–12 genmove loads the large net under the loading timer, not the search watchdog', async () => {
    vi.useFakeTimers();
    const { driver, w } = setup({ initTimeoutMs: 20_000, watchdogMs: 1000 });
    const r = driver.genmove(POS, 10);
    expect(w().of('load').map((m) => (m as Extract<ToWorker, { type: 'load' }>).net)).toEqual(['small', 'large']);
    w().loaded('small');
    expect(w().of('genmove')).toHaveLength(0);
    // A slow but working 11 MB download: 60 s of steady progress, far past the search's 10 s + 1 s.
    for (let s = 1; s <= 12; s++) {
      vi.advanceTimersByTime(5000);
      w().emit({ type: 'progress', net: 'large', loaded: s * 900_000, total: 11_138_361 });
    }
    expect(driver.state).toBe('ready');
    expect(w().terminated).toBe(false);
    expect(w().of('genmove')).toHaveLength(0);
    w().loaded('large');
    const g = w().last('genmove')!;
    expect(g).toMatchObject({ level: 10 });
    const loadLarge = w().sent.findIndex((m) => m.type === 'load' && m.net === 'large');
    expect(w().sent.indexOf(g)).toBeGreaterThan(loadLarge);
    w().emit({ type: 'result', id: g.id, result: { move: 'ee' } });
    await expect(r).resolves.toEqual({ move: 'ee' });
  });

  it('a large-net search waits in call order and holds back the small-net searches behind it', async () => {
    const { driver, w } = setup();
    void driver.load(1);
    w().loaded('small');
    const g = driver.genmove(POS, 9);
    const e = driver.evaluate(POS, {});
    expect(w().last('load')?.net).toBe('large');
    expect(w().of('genmove')).toHaveLength(0);
    expect(w().of('evaluate')).toHaveLength(0);
    w().loaded('large');
    const gm = w().last('genmove')!;
    expect(w().of('evaluate')).toHaveLength(0);
    w().emit({ type: 'result', id: gm.id, result: { move: 'cc' } });
    await expect(g).resolves.toEqual({ move: 'cc' });
    const ev = w().last('evaluate')!;
    w().emit({ type: 'result', id: ev.id, result: { winrate: 0.5, scoreLead: 0, ownership: new Float32Array(81), policy: new Float32Array(82) } });
    await expect(e).resolves.toMatchObject({ winrate: 0.5 });
  });

  it('an evaluate on the large net loads it first; a failed large net fails only that search', async () => {
    const { driver, w } = setup();
    void driver.load(1);
    w().loaded('small');
    const big = driver.evaluate(POS, { net: 'large', visits: 10 });
    const next = driver.analyze(POS, 2);
    expect(w().last('load')?.net).toBe('large');
    w().emit({ type: 'error', id: w().last('load')!.id, message: 'offline' });
    await expect(big).resolves.toBeNull();
    expect(driver.state).toBe('ready');
    const an = w().last('analyze')!;
    expect(an).toBeDefined();
    w().emit({ type: 'result', id: an.id, result: [] });
    await expect(next).resolves.toEqual([]);
    const g = driver.genmove(POS, 11);
    w().emit({ type: 'error', id: w().last('load')!.id, message: 'offline again' });
    await expect(g).rejects.toThrow('offline again');
    expect(driver.state).toBe('ready');
  });

  it('a search loads stage 1 itself and waits for it', async () => {
    const { driver, w } = setup();
    const r = driver.genmove(POS, 3);
    expect(w().last('load')?.net).toBe('small');
    expect(w().of('genmove')).toHaveLength(0);
    w().loaded('small');
    const g = w().last('genmove')!;
    expect(g).toMatchObject({ type: 'genmove', level: 3, opts: {} });
    w().emit({ type: 'result', id: g.id, result: { move: 'ee', winrate: 0.5, scoreLead: 0, candidates: [] } });
    await expect(r).resolves.toMatchObject({ move: 'ee' });
  });

  it('runs one search at a time, in call order', async () => {
    const { driver, w } = setup();
    void driver.load(1);
    w().loaded('small');
    const a = driver.evaluate(POS, {});
    const b = driver.analyze(POS, 3);
    expect(w().of('evaluate')).toHaveLength(1);
    expect(w().of('analyze')).toHaveLength(0);
    const ev = w().last('evaluate')!;
    w().emit({ type: 'result', id: ev.id, result: { winrate: 0.6, scoreLead: 1, ownership: new Float32Array(81), policy: new Float32Array(82) } });
    await expect(a).resolves.toMatchObject({ winrate: 0.6 });
    const an = w().last('analyze')!;
    expect(an).toMatchObject({ n: 3, opts: {} });
    w().emit({ type: 'result', id: an.id, result: [{ move: 'ee', winrate: 0.5, scoreLead: 0 }] });
    await expect(b).resolves.toEqual([{ move: 'ee', winrate: 0.5, scoreLead: 0 }]);
  });

  it('evaluate times out from the call, also while loading, and never rejects', async () => {
    vi.useFakeTimers();
    const { driver, w } = setup();
    const r = driver.evaluate(POS, {}, 100);
    vi.advanceTimersByTime(100);
    await expect(r).resolves.toBeNull();
    w().loaded('small');
    expect(w().of('evaluate')).toHaveLength(0);
  });

  it('a running evaluate that times out resolves null, is stopped, and the next search waits for its answer', async () => {
    vi.useFakeTimers();
    const { driver, w } = setup();
    void driver.load(1);
    w().loaded('small');
    const r = driver.evaluate(POS, { visits: 50 }, 150);
    const ev = w().last('evaluate')!;
    const next = driver.genmove(POS, 1);
    vi.advanceTimersByTime(150);
    await expect(r).resolves.toBeNull();
    expect(w().last('stop')).toEqual({ type: 'stop', id: ev.id });
    expect(w().of('genmove')).toHaveLength(0);
    w().emit({ type: 'result', id: ev.id, result: { winrate: 0.5, scoreLead: 0, ownership: new Float32Array(81), policy: new Float32Array(82) } });
    const g = w().last('genmove')!;
    w().emit({ type: 'result', id: g.id, result: { move: 'tt' } });
    await expect(next).resolves.toEqual({ move: 'tt' });
  });

  it('stop() settles everything: genmove and analyze reject with AbortError, evaluate resolves null', async () => {
    const { driver, w } = setup();
    void driver.load(1);
    w().loaded('small');
    const g = driver.genmove(POS, 5);
    const e = driver.evaluate(POS, {});
    const a = driver.analyze(POS, 1);
    const running = w().last('genmove')!;
    driver.stop();
    await expect(g).rejects.toSatisfy(isEngineAbort);
    await expect(e).resolves.toBeNull();
    await expect(a).rejects.toSatisfy(isEngineAbort);
    expect(w().last('stop')).toEqual({ type: 'stop', id: running.id });
    // The worker's late answer is ignored; the next search then runs.
    w().emit({ type: 'result', id: running.id, result: { move: 'ee' } });
    const later = driver.evaluate(POS, {});
    const ev = w().last('evaluate')!;
    w().emit({ type: 'result', id: ev.id, result: { winrate: 0.4, scoreLead: -1, ownership: new Float32Array(81), policy: new Float32Array(82) } });
    await expect(later).resolves.toMatchObject({ winrate: 0.4 });
  });

  it('a job error: evaluate resolves null, genmove rejects', async () => {
    const { driver, w } = setup();
    void driver.load(1);
    w().loaded('small');
    const e = driver.evaluate(POS, {});
    w().emit({ type: 'error', id: w().last('evaluate')!.id, message: 'boom' });
    await expect(e).resolves.toBeNull();
    const g = driver.genmove(POS, 2);
    w().emit({ type: 'error', id: w().last('genmove')!.id, message: 'boom' });
    await expect(g).rejects.toThrow('boom');
    expect(driver.state).toBe('ready');
  });

  it('fails on a worker error, settles pending searches, and retries with a new worker', async () => {
    const { driver, workers, w } = setup();
    const load = driver.load(1);
    const e = driver.evaluate(POS, {});
    const g = driver.genmove(POS, 1);
    workers[0].onerror?.({ message: 'crash' } as ErrorEvent);
    await expect(load).rejects.toThrow(/crash/);
    await expect(e).resolves.toBeNull();
    await expect(g).rejects.toMatchObject({ name: 'EngineUnavailableError' });
    expect(driver.state).toBe('failed');
    expect(workers[0].terminated).toBe(true);
    const again = driver.load(1);
    expect(workers).toHaveLength(2);
    w().loaded('small');
    await again;
    expect(driver.state).toBe('ready');
  });

  it('fails when a small-net load errors, and on a fatal worker error', async () => {
    const { driver, w } = setup();
    const load = driver.load(1);
    w().emit({ type: 'error', id: w().last('load')!.id, message: 'network download: 404' });
    await expect(load).rejects.toThrow('404');
    expect(driver.state).toBe('failed');
    const again = driver.load(1);
    w().emit({ type: 'error', id: null, message: 'No TF.js backend could start', fatal: true });
    await expect(again).rejects.toThrow('backend');
    expect(driver.state).toBe('failed');
  });

  it('a failed large-net load rejects stage 2 but keeps the engine ready', async () => {
    const { driver, w } = setup();
    void driver.load(1);
    w().loaded('small');
    const two = driver.load(2);
    w().emit({ type: 'error', id: w().last('load')!.id, message: 'offline' });
    await expect(two).rejects.toThrow('offline');
    expect(driver.state).toBe('ready');
    expect(driver.nets.large).toBe(false);
  });

  it('gives up loading when the worker shows no sign of life', async () => {
    vi.useFakeTimers();
    const { driver, w } = setup({ initTimeoutMs: 1000 });
    const load = driver.load(1);
    vi.advanceTimersByTime(900);
    w().emit({ type: 'progress', net: 'small', loaded: 1, total: 10 });
    vi.advanceTimersByTime(900);
    expect(driver.state).toBe('loading');
    vi.advanceTimersByTime(200);
    await expect(load).rejects.toThrow(/in time/);
    expect(driver.state).toBe('failed');
  });

  it('stops a hung search, then fails the engine', async () => {
    vi.useFakeTimers();
    const { driver, w } = setup({ watchdogMs: 1000 });
    void driver.load(1);
    w().loaded('small');
    const g = driver.genmove(POS, 1);
    const id = w().last('genmove')!.id;
    vi.advanceTimersByTime(10_000 + 1000);
    expect(w().last('stop')).toEqual({ type: 'stop', id });
    vi.advanceTimersByTime(3000);
    await expect(g).rejects.toMatchObject({ name: 'EngineUnavailableError' });
    expect(driver.state).toBe('failed');
  });

  it('dispose terminates the worker and refuses further work', async () => {
    const { driver, w } = setup();
    void driver.load(1);
    w().loaded('small');
    driver.dispose();
    expect(w().terminated).toBe(true);
    expect(driver.state).toBe('idle');
    await expect(driver.load(1)).rejects.toThrow(/disposed/);
    await expect(driver.evaluate(POS, {})).resolves.toBeNull();
  });

  it('passes genmove options and the clock through', async () => {
    const { driver, w } = setup();
    // Level 12 plays on the large net, so its search is sent once stage 2 is loaded.
    void driver.load(2);
    w().loaded('small');
    w().loaded('large');
    const clock = { tc: { kind: 'fischer' as const, baseMs: 60_000, incMs: 2000 }, left: { mainMs: 30_000, periodMs: 0, periods: 0 } };
    void driver.genmove(POS, 12, clock, { avoid: ['ee'], seed: 4 });
    expect(w().last('genmove')).toMatchObject({ level: 12, clock, opts: { avoid: ['ee'], seed: 4 } });
    await flush();
  });
});

describe('EngineDriver WebGPU beside WASM', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  const ev = (winrate: number) => ({ winrate, scoreLead: 1, policy: new Float32Array(82), ownership: new Float32Array(81) });

  /** Main worker with the small net, and the WebGPU worker started beside it. */
  function ready(opts: Parameters<typeof setup>[0] = {}) {
    const s = setup({ gpu: true, ...opts });
    void s.driver.load(1);
    s.workers[0].loaded('small');
    return { ...s, main: s.workers[0], gpu: () => s.workers[1] };
  }

  /** Answers both sides of the last warm-up: WASM's reference, then WebGPU's. Times in ms. */
  async function passWarm(main: FakeWorker, gpu: FakeWorker, o: { gpuWinrate?: number; gpuMs?: number; wasmMs?: number } = {}) {
    main.emit({ type: 'result', id: main.last('warm')!.id, result: { evaluation: ev(0.5), ms: o.wasmMs ?? 5 } });
    gpu.emit({ type: 'result', id: gpu.last('warm')!.id, result: { evaluation: ev(o.gpuWinrate ?? 0.5), ms: o.gpuMs ?? 1 } });
    await flush();
  }

  /** A first search (which starts the warm-up of its size) answered on WASM. */
  async function firstSearch(driver: EngineDriver, main: FakeWorker) {
    void driver.evaluate(POS, {});
    main.emit({ type: 'result', id: main.last('evaluate')!.id, result: ev(0.5) });
    await flush();
  }

  it('starts a WebGPU worker once the small net is in, and warms it for the size a search needs', async () => {
    const { driver, main, gpu, workers } = ready();
    expect(workers).toHaveLength(2);
    expect(gpu().sent[0]).toEqual({ type: 'init', base: 'https://example.test/zengo/', backend: 'webgpu' });
    const g = driver.genmove(POS, 1);
    // The search goes to WASM at once; the warm-up runs beside it on WebGPU.
    const gm = main.last('genmove')!;
    expect(gm).toBeDefined();
    expect(gpu().last('warm')).toMatchObject({ net: 'small', pos: { size: 9 } });
    expect(gpu().last('genmove')).toBeUndefined();
    main.emit({ type: 'result', id: gm.id, result: { move: 'ee', winrate: 0.5, scoreLead: 0 } });
    await expect(g).resolves.toMatchObject({ move: 'ee' });
    expect(driver.backend).not.toBe('webgpu');
  });

  it('a warm-up that agrees with WASM moves later searches of that size to WebGPU, and remembers it', async () => {
    const { driver, main, gpu, stored } = ready();
    await firstSearch(driver, main);
    await passWarm(main, gpu());
    expect(driver.backend).toBe('webgpu');
    expect(stored).toEqual(['webgpu']);
    const g = driver.genmove(POS, 1);
    const gm = gpu().last('genmove')!;
    expect(gm).toBeDefined();
    gpu().emit({ type: 'result', id: gm.id, result: { move: 'cc', winrate: 0.5, scoreLead: 0 } });
    await expect(g).resolves.toMatchObject({ move: 'cc' });
    // Another board size is warmed up first; meanwhile WASM plays it.
    const big = position(newGame(makeSettings(19)));
    void driver.genmove(big, 1);
    expect(main.of('genmove')).toHaveLength(1);
    expect(gpu().last('warm')).toMatchObject({ pos: { size: 19 } });
  });

  it('a warm-up that disagrees with WASM drops WebGPU for good', async () => {
    const { driver, main, gpu, stored } = ready();
    await firstSearch(driver, main);
    await passWarm(main, gpu(), { gpuWinrate: 0.9 });
    expect(gpu().terminated).toBe(true);
    expect(stored).toEqual(['wasm']);
    expect(driver.backend).toBe('wasm');
    void driver.genmove(POS, 1);
    expect(main.last('genmove')).toBeDefined();
  });

  it('a WebGPU search that fails goes back to WASM, and WebGPU is dropped for good', async () => {
    const { driver, main, gpu, stored, workers } = ready();
    await firstSearch(driver, main);
    await passWarm(main, gpu());
    const g = driver.genmove(POS, 1);
    gpu().emit({ type: 'error', id: gpu().last('genmove')!.id, message: 'GPU device lost' });
    expect(gpu().terminated).toBe(true);
    expect(stored).toEqual(['webgpu', 'wasm']);
    const gm = main.last('genmove')!;
    main.emit({ type: 'result', id: gm.id, result: { move: 'dd', winrate: 0.5, scoreLead: 0 } });
    await expect(g).resolves.toMatchObject({ move: 'dd' });
    expect(driver.state).toBe('ready');
    // Not started again on this page.
    void driver.genmove(position(newGame(makeSettings(13))), 1);
    expect(workers).toHaveLength(2);
  });

  it('a WebGPU worker crash or a fatal start error never fails the engine', async () => {
    const { driver, main, gpu, stored } = ready();
    const g = driver.genmove(POS, 1);
    gpu().emit({ type: 'error', id: null, message: 'WebGPU did not start', fatal: true });
    expect(gpu().terminated).toBe(true);
    expect(stored).toEqual(['wasm']);
    main.emit({ type: 'result', id: main.last('genmove')!.id, result: { move: 'ee', winrate: 0.5, scoreLead: 0 } });
    await expect(g).resolves.toMatchObject({ move: 'ee' });
    expect(driver.state).toBe('ready');
  });

  it('a hung WebGPU search is replayed on WASM after the shorter slack', async () => {
    vi.useFakeTimers();
    const { driver, main, gpu } = ready({ watchdogMs: 30_000, gpuWatchdogMs: 1000 });
    void driver.evaluate(POS, {});
    main.emit({ type: 'result', id: main.last('evaluate')!.id, result: ev(0.5) });
    await vi.advanceTimersByTimeAsync(0);
    main.emit({ type: 'result', id: main.last('warm')!.id, result: { evaluation: ev(0.5), ms: 5 } });
    gpu().emit({ type: 'result', id: gpu().last('warm')!.id, result: { evaluation: ev(0.5), ms: 1 } });
    await vi.advanceTimersByTimeAsync(0);
    const g = driver.genmove(POS, 1);
    expect(gpu().last('genmove')).toBeDefined();
    await vi.advanceTimersByTimeAsync(10_000 + 1000);
    expect(gpu().last('stop')).toBeDefined();
    await vi.advanceTimersByTimeAsync(3000);
    expect(gpu().terminated).toBe(true);
    const gm = main.last('genmove')!;
    main.emit({ type: 'result', id: gm.id, result: { move: 'cc', winrate: 0.5, scoreLead: 0 } });
    await expect(g).resolves.toMatchObject({ move: 'cc' });
  });

  it('a warm-up that takes too long drops WebGPU for this page only', () => {
    vi.useFakeTimers();
    const { driver, gpu, stored } = ready({ warmTimeoutMs: 5000 });
    void driver.genmove(POS, 1);
    vi.advanceTimersByTime(4999);
    expect(gpu().terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(gpu().terminated).toBe(true);
    expect(stored).toEqual([]);
  });

  it('routes by speed: WebGPU slower per call but faster per visit takes only the searches', async () => {
    const { driver, main, gpu } = ready();
    await firstSearch(driver, main);
    // One WebGPU call (8 rows) 12 ms, one WASM call 4 ms: 1.5 ms per row on WebGPU.
    await passWarm(main, gpu(), { gpuMs: 12, wasmMs: 4 });
    expect(driver.backend).toBe('webgpu');
    void driver.genmove(POS, 1);
    const single = main.last('genmove')!;
    expect(single).toBeDefined();
    expect(gpu().last('genmove')).toBeUndefined();
    main.emit({ type: 'result', id: single.id, result: { move: 'ee', winrate: 0.5, scoreLead: 0 } });
    await flush();
    void driver.analyze(POS, 3, { visits: 32 });
    expect(gpu().last('analyze')).toBeDefined();
    expect(main.last('analyze')).toBeUndefined();
  });

  it('a WebGPU slower even per visit takes nothing', async () => {
    const { driver, main, gpu } = ready();
    await firstSearch(driver, main);
    await passWarm(main, gpu(), { gpuMs: 270, wasmMs: 5 });
    expect(driver.backend).not.toBe('webgpu');
    void driver.analyze(POS, 3, { visits: 32 });
    expect(main.last('analyze')).toBeDefined();
    expect(gpu().last('analyze')).toBeUndefined();
  });

  it('a device where WebGPU failed before starts no WebGPU worker', () => {
    const { workers } = ready({ remembered: 'wasm' });
    expect(workers).toHaveLength(1);
  });

  it('the large net is warmed up only once it is on the device', async () => {
    const { driver, main, gpu } = ready();
    void driver.genmove(POS, 12);
    expect(main.last('load')).toMatchObject({ net: 'large' });
    expect(gpu().last('warm')).toBeUndefined();

    main.loaded('large');
    expect(gpu().last('warm')).toMatchObject({ net: 'large', pos: { size: 9 } });
    await flush();
  });
});

describe('EngineDriver snapshot', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('is a new frozen object after each change', () => {
    const a = s.driver.getSnapshot();
    void s.driver.load(1);
    const b = s.driver.getSnapshot();
    expect(b).not.toBe(a);
    expect(Object.isFrozen(b)).toBe(true);
    expect(s.driver.getSnapshot()).toBe(b);
  });
});
