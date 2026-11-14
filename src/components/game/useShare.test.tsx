import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, type I18nProviderProps } from '@/lib/i18n';
import { createStore, memoryStorage } from '@/lib/storage';
import type { Language } from '@/lib/types';
import type { ShareNavigator } from './share';
import { useShare } from './useShare';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const wrapper =
  (lang: Language = 'en') =>
  ({ children }: { children: ReactNode }) => (
    <I18nProvider language={lang} store={createStore(memoryStorage()) as unknown as NonNullable<I18nProviderProps['store']>}>
      {children}
    </I18nProvider>
  );

beforeEach(() => {
  toastMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe('useShare', () => {
  it('shares with the text for each kind (DESIGN 13.2)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const nav: ShareNavigator = { share };
    const { result } = renderHook(() => useShare(nav), { wrapper: wrapper() });
    await act(() => result.current.shareLink('u1', 'room'));
    await act(() => result.current.shareLink('u2', 'solo'));
    await act(() => result.current.shareLink('u3', 'win', 7));
    expect(share.mock.calls.map((c) => [c[0].text, c[0].url, c[0].title])).toEqual([
      ['Join my Go game!', 'u1', 'Zengo'],
      ['Look at this Go game.', 'u2', 'Zengo'],
      ['I beat Level 7! Can you?', 'u3', 'Zengo'],
    ]);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('shares in every language with the Go glossary (go in French)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useShare({ share }), { wrapper: wrapper('fr') });
    await act(() => result.current.shareLink('u', 'room'));
    expect(share.mock.calls[0][0].text).toBe('Rejoignez ma partie de go !');
  });

  it('copies the link with a toast when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useShare({ clipboard: { writeText } }), { wrapper: wrapper() });
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.shareLink('https://zengo/#/?s=ABC', 'solo');
    });
    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://zengo/#/?s=ABC');
    expect(toastMock.success).toHaveBeenCalledWith('Link copied!');
  });

  it('copies SGF with a toast, or reports failure in a plain toast without an icon (Ztyle 09)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useShare({ clipboard: { writeText } }), { wrapper: wrapper('de') });
    await act(() => result.current.copySgf('(;FF[4]GM[1]SZ[9];B[ee])'));
    expect(writeText).toHaveBeenCalledWith('(;FF[4]GM[1]SZ[9];B[ee])');
    expect(toastMock.success).toHaveBeenCalledWith('SGF kopiert!');

    writeText.mockRejectedValue(new Error('denied'));
    const original = document.execCommand;
    document.execCommand = vi.fn().mockReturnValue(false);
    try {
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.copySgf('x');
      });
      expect(ok).toBe(false);
      expect(toastMock).toHaveBeenCalledWith('Kopieren fehlgeschlagen');
      expect(toastMock.error).not.toHaveBeenCalled();
    } finally {
      document.execCommand = original;
    }
  });

  it('a cancelled share sheet shows no toast', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const { result } = renderHook(() => useShare({ share: vi.fn().mockRejectedValue(abort) }), { wrapper: wrapper() });
    await act(() => result.current.shareLink('u', 'solo'));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('reports a failed share fallback in a plain toast without an icon (Ztyle 09)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const original = document.execCommand;
    document.execCommand = vi.fn().mockReturnValue(false);
    try {
      const { result } = renderHook(() => useShare({ clipboard: { writeText } }), { wrapper: wrapper() });
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.shareLink('u', 'solo');
      });
      expect(outcome).toBe('failed');
      expect(toastMock).toHaveBeenCalledWith('Could not copy');
      expect(toastMock.error).not.toHaveBeenCalled();
      expect(toastMock.success).not.toHaveBeenCalled();
    } finally {
      document.execCommand = original;
    }
  });
});
