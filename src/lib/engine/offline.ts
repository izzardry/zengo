/**
 * Offline copy of the engine assets (DESIGN 14), in two stages:
 *
 * 1. Stage 1, on the first launch: the TF.js WASM backends and the 6-block net (b6c96), about 4.6 MB.
 * 2. Stage 2, on demand: the 10-block net (b10c128), 11 MB, for levels 8–12.
 *
 * The page downloads the files itself, with progress, into `engine-cache`; the service worker's
 * CacheFirst route for `engine/*.js|wasm|gz` (vite.config.ts) then answers the engine's requests
 * from that cache, also offline. The page downloads them rather than the precache because a page
 * cannot see the progress of a service worker install.
 *
 * Every download is checked before it is cached: a 200 with `text/html` (the preview's SPA fallback
 * answers a missing file that way) or a body without the expected magic bytes (`\0asm` for WASM,
 * `1f 8b` for gzip) fails the stage, and nothing of that stage is stored.
 *
 * The engine worker and the TF.js backends' JavaScript are ordinary build chunks under `assets/`,
 * which the service worker precaches with the app shell; only the WASM binaries and the networks
 * live here. The worker reads the networks from `engine-cache` itself (src/workers/engine.worker.ts).
 *
 * A stage's files reach `engine-cache` only when the whole stage is downloaded, so the engine must
 * not load a stage while the page downloads it, or the worker fetches the same files a second time.
 * `runningDownload(stage)` exposes the download in flight (its percent and a promise of its end) so
 * the Start pill can wait for it (`useEngineStart` in hooks/useComputer.ts).
 *
 * Framework-free; `hooks/useEngineOffline.ts` drives it.
 */

/** Runtime cache shared with the service worker route in vite.config.ts. */
export const ENGINE_CACHE = 'engine-cache';

export type EngineStage = 1 | 2;

/** What a file must start with. */
export type AssetKind = 'wasm' | 'gzip';

export interface EngineAsset {
  /** Path relative to the app's base URL. */
  readonly path: string;
  /** Size of the shipped file, for progress when the server sends no usable Content-Length. */
  readonly bytes: number;
  readonly kind: AssetKind;
}

/** The small net (stage 1, levels 1–7, guard, hints, scoring proposal). */
export const SMALL_NET_PATH = 'engine/nets/g170-b6c96-s175395328-d26788732.bin.gz';
/** The large net (stage 2, levels 8–12). */
export const LARGE_NET_PATH = 'engine/nets/g170e-b10c128-s1141046784-d204142634.bin.gz';

/**
 * Files per stage. The TF.js `threaded-simd` backend is left out: it needs SharedArrayBuffer, which
 * needs COOP/COEP headers that GitHub Pages cannot send, so TF.js never requests it there.
 */
export const ENGINE_STAGES: Readonly<Record<EngineStage, readonly EngineAsset[]>> = Object.freeze({
  1: Object.freeze([
    { path: 'engine/tfjs/tfjs-backend-wasm.wasm', bytes: 311_123, kind: 'wasm' },
    { path: 'engine/tfjs/tfjs-backend-wasm-simd.wasm', bytes: 424_594, kind: 'wasm' },
    { path: SMALL_NET_PATH, bytes: 3_827_339, kind: 'gzip' },
  ] as const),
  2: Object.freeze([{ path: LARGE_NET_PATH, bytes: 11_138_361, kind: 'gzip' }] as const),
});

/** Content types stored with each kind (the body is stored as downloaded, never re-encoded). */
const CONTENT_TYPE: Record<AssetKind, string> = { wasm: 'application/wasm', gzip: 'application/gzip' };

const MAGIC: Record<AssetKind, readonly number[]> = { wasm: [0x00, 0x61, 0x73, 0x6d], gzip: [0x1f, 0x8b] };

/** State of one stage for the start screen. */
export type EngineOfflineStatus =
  /** No Cache Storage or service worker, or the computer is switched off: nothing to show. */
  | { readonly status: 'unsupported' }
  | { readonly status: 'checking' }
  | { readonly status: 'downloading'; readonly percent: number }
  | { readonly status: 'ready' }
  /**
   * Not cached. `idle`: not requested yet (stage 2 before a level 8–12 is chosen); `offline`: waits
   * for a connection; `failed`: tap to retry; `saveData`: tap to download.
   */
  | { readonly status: 'missing'; readonly reason: 'idle' | 'offline' | 'failed' | 'saveData' };

export interface EngineOfflineDeps {
  caches?: CacheStorage;
  fetch?: typeof fetch;
}

/** Why a download was refused before caching. */
export class EngineAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineAssetError';
  }
}

function urls(stage: EngineStage, base: string): string[] {
  return ENGINE_STAGES[stage].map((a) => new URL(a.path, base).href);
}

/** Every file of `stage` is in `engine-cache`. */
export async function isStageCached(stage: EngineStage, base: string, deps: EngineOfflineDeps = {}): Promise<boolean> {
  const store = deps.caches ?? globalThis.caches;
  if (!store) return false;
  const cache = await store.open(ENGINE_CACHE);
  const hits = await Promise.all(urls(stage, base).map((u) => cache.match(u)));
  return hits.every(Boolean);
}

/**
 * Throws `EngineAssetError` unless the response and body look like a real `kind` file: not HTML, and
 * starting with the kind's magic bytes.
 */
export function checkAsset(kind: AssetKind, contentType: string | null, body: Uint8Array, url = ''): void {
  if (contentType && /^\s*text\/html/i.test(contentType)) throw new EngineAssetError(`engine download: HTML instead of ${kind} for ${url}`);
  const magic = MAGIC[kind];
  if (body.byteLength < magic.length || magic.some((b, i) => body[i] !== b))
    throw new EngineAssetError(`engine download: ${url} is not a ${kind} file`);
}

/** A stage download in flight (`runningDownload`). */
export interface StageDownload {
  readonly stage: EngineStage;
  /** 0–99 while it runs, as the status line shows it. */
  readonly percent: number;
  /** Resolves true once the stage is in `engine-cache`, false when the download failed or was aborted. Never rejects. */
  readonly done: Promise<boolean>;
}

const running = new Map<EngineStage, StageDownload>();
const runningListeners = new Set<() => void>();

function notifyRunning(): void {
  for (const cb of [...runningListeners]) cb();
}

/** The download of `stage` the page is running now, or null. */
export function runningDownload(stage: EngineStage): StageDownload | null {
  return running.get(stage) ?? null;
}

/** Called whenever a stage download starts, reports progress or ends. Returns the unsubscribe. */
export function subscribeRunningDownloads(cb: () => void): () => void {
  runningListeners.add(cb);
  return () => {
    runningListeners.delete(cb);
  };
}

/**
 * Downloads every file of `stage` into `engine-cache`, reporting 0–100. Rejects on a network error,
 * a non-200 response, a file that fails `checkAsset`, or an abort; nothing of the stage is stored then.
 * While it runs, `runningDownload(stage)` returns it. Its `done` settles after the promise returned
 * here, so a caller's own `.then` on this promise runs before anyone waiting on `done` resumes.
 */
export function downloadStage(
  stage: EngineStage,
  base: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
  deps: EngineOfflineDeps = {},
): Promise<void> {
  const entry: { stage: EngineStage; percent: number; done: Promise<boolean> } = { stage, percent: 0, done: Promise.resolve(false) };
  const p = fetchStage(
    stage,
    base,
    (percent) => {
      entry.percent = percent;
      if (running.get(stage) === entry) notifyRunning();
      onProgress(percent);
    },
    signal,
    deps,
  );
  entry.done = p.then(
    () => true,
    () => false,
  );
  running.set(stage, entry);
  notifyRunning();
  void entry.done.then(() => {
    if (running.get(stage) !== entry) return;
    running.delete(stage);
    notifyRunning();
  });
  return p;
}

async function fetchStage(
  stage: EngineStage,
  base: string,
  onProgress: (percent: number) => void,
  signal: AbortSignal | undefined,
  deps: EngineOfflineDeps,
): Promise<void> {
  const store = deps.caches ?? globalThis.caches;
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const assets = ENGINE_STAGES[stage];
  const list = urls(stage, base);
  const sizes = assets.map((a) => a.bytes);
  const loaded = assets.map(() => 0);
  const report = () => {
    const total = sizes.reduce((a, b) => a + b, 0);
    const done = loaded.reduce((a, b) => a + b, 0);
    onProgress(Math.min(99, Math.floor((done / total) * 100)));
  };
  report();

  const bodies = await Promise.all(
    list.map(async (url, i) => {
      const res = await doFetch(url, { signal, cache: 'no-cache' });
      if (res.status !== 200) throw new Error(`engine download: ${res.status} for ${url}`);
      const type = res.headers.get('content-type');
      if (type && /^\s*text\/html/i.test(type)) throw new EngineAssetError(`engine download: HTML instead of ${assets[i].kind} for ${url}`);
      // Content-Length counts the compressed bytes when the response is encoded; the stream
      // yields decoded bytes, so only trust it for unencoded responses.
      const length = Number(res.headers.get('content-length'));
      if (length > 0 && !res.headers.get('content-encoding')) sizes[i] = length;
      const chunks: Uint8Array[] = [];
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded[i] += value.byteLength;
          sizes[i] = Math.max(sizes[i], loaded[i]);
          report();
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf);
        loaded[i] = sizes[i] = buf.byteLength;
        report();
      }
      const body = new Uint8Array(loaded[i]);
      let at = 0;
      for (const c of chunks) {
        body.set(c, at);
        at += c.byteLength;
      }
      checkAsset(assets[i].kind, type, body, url);
      return { url, type: CONTENT_TYPE[assets[i].kind], body };
    }),
  );

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const cache = await store.open(ENGINE_CACHE);
  // Only the content type is kept: an encoding header would make the browser inflate the net.
  await Promise.all(bodies.map((b) => cache.put(b.url, new Response(b.body, { status: 200, headers: { 'content-type': b.type } }))));
  onProgress(100);
}

/** Asks the browser to keep `engine-cache` (iOS evicts otherwise). Never throws; false when refused or unsupported. */
export async function requestPersistence(storage: Pick<StorageManager, 'persist'> | undefined = globalThis.navigator?.storage): Promise<boolean> {
  try {
    return storage?.persist ? await storage.persist() : false;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * The status line (DESIGN 14)
 * --------------------------------------------------------------------------------------------- */

/** What the start screen's status line shows. `stage` is the stage the line is about. */
export type EngineStatusLine =
  | { readonly kind: 'none' }
  | { readonly kind: 'downloading'; readonly stage: EngineStage; readonly percent: number }
  | { readonly kind: 'ready' }
  | { readonly kind: 'offline'; readonly stage: EngineStage }
  | { readonly kind: 'failed'; readonly stage: EngineStage }
  | { readonly kind: 'saveData'; readonly stage: EngineStage };

/**
 * The status line of DESIGN 14 from both stages and whether a level 8–12 is selected (`large`,
 * `needsLargeNet(level)` of `lib/levels.ts`).
 * Stage 1 comes first; stage 2 only matters for a large level. Nothing shows while stage 1 is being
 * checked or is unsupported.
 */
export function statusLine(stage1: EngineOfflineStatus, stage2: EngineOfflineStatus, large: boolean): EngineStatusLine {
  const of = (s: EngineOfflineStatus, stage: EngineStage): EngineStatusLine | null => {
    switch (s.status) {
      case 'downloading':
        return { kind: 'downloading', stage, percent: s.percent };
      case 'missing':
        if (s.reason === 'idle') return null;
        return { kind: s.reason, stage };
      default:
        return null;
    }
  };
  if (stage1.status === 'unsupported' || stage1.status === 'checking') return { kind: 'none' };
  const first = of(stage1, 1);
  if (first) return first;
  if (large) {
    if (stage2.status === 'checking') return { kind: 'none' };
    const second = of(stage2, 2);
    if (second) return second;
    // Requested but not started yet (idle): say nothing until it starts.
    if (stage2.status === 'missing') return { kind: 'none' };
  }
  return { kind: 'ready' };
}
