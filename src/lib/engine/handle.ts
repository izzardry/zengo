/**
 * What every engine implementation shares beyond `EngineApi` (src/lib/types.ts): the snapshot a
 * React hook subscribes to, and the two errors a search can end with.
 *
 * Implemented by `FakeEngine` (./fake.ts) now and by the KataGo worker driver of package 2A
 * (`hooks/useZengoEngine`). Framework-free.
 */
import type { EngineApi, EngineState } from '../types';

/** Immutable view of an engine's lifecycle, a new object after each change (`useSyncExternalStore`). */
export interface EngineSnapshot {
  readonly state: EngineState;
  /** 0..1 while loading. */
  readonly progress: number;
  readonly backend: EngineApi['backend'];
  readonly nets: EngineApi['nets'];
}

/** `EngineApi` plus what a React hook needs to subscribe to state changes. */
export interface EngineHandle extends EngineApi {
  /** Called after every change of the snapshot. Returns the unsubscribe function. */
  subscribe(cb: () => void): () => void;
  getSnapshot(): EngineSnapshot;
  /** Stop, release the worker and refuse further work. */
  dispose(): void;
}

/** Rejection of `genmove` / `analyze` cancelled by `stop()`. */
export class EngineAbortError extends Error {
  constructor(message = 'Engine search stopped') {
    super(message);
    this.name = 'AbortError';
  }
}

/** Rejection when the engine cannot be loaded or crashed. */
export class EngineUnavailableError extends Error {
  constructor(message = 'Engine unavailable') {
    super(message);
    this.name = 'EngineUnavailableError';
  }
}

/** True for the rejection a `stop()` causes. */
export function isEngineAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}
