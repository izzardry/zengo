import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { useEngineOffline } from '@/hooks/useEngineOffline';
import { ENGINE_STAGES, LARGE_NET_PATH } from '@/lib/engine/offline';
import { COMPUTER_ENABLED } from '@/lib/flags';
import { EngineStatus } from './EngineStatus';

const wrap = ({ children }: { children: ReactNode }) => <I18nProvider language="en">{children}</I18nProvider>;

const base = 'https://example.test/zigo/';
const LARGE_URL = base + LARGE_NET_PATH;

/** Cache Storage where `cached` lists the URLs present at the start. */
function fakeCaches(cached: (url: string) => boolean = () => false) {
  const m = new Map<string, Response>();
  const cache = {
    match: async (url: string) => (cached(url) ? new Response('x') : m.get(url)),
    put: async (url: string, r: Response) => void m.set(url, r),
  };
  return { open: async () => cache } as unknown as CacheStorage;
}

function bodyFor(url: string): Response {
  const asset = [...ENGINE_STAGES[1], ...ENGINE_STAGES[2]].find((a) => base + a.path === url)!;
  const head = asset.kind === 'wasm' ? [0x00, 0x61, 0x73, 0x6d] : [0x1f, 0x8b];
  return new Response(new Uint8Array([...head, 0, 0, 0, 0]), {
    status: 200,
    headers: { 'content-type': asset.kind === 'wasm' ? 'application/wasm' : 'application/gzip' },
  });
}

/** fetch whose responses finish only when `release` is called. */
function gatedFetch() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetch = vi.fn(async (url: string) => {
    await gate;
    return bodyFor(url);
  }) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
  return { fetch, release: () => release() };
}

const on = { enabled: true, supported: true, base, delayMs: 0, standalone: () => false, persist: async () => true } as const;

describe('useEngineOffline', () => {
  it('is off in milestone 1: nothing is checked or downloaded while COMPUTER_ENABLED is false', () => {
    expect(COMPUTER_ENABLED).toBe(false);
    const fetch = vi.fn();
    const { result } = renderHook(() => useEngineOffline({ supported: true, base, caches: fakeCaches(), fetch: fetch as never, delayMs: 0 }));
    expect(result.current.stage1).toEqual({ status: 'unsupported' });
    expect(result.current.stage2).toEqual({ status: 'unsupported' });
    expect(result.current.line).toEqual({ kind: 'none' });
    act(() => result.current.download(1));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is ready at once when stage 1 is cached, without downloading; stage 2 stays idle', async () => {
    const fetch = vi.fn();
    const { result } = renderHook(() => useEngineOffline({ ...on, caches: fakeCaches((u) => u !== LARGE_URL), fetch: fetch as never }));
    await waitFor(() => expect(result.current.stage1).toEqual({ status: 'ready' }));
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'missing', reason: 'idle' }));
    expect(result.current.line).toEqual({ kind: 'ready' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads stage 1 on launch when missing, then asks for persistent storage', async () => {
    const { fetch, release } = gatedFetch();
    const persist = vi.fn(async () => true);
    const { result } = renderHook(() => useEngineOffline({ ...on, caches: fakeCaches(), fetch, online: () => true, persist }));
    await waitFor(() => expect(result.current.stage1.status).toBe('downloading'));
    expect(result.current.line).toMatchObject({ kind: 'downloading', stage: 1 });
    act(() => release());
    await waitFor(() => expect(result.current.stage1).toEqual({ status: 'ready' }));
    expect(fetch).toHaveBeenCalledTimes(ENGINE_STAGES[1].length);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('stage 2 starts after stage 1 when a level 8–12 is selected', async () => {
    const { fetch, release } = gatedFetch();
    release();
    const { result, rerender } = renderHook((p: { large: boolean }) => useEngineOffline({ ...on, large: p.large, caches: fakeCaches(), fetch, online: () => true }), {
      initialProps: { large: false },
    });
    await waitFor(() => expect(result.current.stage1).toEqual({ status: 'ready' }));
    expect(result.current.stage2).toEqual({ status: 'missing', reason: 'idle' });
    expect(fetch).not.toHaveBeenCalledWith(LARGE_URL, expect.anything());
    rerender({ large: true });
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'ready' }));
    expect(fetch).toHaveBeenCalledWith(LARGE_URL, expect.anything());
    expect(result.current.line).toEqual({ kind: 'ready' });
  });

  it('an installed app downloads stage 2 without a level 8–12', async () => {
    const { fetch, release } = gatedFetch();
    release();
    const { result } = renderHook(() => useEngineOffline({ ...on, standalone: () => true, caches: fakeCaches(), fetch, online: () => true }));
    await waitFor(() => expect(result.current.stage2).toEqual({ status: 'ready' }));
  });

  it('offline: waits, and downloads when the device comes back online', async () => {
    let online = false;
    const { fetch, release } = gatedFetch();
    const { result } = renderHook(() => useEngineOffline({ ...on, caches: fakeCaches(), fetch, online: () => online }));
    await waitFor(() => expect(result.current.stage1).toEqual({ status: 'missing', reason: 'offline' }));
    expect(fetch).not.toHaveBeenCalled();
    online = true;
    act(() => void window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.stage1.status).toBe('downloading'));
    act(() => release());
    await waitFor(() => expect(result.current.stage1).toEqual({ status: 'ready' }));
  });

  it('Save-Data: waits for a tap; a failure offers a retry', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEngineOffline({ ...on, caches: fakeCaches(), fetch, online: () => true, saveData: () => true }));
    await waitFor(() => expect(result.current.stage1).toEqual({ status: 'missing', reason: 'saveData' }));
    expect(fetch).not.toHaveBeenCalled();
    act(() => result.current.download());
    await waitFor(() => expect(result.current.stage1).toEqual({ status: 'missing', reason: 'failed' }));
    expect(result.current.line).toEqual({ kind: 'failed', stage: 1 });
  });

  it('the SPA fallback (200 text/html) fails the download instead of caching HTML', async () => {
    const fetch = vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEngineOffline({ ...on, caches: fakeCaches(), fetch, online: () => true }));
    await waitFor(() => expect(result.current.stage1).toEqual({ status: 'missing', reason: 'failed' }));
  });

  it('shows nothing where offline caching is unsupported', () => {
    const { result } = renderHook(() => useEngineOffline({ enabled: true, supported: false }));
    expect(result.current.stage1).toEqual({ status: 'unsupported' });
  });
});

describe('EngineStatus', () => {
  it('renders nothing while the computer is switched off', () => {
    const { container } = render(<EngineStatus line={{ kind: 'ready' }} onDownload={() => {}} />, { wrapper: wrap });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the DESIGN 14 states and retries the right stage', () => {
    const onDownload = vi.fn();
    const { rerender, container } = render(<EngineStatus enabled line={{ kind: 'none' }} onDownload={onDownload} />, { wrapper: wrap });
    expect(container).toBeEmptyDOMElement();

    rerender(<EngineStatus enabled line={{ kind: 'downloading', stage: 1, percent: 43 }} onDownload={onDownload} />);
    expect(screen.getByText('Computer 43%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Downloading the computer for offline play' })).toHaveAttribute('aria-valuenow', '43');

    rerender(<EngineStatus enabled line={{ kind: 'downloading', stage: 2, percent: 12 }} onDownload={onDownload} />);
    expect(screen.getByText('Levels 8–12 · 12%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Downloading levels 8–12 for offline play' })).toHaveAttribute('aria-valuenow', '12');

    rerender(<EngineStatus enabled line={{ kind: 'ready' }} onDownload={onDownload} />);
    expect(screen.getByRole('status')).toHaveTextContent('Computer ready offline');

    rerender(<EngineStatus enabled line={{ kind: 'offline', stage: 1 }} onDownload={onDownload} />);
    expect(screen.getByRole('status')).toHaveTextContent('Computer needs a connection');
    rerender(<EngineStatus enabled line={{ kind: 'offline', stage: 2 }} onDownload={onDownload} />);
    expect(screen.getByRole('status')).toHaveTextContent('Levels 8–12 need a connection');

    rerender(<EngineStatus enabled line={{ kind: 'failed', stage: 2 }} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download failed · Retry' }));
    expect(onDownload).toHaveBeenLastCalledWith(2);

    rerender(<EngineStatus enabled line={{ kind: 'saveData', stage: 1 }} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download the computer' }));
    expect(onDownload).toHaveBeenLastCalledWith(1);
    rerender(<EngineStatus enabled line={{ kind: 'saveData', stage: 2 }} onDownload={onDownload} />);
    expect(screen.getByRole('button', { name: 'Download levels 8–12' })).toBeInTheDocument();
  });
});
