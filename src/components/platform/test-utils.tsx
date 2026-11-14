/** Test helpers for the platform package (not shipped: only imported by *.test.tsx). */
import type { ReactNode } from 'react';
import { render, renderHook, type RenderOptions } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n';
import { createStore, memoryStorage } from '@/lib/storage';
import { fromGtp } from '@/lib/zengo';
import type { Language, SavedGame, Size } from '@/lib/types';

export function memStore(initial: Record<string, string> = {}): ReturnType<typeof createStore> & { raw: ReturnType<typeof memoryStorage> } {
  const raw = memoryStorage(initial);
  return Object.assign(createStore(raw), { raw });
}

export function wrapperFor(language: Language = 'en') {
  const store = memStore();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider language={language} store={store}>
        {children}
      </I18nProvider>
    );
  };
}

export function renderWithI18n(ui: React.ReactElement, language: Language = 'en', options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: wrapperFor(language), ...options });
}

export function renderHookWithI18n<R>(hook: () => R, language: Language = 'en') {
  return renderHook(hook, { wrapper: wrapperFor(language) });
}

/**
 * A saved 9×9 area game (unless `size` / `rules` say otherwise) with the given moves in GTP
 * (`D4`, `pass`), encoded as SGF letter pairs (DESIGN 13.2).
 */
export function savedGame(over: Partial<SavedGame> & { gtp?: string[] } = {}): SavedGame {
  const { gtp = [], ...rest } = over;
  const size: Size = rest.size ?? 9;
  const moves = gtp
    .map((m) => {
      const p = fromGtp(m, size);
      if (!p) throw new Error(`Bad GTP move in test: ${m}`);
      return p;
    })
    .join('');
  return {
    id: rest.code ?? 'K7QW2M',
    code: 'K7QW2M',
    mode: 'computer',
    level: 5,
    color: 'B',
    size,
    rules: 'area',
    handicap: 0,
    tc: null,
    moves,
    ms: gtp.map(() => 1000),
    assisted: false,
    createdAt: 0,
    lastPlayedAt: 0,
    ...rest,
  };
}
