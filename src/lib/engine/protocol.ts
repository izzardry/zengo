/**
 * Messages between the page (`EngineDriver`, ./driver.ts) and the engine worker
 * (`src/workers/engine.worker.ts`). Plain structured-clone data.
 */
import type { ClockInfo, EngineEvaluation, EngineGenmoveOptions, EngineNet, EngineSearchOptions, Position } from '../types';
import { ENGINE_STAGES, LARGE_NET_PATH, SMALL_NET_PATH } from './offline';

export type EngineBackendChoice = 'webgpu' | 'wasm';

/** Paths of the networks relative to the app's base URL (served from `public/`). */
export const NET_PATHS: Readonly<Record<EngineNet, string>> = Object.freeze({ small: SMALL_NET_PATH, large: LARGE_NET_PATH });

/** Compressed sizes of the shipped networks, for progress when no Content-Length arrives. */
export const NET_BYTES: Readonly<Record<EngineNet, number>> = Object.freeze({
  small: ENGINE_STAGES[1].find((a) => a.path === SMALL_NET_PATH)?.bytes ?? 3_827_339,
  large: ENGINE_STAGES[2].find((a) => a.path === LARGE_NET_PATH)?.bytes ?? 11_138_361,
});

/** Folder of the TF.js WASM binaries relative to the base URL. */
export const TFJS_WASM_DIR = 'engine/tfjs/';

export type ToWorker =
  /**
   * First message. `base` is `document.baseURI` (the worker resolves `engine/…` against it);
   * `backend` is the backend this worker runs on; a WebGPU worker that cannot start fails fatally.
   */
  | { readonly type: 'init'; readonly base: string; readonly backend: EngineBackendChoice }
  | { readonly type: 'load'; readonly id: number; readonly net: EngineNet }
  | { readonly type: 'evaluate'; readonly id: number; readonly pos: Position; readonly opts: EngineSearchOptions }
  | { readonly type: 'analyze'; readonly id: number; readonly pos: Position; readonly n: number; readonly opts: EngineSearchOptions }
  | {
      readonly type: 'genmove';
      readonly id: number;
      readonly pos: Position;
      readonly level: number;
      readonly clock?: ClockInfo;
      readonly opts: EngineGenmoveOptions;
    }
  /**
   * Gets `net` ready for `pos`'s board size (WebGPU: compiles its shaders) and answers with a
   * `WarmResult`: the evaluation of `pos`, which the page compares between workers, and the time of
   * one warm network call.
   */
  | { readonly type: 'warm'; readonly id: number; readonly pos: Position; readonly net: EngineNet }
  /** Ends job `id` early: a search returns what it has, a queued job is answered with an error. */
  | { readonly type: 'stop'; readonly id: number };

export type FromWorker =
  /** Download progress of a network, compressed bytes. */
  | { readonly type: 'progress'; readonly net: EngineNet; readonly loaded: number; readonly total: number }
  /** A network is loaded and built. */
  | { readonly type: 'net'; readonly net: EngineNet }
  /**
   * The backend this worker runs on (`note` 'cpu' when WASM could not start). `decided` is unused
   * by the workers now; the page decides about WebGPU itself.
   */
  | { readonly type: 'backend'; readonly backend: EngineBackendChoice; readonly decided: boolean; readonly note?: string }
  | { readonly type: 'result'; readonly id: number; readonly result: unknown }
  /** A job failed (`id`), or the worker cannot run at all (`id` null, `fatal`). */
  | { readonly type: 'error'; readonly id: number | null; readonly message: string; readonly fatal?: boolean };

/** The answer to `warm`. */
export interface WarmResult {
  readonly evaluation: EngineEvaluation;
  /** One warm network call on this worker (WebGPU: a padded batch of 8 rows), ms. */
  readonly ms: number;
}
