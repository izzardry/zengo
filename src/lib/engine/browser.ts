/**
 * The engine in the browser: `EngineDriver` over the module worker that Vite bundles as its own chunk
 * (src/workers/engine.worker.ts), with the backend remembered in `zigo:engine-backend`.
 */
import { readEngineBackend, store, writeEngineBackend } from '@/lib/storage';
import { EngineDriver, type WorkerLike } from './driver';

export function createBrowserEngine(): EngineDriver {
  return new EngineDriver({
    createWorker: () =>
      new Worker(new URL('../../workers/engine.worker.ts', import.meta.url), { type: 'module', name: 'zigo-engine' }) as unknown as WorkerLike,
    base: () => document.baseURI,
    storage: {
      get: () => readEngineBackend(store),
      set: (b) => writeEngineBackend(store, b),
    },
  });
}
