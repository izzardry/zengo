import { describe, expect, it, vi } from 'vitest';
import {
  ENGINE_CACHE,
  ENGINE_STAGES,
  EngineAssetError,
  LARGE_NET_PATH,
  SMALL_NET_PATH,
  checkAsset,
  downloadStage,
  isStageCached,
  requestPersistence,
  statusLine,
  type EngineOfflineStatus,
} from './offline';

const BASE = 'https://example.test/zigo/';
const STAGE1 = ENGINE_STAGES[1].map((a) => BASE + a.path);
const NET1 = BASE + SMALL_NET_PATH;
const NET2 = BASE + LARGE_NET_PATH;

/** In-memory Cache Storage with the few methods the module uses. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (url: string) => m.get(url),
      put: async (url: string, res: Response) => void m.set(url, res),
    } as unknown as Cache;
  };
  return { stores, caches: { open } as unknown as CacheStorage };
}

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const GZIP_MAGIC = [0x1f, 0x8b];

function streamOf(bytes: number, head: readonly number[], chunk = 100_000): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= bytes) return c.close();
      const n = Math.min(chunk, bytes - sent);
      const part = new Uint8Array(n);
      if (sent === 0) part.set(head.slice(0, n));
      sent += n;
      c.enqueue(part);
    },
  });
}

interface FetchOpts {
  status?: number;
  encoded?: boolean;
  /** Answer every request like the SPA fallback: 200 text/html. */
  html?: boolean;
  /** Bodies without magic bytes. */
  garbage?: boolean;
}

function fakeFetch(opts: FetchOpts = {}) {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(url);
    const asset = [...ENGINE_STAGES[1], ...ENGINE_STAGES[2]].find((a) => BASE + a.path === url)!;
    const size = Math.round(asset.bytes / 10);
    if (opts.html) return new Response('<!doctype html><title>Zigo</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    const headers: Record<string, string> = { 'content-type': asset.kind === 'wasm' ? 'application/wasm' : 'application/gzip' };
    if (opts.encoded) headers['content-encoding'] = 'gzip';
    headers['content-length'] = String(opts.encoded ? Math.round(size / 3) : size);
    const head = opts.garbage ? [0x3c, 0x21] : asset.kind === 'wasm' ? WASM_MAGIC : GZIP_MAGIC;
    return new Response(streamOf(size, head), { status: opts.status ?? 200, headers });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('engine stages', () => {
  it('stage 1 holds the TF.js wasm backends and the small net; stage 2 the large net', () => {
    expect(ENGINE_STAGES[1].map((a) => a.path)).toEqual([
      'engine/tfjs/tfjs-backend-wasm.wasm',
      'engine/tfjs/tfjs-backend-wasm-simd.wasm',
      SMALL_NET_PATH,
    ]);
    expect(ENGINE_STAGES[2].map((a) => a.path)).toEqual([LARGE_NET_PATH]);
    const mb = (s: 1 | 2) => ENGINE_STAGES[s].reduce((a, b) => a + b.bytes, 0) / 1e6;
    expect(mb(1)).toBeGreaterThan(4);
    expect(mb(1)).toBeLessThan(5);
    expect(mb(2)).toBeCloseTo(11.1, 1);
  });
});

describe('checkAsset', () => {
  it('accepts the right magic bytes and refuses HTML or anything else', () => {
    expect(() => checkAsset('wasm', 'application/wasm', new Uint8Array([0, 0x61, 0x73, 0x6d, 1]))).not.toThrow();
    expect(() => checkAsset('gzip', null, new Uint8Array([0x1f, 0x8b, 8]))).not.toThrow();
    expect(() => checkAsset('gzip', 'text/html', new Uint8Array([0x1f, 0x8b]))).toThrow(EngineAssetError);
    expect(() => checkAsset('wasm', 'application/wasm', new Uint8Array([0x1f, 0x8b, 0, 0]))).toThrow(EngineAssetError);
    expect(() => checkAsset('gzip', 'application/gzip', new Uint8Array([0x1f]))).toThrow(EngineAssetError);
  });
});

describe('downloadStage', () => {
  it('downloads stage 1 into engine-cache with rising progress that ends at 100', async () => {
    const { stores, caches } = fakeCaches();
    const { fetch, calls } = fakeFetch();
    const seen: number[] = [];
    expect(await isStageCached(1, BASE, { caches })).toBe(false);
    await downloadStage(1, BASE, (p) => seen.push(p), undefined, { caches, fetch });
    expect(calls.sort()).toEqual([...STAGE1].sort());
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(100);
    expect(seen.slice(0, -1).every((p) => p <= 99)).toBe(true);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(await isStageCached(1, BASE, { caches })).toBe(true);
    expect(await isStageCached(2, BASE, { caches })).toBe(false);
    const net = stores.get(ENGINE_CACHE)!.get(NET1)!;
    expect(net.headers.get('content-type')).toBe('application/gzip');
    expect(net.headers.get('content-encoding')).toBeNull();
    const bytes = new Uint8Array(await net.arrayBuffer());
    expect(bytes.byteLength).toBe(Math.round(3_827_339 / 10));
    expect([bytes[0], bytes[1]]).toEqual(GZIP_MAGIC);
  });

  it('stage 2 downloads only the large net', async () => {
    const { caches } = fakeCaches();
    const { fetch, calls } = fakeFetch();
    await downloadStage(2, BASE, () => {}, undefined, { caches, fetch });
    expect(calls).toEqual([NET2]);
    expect(await isStageCached(2, BASE, { caches })).toBe(true);
  });

  it('never reports past 99 before the end when Content-Length counts compressed bytes', async () => {
    const { caches } = fakeCaches();
    const { fetch } = fakeFetch({ encoded: true });
    const seen: number[] = [];
    await downloadStage(1, BASE, (p) => seen.push(p), undefined, { caches, fetch });
    expect(Math.max(...seen.slice(0, -1))).toBeLessThanOrEqual(99);
    expect(seen.at(-1)).toBe(100);
  });

  it('stores nothing when a file fails', async () => {
    const { caches } = fakeCaches();
    const { fetch } = fakeFetch({ status: 404 });
    await expect(downloadStage(1, BASE, () => {}, undefined, { caches, fetch })).rejects.toThrow(/404/);
    expect(await isStageCached(1, BASE, { caches })).toBe(false);
  });

  it('refuses the SPA fallback (200 text/html) and bodies without magic bytes', async () => {
    const { stores, caches } = fakeCaches();
    await expect(downloadStage(1, BASE, () => {}, undefined, { caches, fetch: fakeFetch({ html: true }).fetch })).rejects.toThrow(EngineAssetError);
    await expect(downloadStage(2, BASE, () => {}, undefined, { caches, fetch: fakeFetch({ garbage: true }).fetch })).rejects.toThrow(EngineAssetError);
    expect(stores.get(ENGINE_CACHE)?.size ?? 0).toBe(0);
  });

  it('a stage with only some of its files does not count', async () => {
    const { caches } = fakeCaches();
    await (await caches.open(ENGINE_CACHE)).put(NET1, new Response('x'));
    expect(await isStageCached(1, BASE, { caches })).toBe(false);
  });

  it('an abort stores nothing', async () => {
    const { caches } = fakeCaches();
    const ctrl = new AbortController();
    const { fetch } = fakeFetch();
    const p = downloadStage(1, BASE, () => ctrl.abort(), ctrl.signal, { caches, fetch });
    await expect(p).rejects.toThrow();
    expect(await isStageCached(1, BASE, { caches })).toBe(false);
  });
});

describe('requestPersistence', () => {
  it('asks once and never throws', async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistence({ persist })).toBe(true);
    expect(await requestPersistence({ persist: async () => Promise.reject(new Error('no')) })).toBe(false);
    expect(await requestPersistence(undefined)).toBe(false);
  });
});

describe('statusLine (DESIGN 14)', () => {
  const ready: EngineOfflineStatus = { status: 'ready' };
  const idle: EngineOfflineStatus = { status: 'missing', reason: 'idle' };
  const dl = (percent: number): EngineOfflineStatus => ({ status: 'downloading', percent });

  it('shows nothing while checking or unsupported', () => {
    expect(statusLine({ status: 'checking' }, idle, false)).toEqual({ kind: 'none' });
    expect(statusLine({ status: 'unsupported' }, { status: 'unsupported' }, true)).toEqual({ kind: 'none' });
  });

  it('stage 1 first: progress, offline, failure, Save-Data', () => {
    expect(statusLine(dl(43), idle, false)).toEqual({ kind: 'downloading', stage: 1, percent: 43 });
    expect(statusLine(dl(43), idle, true)).toEqual({ kind: 'downloading', stage: 1, percent: 43 });
    expect(statusLine({ status: 'missing', reason: 'offline' }, idle, false)).toEqual({ kind: 'offline', stage: 1 });
    expect(statusLine({ status: 'missing', reason: 'failed' }, idle, false)).toEqual({ kind: 'failed', stage: 1 });
    expect(statusLine({ status: 'missing', reason: 'saveData' }, idle, false)).toEqual({ kind: 'saveData', stage: 1 });
  });

  it('levels 1–7 are ready with stage 1; levels 8–12 need stage 2', () => {
    expect(statusLine(ready, idle, false)).toEqual({ kind: 'ready' });
    expect(statusLine(ready, dl(10), false)).toEqual({ kind: 'ready' });
    expect(statusLine(ready, dl(10), true)).toEqual({ kind: 'downloading', stage: 2, percent: 10 });
    expect(statusLine(ready, { status: 'missing', reason: 'offline' }, true)).toEqual({ kind: 'offline', stage: 2 });
    expect(statusLine(ready, { status: 'missing', reason: 'failed' }, true)).toEqual({ kind: 'failed', stage: 2 });
    expect(statusLine(ready, idle, true)).toEqual({ kind: 'none' });
    expect(statusLine(ready, ready, true)).toEqual({ kind: 'ready' });
  });
});
