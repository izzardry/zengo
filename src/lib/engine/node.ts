/**
 * The Zigo engine in Node (golden test, `scripts/selfplay.mjs`, `scripts/calibrate.mjs`): the same
 * KataGo port as the browser worker, with TF.js on its WASM backend (default) or its CPU backend,
 * the networks read from `public/engine/nets/`.
 *
 * Plain Node 26 runs it from a `.mjs` script without a build step (type stripping; every import in
 * the engine's graph has an explicit `.ts` extension and no `@/` alias):
 *
 *   import { createNodeEngine } from '../src/lib/engine/node.ts';
 *   const engine = await createNodeEngine({ backend: 'wasm' });
 *   const { move } = await engine.genmove(position, 5);
 *
 * Run with `node scripts/selfplay.mjs` (Node ≥ 23.6; no flags). One engine per process: the board
 * size is module state in the port. Searches run one at a time.
 */
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClockInfo, Position } from '../types.ts';
import { KataEngine, type EngineCandidate, type EngineEvaluation, type GenmoveInfo, type GenmoveOptions, type NetKind, type SearchOptions } from './katago/engine.ts';
import { parseModel } from './katago/loadModel.ts';
import { KataModel } from './katago/model.ts';
import { NetRunner } from './katago/net.ts';

export type NodeBackend = 'wasm' | 'cpu';

/** Paths of the shipped networks. */
const NETS_DIR = resolve(dirname(fileURLToPath(String(import.meta.url))), '../../../public/engine/nets');
export const NODE_NET_PATHS: Readonly<Record<NetKind, string>> = Object.freeze({
  small: resolve(NETS_DIR, 'g170-b6c96-s175395328-d26788732.bin.gz'),
  large: resolve(NETS_DIR, 'g170e-b10c128-s1141046784-d204142634.bin.gz'),
});

export interface NodeEngineOptions {
  /** TF.js backend. Default `wasm`; falls back to `cpu` when WASM cannot start. */
  backend?: NodeBackend;
  /** Network files (`.bin.gz` or `.bin`). Default `NODE_NET_PATHS`. */
  nets?: Partial<Record<NetKind, string>>;
  /** Leaves per network call in searches. Default 1. */
  batchSize?: number;
}

export interface NodeEngine {
  /** The TF.js backend in use. */
  readonly backend: NodeBackend;
  /** Loads a network now (otherwise it loads on first use). */
  load(net: NetKind): Promise<void>;
  genmove(pos: Position, level: number, clock?: ClockInfo, opts?: GenmoveOptions): Promise<GenmoveInfo>;
  evaluate(pos: Position, opts?: SearchOptions): Promise<EngineEvaluation>;
  analyze(pos: Position, n: number, opts?: SearchOptions): Promise<EngineCandidate[]>;
  /** Ends the running search early (it returns what it has). */
  stop(): void;
  dispose(): Promise<void>;
}

let tfReady: Promise<NodeBackend> | null = null;

async function initTf(backend: NodeBackend): Promise<NodeBackend> {
  const tf = await import('@tensorflow/tfjs-core');
  await import('@tensorflow/tfjs-backend-cpu');
  if (backend === 'wasm') {
    try {
      await import('@tensorflow/tfjs-backend-wasm');
      if (await tf.setBackend('wasm')) {
        await tf.ready();
        return 'wasm';
      }
    } catch {
      /* fall through to cpu */
    }
  }
  await tf.setBackend('cpu');
  await tf.ready();
  return 'cpu';
}

/** Reads, inflates and builds a network. */
export async function loadNodeNet(path: string): Promise<KataModel> {
  const bytes = new Uint8Array(await readFile(path));
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? new Uint8Array(gunzipSync(bytes)) : bytes;
  return new KataModel(parseModel(raw));
}

export async function createNodeEngine(opts: NodeEngineOptions = {}): Promise<NodeEngine> {
  if (!tfReady) {
    // TF.js warns once that tfjs-node would be faster; that is not an option here (no native build).
    const warn = console.warn;
    const log = console.log;
    console.warn = console.log = () => undefined;
    tfReady = initTf(opts.backend ?? 'wasm').finally(() => {
      console.warn = warn;
      console.log = log;
    });
  }
  const backend = await tfReady;
  const paths = { ...NODE_NET_PATHS, ...opts.nets };
  const nets = new Map<NetKind, Promise<NetRunner>>();
  const getNet = (kind: NetKind): Promise<NetRunner> => {
    let p = nets.get(kind);
    if (!p) {
      p = loadNodeNet(paths[kind]).then((m) => new NetRunner(m));
      nets.set(kind, p);
    }
    return p;
  };
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  const ctl = { stopped: () => stopped, yieldNow: () => new Promise<void>((r) => setImmediate(r)) };
  const engine = new KataEngine({ getNet, batchSize: () => opts.batchSize ?? 1 });
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const run = queue.then(() => {
      stopped = false;
      return f();
    });
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    backend,
    load: (net) => getNet(net).then(() => undefined),
    genmove: (pos, level, clock, o = {}) => serial(() => engine.genmove(pos, level, clock, o, ctl)),
    evaluate: (pos, o = {}) => serial(() => engine.evaluate(pos, o, ctl)),
    analyze: (pos, n, o = {}) => serial(() => engine.analyze(pos, n, o, ctl)),
    stop: () => {
      stopped = true;
    },
    dispose: async () => {
      for (const p of nets.values()) (await p.catch(() => null))?.model.dispose();
      nets.clear();
    },
  };
}
