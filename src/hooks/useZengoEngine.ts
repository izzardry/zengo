/**
 * `useZengoEngine`: React access to the one shared engine worker (DESIGN 10.1).
 *
 * The computer opponent, the hint, the blunder guard and the scoring proposal all call this hook and
 * get the same engine, so there is only ever one worker and one search queue. Nothing is fetched
 * until the first `load()` or search. The returned object changes identity when the engine's
 * snapshot (state, progress, backend, nets) changes; its methods are stable.
 *
 * Tests (and the integrator) can replace the shared engine with `setSharedEngine(new FakeEngine())`
 * or pass an engine to the hook directly.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { EngineApi } from '@/lib/types';
import type { EngineHandle } from '@/lib/engine/handle';
import { createBrowserEngine } from '@/lib/engine/browser';

let shared: EngineHandle | null = null;

/** The app-wide engine, created on first use (no worker is started until it is used). */
export function sharedEngine(): EngineHandle {
  if (!shared) shared = createBrowserEngine();
  return shared;
}

/**
 * Replace the shared engine (tests, or a different engine). Pass null to go back to the browser
 * engine on next use. The previous engine is not disposed; that is the caller's choice.
 */
export function setSharedEngine(engine: EngineHandle | null): void {
  shared = engine;
}

/** The shared engine as `EngineApi`, re-rendering on snapshot changes. */
export function useZengoEngine(engine?: EngineHandle): EngineApi {
  const e = engine ?? sharedEngine();
  const methods = useMemo(
    () => ({
      subscribe: (cb: () => void) => e.subscribe(cb),
      getSnapshot: () => e.getSnapshot(),
      load: (stage: 1 | 2) => e.load(stage),
      genmove: (...a: Parameters<EngineApi['genmove']>) => e.genmove(...a),
      evaluate: (...a: Parameters<EngineApi['evaluate']>) => e.evaluate(...a),
      analyze: (...a: Parameters<EngineApi['analyze']>) => e.analyze(...a),
      stop: () => e.stop(),
    }),
    [e],
  );
  const snap = useSyncExternalStore(methods.subscribe, methods.getSnapshot, methods.getSnapshot);
  return useMemo<EngineApi>(
    () => ({
      state: snap.state,
      progress: snap.progress,
      backend: snap.backend,
      nets: snap.nets,
      load: methods.load,
      genmove: methods.genmove,
      evaluate: methods.evaluate,
      analyze: methods.analyze,
      stop: methods.stop,
    }),
    [methods, snap],
  );
}
