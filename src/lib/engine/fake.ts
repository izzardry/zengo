/**
 * FakeEngine: a deterministic Go `EngineApi` (plus the `EngineHandle` extras) for tests.
 *
 * - `load(1)`: idle → loading (progress 0, then 0.5) → ready (1) after `loadMs` (0 = microtasks);
 *   then `nets.small` is true and `backend` is set (`wasm` unless `backend` is given). `load(2)`
 *   loads stage 1 first, then sets `nets.large`. With `loadResult: 'fail'` loading ends in `failed`
 *   and rejects; a later `load()` tries again (call `setLoadResult('ready')` first).
 * - Searches load stage 1 lazily, as the real engine does, and take `delayMs` (0 = microtasks only).
 * - `genmove`: the scripted move (`moves`), else the first legal point (row-major from the top)
 *   that does not fill one of the mover's own one-point eyes and is not in `opts.avoid`, else `tt`
 *   (pass). It resolves with `move` only (no win rate or candidates).
 * - `evaluate`: the scripted evaluation (`evals`; `null` there simulates no answer), else neutral:
 *   win rate 0.5, score lead 0, ownership all 0, policy uniform over the legal points and pass.
 *   Resolves null when `delayMs > timeoutMs`, after `timeoutMs`.
 * - `analyze`: the scripted list (`analysis`), else the first `n` points `genmove` would consider,
 *   each with win rate 0.5 and score lead 0.
 * - `stop()`: pending `genmove` / `analyze` reject with an `AbortError`; pending `evaluate` resolve null.
 * - `calls` records every call; `stops` counts `stop()` calls.
 *
 * Scripted records are keyed by `movesKey(pos)`: the plies applied so far joined (`ddeett…`, `''`
 * at the start). The function forms receive the whole position.
 */
import type { ClockInfo, Color, EngineApi, EngineGenmoveOptions, EngineState, Point, Position } from '../types';
import { PASS, indexToPoint, isLegal, isPass } from '../zigo';
import { gameFromPosition } from './position';
import { EngineAbortError, EngineUnavailableError, type EngineHandle, type EngineSnapshot } from './handle';

export type GenmoveResult = Point | 'resign';

/** What `evaluate` resolves with. */
export interface EvaluateResult {
  readonly winrate: number;
  readonly scoreLead: number;
  readonly ownership: Float32Array;
  readonly policy: Float32Array;
}

/** A scripted evaluation; missing arrays are filled with the neutral ones. */
export type FakeEval = { readonly winrate: number; readonly scoreLead: number; readonly ownership?: Float32Array; readonly policy?: Float32Array };

/** One candidate of `analyze`. */
export interface Candidate {
  readonly move: Point;
  readonly winrate: number;
  readonly scoreLead: number;
}

export type EvaluateOptions = Parameters<EngineApi['evaluate']>[1];

export type FakeMoves = Readonly<Record<string, GenmoveResult>> | ((pos: Position, level: number) => GenmoveResult | undefined);
export type FakeEvals = Readonly<Record<string, FakeEval | null>> | ((pos: Position, opts: EvaluateOptions) => FakeEval | null | undefined);
export type FakeAnalysis = (pos: Position, n: number) => Candidate[] | undefined;

export interface FakeEngineOptions {
  loadResult?: 'ready' | 'fail';
  loadMs?: number;
  delayMs?: number;
  /** Backend reported after loading. Default `wasm`. */
  backend?: 'webgpu' | 'wasm';
  moves?: FakeMoves;
  evals?: FakeEvals;
  analysis?: FakeAnalysis;
}

export type FakeCall =
  | { method: 'load'; args: [stage: 1 | 2] }
  | { method: 'genmove'; args: [pos: Position, level: number, clock?: ClockInfo, opts?: EngineGenmoveOptions] }
  | { method: 'evaluate'; args: [pos: Position, opts: EvaluateOptions, timeoutMs?: number] }
  | { method: 'analyze'; args: [pos: Position, n: number] };

/** Key of a position in the scripted records: its plies joined, `''` at the start. */
export function movesKey(pos: Position): string {
  return pos.moves.join('');
}

export { gameFromPosition };

/** True when `idx` is empty and every neighbour on the board is a stone of `color`. */
function ownEye(board: Uint8Array, size: number, idx: number, color: Color): boolean {
  if (board[idx] !== 0) return false;
  const mine = color === 'B' ? 1 : 2;
  const x = idx % size;
  const y = (idx - x) / size;
  const n = [x > 0 ? idx - 1 : -1, x < size - 1 ? idx + 1 : -1, y > 0 ? idx - size : -1, y < size - 1 ? idx + size : -1];
  return n.every((j) => j < 0 || board[j] === mine);
}

/** Legal points of the side to move, row-major from the top, that do not fill its own one-point eyes. */
export function sensiblePoints(pos: Position): Point[] {
  const g = gameFromPosition(pos);
  if (g.end || g.scoring) return [];
  const size = pos.size;
  const out: Point[] = [];
  for (let i = 0; i < size * size; i++) {
    if (g.board[i] !== 0 || ownEye(g.board, size, i, g.turn)) continue;
    const p = indexToPoint(i, size);
    if (isLegal(g, p)) out.push(p);
  }
  return out;
}

/** Neutral evaluation: even game, nobody owns anything, policy uniform over the legal points and pass. */
export function neutralEval(pos: Position): EvaluateResult {
  const n = pos.size * pos.size;
  const policy = new Float32Array(n + 1);
  const g = gameFromPosition(pos);
  const legal: number[] = [];
  if (!g.end && !g.scoring) for (let i = 0; i < n; i++) if (g.board[i] === 0 && isLegal(g, indexToPoint(i, pos.size))) legal.push(i);
  const share = 1 / (legal.length + 1);
  for (const i of legal) policy[i] = share;
  policy[n] = share;
  return { winrate: 0.5, scoreLead: 0, ownership: new Float32Array(n), policy };
}

interface Pending {
  abort(): void;
}

const NO_NETS = Object.freeze({ small: false, large: false });

export class FakeEngine implements EngineHandle {
  readonly calls: FakeCall[] = [];
  stops = 0;

  private snapshot: EngineSnapshot = Object.freeze({ state: 'idle', progress: 0, backend: null, nets: NO_NETS });
  private readonly listeners = new Set<() => void>();
  private loadPromise: Promise<void> | null = null;
  private readonly pending = new Set<Pending>();
  private loadResult: 'ready' | 'fail';
  private disposed = false;
  private readonly opts: FakeEngineOptions;

  constructor(opts: FakeEngineOptions = {}) {
    this.opts = opts;
    this.loadResult = opts.loadResult ?? 'ready';
  }

  get state(): EngineState {
    return this.snapshot.state;
  }

  get progress(): number {
    return this.snapshot.progress;
  }

  get backend(): EngineApi['backend'] {
    return this.snapshot.backend;
  }

  get nets(): EngineApi['nets'] {
    return this.snapshot.nets;
  }

  /** Change what the next `load()` does. */
  setLoadResult(r: 'ready' | 'fail'): void {
    this.loadResult = r;
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
    const s = this.snapshot;
    if (
      next.state === s.state &&
      next.progress === s.progress &&
      next.backend === s.backend &&
      next.nets.small === s.nets.small &&
      next.nets.large === s.nets.large
    )
      return;
    this.snapshot = Object.freeze({ ...next, nets: Object.freeze({ ...next.nets }) });
    for (const cb of [...this.listeners]) cb();
  }

  private wait(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  readonly load = (stage: 1 | 2 = 1): Promise<void> => {
    this.calls.push({ method: 'load', args: [stage] });
    const first = this.ensureLoaded();
    if (stage === 1) return first;
    return first.then(() => {
      if (!this.snapshot.nets.large) this.set({ nets: { small: true, large: true } });
    });
  };

  private ensureLoaded(): Promise<void> {
    if (this.disposed) return Promise.reject(new EngineUnavailableError('Engine disposed'));
    if (this.snapshot.state === 'ready') return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.set({ state: 'loading', progress: 0 });
    const ms = this.opts.loadMs ?? 0;
    this.loadPromise = (async () => {
      await this.wait(ms / 2);
      this.set({ progress: 0.5 });
      await this.wait(ms / 2);
      this.loadPromise = null;
      if (this.loadResult === 'fail') {
        this.set({ state: 'failed', progress: 0 });
        throw new EngineUnavailableError('Fake engine failed to load');
      }
      this.set({
        state: 'ready',
        progress: 1,
        backend: this.opts.backend ?? 'wasm',
        nets: { small: true, large: this.snapshot.nets.large },
      });
    })();
    return this.loadPromise;
  }

  /**
   * Runs `fn` after loading and `delayMs`, unless `stop()` comes first (then `onAbort`), the timeout
   * fires (then `onTimeout`) or loading fails (then `onFail`, else the load error rejects).
   */
  private search<T>(
    fn: () => T,
    onAbort: () => T,
    o: { timeoutMs?: number; onTimeout?: () => T; onFail?: () => T } = {},
  ): Promise<T> {
    const { timeoutMs, onTimeout, onFail } = o;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (f: () => T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending.delete(entry);
        try {
          resolve(f());
        } catch (e) {
          reject(e);
        }
      };
      const entry: Pending = { abort: () => settle(onAbort) };
      this.pending.add(entry);
      if (timeoutMs !== undefined && onTimeout) timer = setTimeout(() => settle(onTimeout), Math.max(0, timeoutMs));
      this.ensureLoaded()
        .then(() => this.wait(this.opts.delayMs ?? 0))
        .then(
          () => settle(fn),
          (err) => {
            if (done) return;
            if (onFail) return settle(onFail);
            done = true;
            clearTimeout(timer);
            this.pending.delete(entry);
            reject(err);
          },
        );
    });
  }

  readonly genmove = (pos: Position, level: number, clock?: ClockInfo, opts?: EngineGenmoveOptions): Promise<{ move: GenmoveResult }> => {
    this.calls.push({ method: 'genmove', args: opts ? [pos, level, clock, opts] : clock ? [pos, level, clock] : [pos, level] });
    return this.search(
      () => {
        const m = this.opts.moves;
        const scripted = m ? (typeof m === 'function' ? m(pos, level) : lookup(m, movesKey(pos))) : undefined;
        if (scripted !== undefined) return { move: scripted };
        const avoid = new Set(opts?.avoid ?? []);
        return { move: sensiblePoints(pos).find((p) => !avoid.has(p)) ?? PASS };
      },
      () => {
        throw new EngineAbortError();
      },
    );
  };

  readonly evaluate = (pos: Position, opts: EvaluateOptions, timeoutMs?: number): Promise<EvaluateResult | null> => {
    this.calls.push({ method: 'evaluate', args: timeoutMs === undefined ? [pos, opts] : [pos, opts, timeoutMs] });
    return this.search(
      () => {
        const e = this.opts.evals;
        const s = e ? (typeof e === 'function' ? e(pos, opts) : lookup(e, movesKey(pos))) : undefined;
        if (s === null) return null;
        const neutral = neutralEval(pos);
        if (s === undefined) return neutral;
        return {
          winrate: s.winrate,
          scoreLead: s.scoreLead,
          ownership: s.ownership ?? neutral.ownership,
          policy: s.policy ?? neutral.policy,
        };
      },
      () => null,
      { timeoutMs, onTimeout: () => null, onFail: () => null },
    );
  };

  readonly analyze = (pos: Position, n: number): Promise<Candidate[]> => {
    this.calls.push({ method: 'analyze', args: [pos, n] });
    return this.search(
      () => {
        const scripted = this.opts.analysis?.(pos, n);
        if (scripted) return scripted.slice(0, Math.max(0, n));
        return sensiblePoints(pos)
          .slice(0, Math.max(0, n))
          .map((move) => ({ move, winrate: 0.5, scoreLead: 0 }));
      },
      () => {
        throw new EngineAbortError();
      },
    );
  };

  readonly stop = (): void => {
    this.stops++;
    for (const p of [...this.pending]) p.abort();
  };

  readonly dispose = (): void => {
    this.stop();
    this.disposed = true;
    this.set({ state: 'idle', progress: 0, backend: null, nets: NO_NETS });
    this.listeners.clear();
  };
}

function lookup<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** True for a pass result of `genmove`. */
export function isPassMove(m: GenmoveResult): boolean {
  return m !== 'resign' && isPass(m);
}
