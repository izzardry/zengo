import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEngineOffline } from './useEngineOffline';
import { ENGINE_STAGES, LARGE_NET_PATH, SMALL_NET_PATH, runningDownload } from '@/lib/engine/offline';

const base = 'https://example.test/app/';
const LARGE_URL = base + LARGE_NET_PATH;
const SMALL_URL = base + SMALL_NET_PATH;

/** Cache Storage that starts with `initial` and keeps what is put. */
function fakeCaches(initial: string[] = []) {
  const m = new Map<string, Response>(initial.map((u) => [u, new Response('x')]));
  const cache = {
    match: async (url: string) => m.get(url),
    put: async (url: string, r: Response) => void m.set(url, r),
  };
  return { caches: { open: async () => cache } as unknown as CacheStorage, has: (u: string) => m.has(u) };
}

function okFetch() {
  return vi.fn(async (url: string) => {
    const asset = [...ENGINE_STAGES[1], ...ENGINE_STAGES[2]].find((a) => base + a.path === url)!;
    const head = asset.kind === 'wasm' ? [0x00, 0x61, 0x73, 0x6d] : [0x1f, 0x8b];
    return new Response(new Uint8Array([...head, 1, 2, 3]), {
      status: 200,
      headers: { 'content-type': asset.kind === 'wasm' ? 'application/wasm' : 'application/gzip' },
    });
  }) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
}

const stage1Urls = ENGINE_STAGES[1].map((a) => base + a.path);
const on = { enabled: true, supported: true, base, delayMs: 0, online: () => true, standalone: () => false, persist: async () => true } as const;

describe('useEngineOffline (DESIGN 14)', () => {
  it('re-checks both stages at every launch and downloads only what is missing (evicted stage 2 on an installed app)', async () => {
    const store = fakeCaches(stage1Urls);
    const fetch = okFetch();
    const { result } = renderHook(() => useEngineOffline({ ...on, standalone: () => true, caches: store.caches, fetch }));
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'ready' }));
    expect(result.current.stage1).toEqual({ status: 'ready' });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([LARGE_URL]);
    expect(store.has(LARGE_URL)).toBe(true);
  });

  it('a stage 2 tap before stage 1 is ready waits for stage 1', async () => {
    const store = fakeCaches();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = okFetch();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      await gate;
      return inner(url, init);
    }) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
    const { result } = renderHook(() => useEngineOffline({ ...on, caches: store.caches, fetch }));
    await waitFor(() => expect(result.current.stage1.status).toBe('downloading'));
    act(() => result.current.download(2));
    expect(fetch.mock.calls.map((c) => c[0])).not.toContain(LARGE_URL);
    act(() => release());
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'ready' }));
    expect(fetch.mock.calls.map((c) => c[0])).toContain(LARGE_URL);
  });

  it('Save-Data: a level 8–12 does not start stage 2 by itself; a tap does', async () => {
    const store = fakeCaches(stage1Urls);
    const fetch = okFetch();
    const { result } = renderHook(() => useEngineOffline({ ...on, large: true, saveData: () => true, caches: store.caches, fetch }));
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'missing', reason: 'saveData' }));
    expect(result.current.line).toEqual({ kind: 'saveData', stage: 2 });
    expect(fetch).not.toHaveBeenCalled();
    act(() => result.current.download(2));
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'ready' }));
    expect(result.current.line).toEqual({ kind: 'ready' });
  });

  it('a level 8–12 offline says levels 8–12 need a connection, and fetches when back online', async () => {
    let online = false;
    const store = fakeCaches(stage1Urls);
    const fetch = okFetch();
    const { result } = renderHook(() => useEngineOffline({ ...on, large: true, online: () => online, caches: store.caches, fetch }));
    await waitFor(() => expect(result.current.line).toEqual({ kind: 'offline', stage: 2 }));
    online = true;
    act(() => void window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'ready' }));
  });

  it('shows stage 1 progress first, then stage 2 progress under a level 8–12', async () => {
    const store = fakeCaches();
    const inner = okFetch();
    const gates = new Map<string, () => void>();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      await new Promise<void>((r) => gates.set(url, r));
      return inner(url, init);
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEngineOffline({ ...on, large: true, caches: store.caches, fetch }));
    await waitFor(() => expect(result.current.line).toMatchObject({ kind: 'downloading', stage: 1 }));
    act(() => stage1Urls.forEach((u) => gates.get(u)?.()));
    await waitFor(() => expect(result.current.line).toMatchObject({ kind: 'downloading', stage: 2 }));
    await waitFor(() => expect(gates.has(LARGE_URL)).toBe(true));
    act(() => gates.get(LARGE_URL)!());
    await waitFor(() => expect(result.current.line).toEqual({ kind: 'ready' }));
    expect(store.has(SMALL_URL) && store.has(LARGE_URL)).toBe(true);
  });

  it('starts stage 2 in the same step stage 1 ends, before anyone waiting on stage 1 resumes', async () => {
    const store = fakeCaches();
    const inner = okFetch();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== LARGE_URL) await gate;
      return inner(url, init);
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEngineOffline({ ...on, large: true, caches: store.caches, fetch }));
    await waitFor(() => expect(runningDownload(1)).not.toBeNull());
    const stage1 = runningDownload(1)!;
    let stage2AtResume: unknown = 'unset';
    const waiter = stage1.done.then(() => (stage2AtResume = runningDownload(2)));
    act(() => release());
    await act(async () => {
      await waiter;
    });
    expect(stage2AtResume).not.toBeNull();
    expect((stage2AtResume as { stage: number }).stage).toBe(2);
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'ready' }));
  });

  it('asks for persistent storage once, after the first successful download', async () => {
    const store = fakeCaches();
    const fetch = okFetch();
    const persist = vi.fn(async () => true);
    const { result } = renderHook(() => useEngineOffline({ ...on, large: true, caches: store.caches, fetch, persist }));
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'ready' }));
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
